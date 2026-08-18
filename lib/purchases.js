/**
 * Purchase (goods-received) header + lines, suppliers, and the linked expense.
 *
 * Quantities and unit costs on purchase_items are in PURCHASE units — that's
 * how a delivery note reads. The ledger converts to consumption units on the
 * way into inventory_items (see lib/inventory-ledger.js for the unit rule).
 */

import { applyStockChange, ensureLedgerSchema, normalizeName } from '@/lib/inventory-ledger.js';
import { upsertLinkedExpense, deleteLinkedExpense } from '@/lib/expense-links.js';
import { buildSearch, paginateQuery, resolveOrderBy } from '@/lib/paginate.js';
import { nepalDateString } from '@/lib/report-dates.js';

export { ensureLedgerSchema };

/* ------------------------------------------------------------- suppliers */

/** Find-or-create a supplier by normalized name. Returns the row, or null for blank input. */
export async function resolveSupplier(db, name, extra = {}) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const key = normalizeName(clean);

  const existing = await db.get(`SELECT * FROM suppliers WHERE normalized_name = ?`, [key]);
  if (existing) return existing;

  await db.run(
    `INSERT INTO suppliers (name, normalized_name, phone, email, address, notes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [clean, key, extra.phone || null, extra.email || null, extra.address || null, extra.notes || null]
  );
  return db.get(`SELECT * FROM suppliers WHERE normalized_name = ?`, [key]);
}

const SUPPLIER_SORTS = {
  name: 's.name',
  phone: 's.phone',
  email: 's.email',
  created_at: 's.created_at',
};

const SUPPLIER_SEARCH_COLUMNS = ['s.name', 's.phone', 's.email', 's.address', 's.notes'];

/** @returns {{ rows: any[], pagination: object }} */
export async function listSuppliers(
  db,
  { includeArchived = false, page = 1, pageSize = 50, exportAll = false, sort = '', dir = 'ASC', search = '' } = {}
) {
  const conditions = [includeArchived ? '1=1' : 'COALESCE(s.is_archived, 0) = 0'];
  const params = [];

  const searchClause = buildSearch(search, SUPPLIER_SEARCH_COLUMNS);
  if (searchClause.clause) {
    conditions.push(searchClause.clause);
    params.push(...searchClause.params);
  }

  return paginateQuery(db, {
    // total_spend / last_purchase_at come from SQL now. The page used to fetch
    // 500 purchases and add them up in the browser, which was both slow and
    // wrong the moment a supplier had more than 500.
    columns: `s.*,
      (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id) AS purchase_count,
      (SELECT COUNT(*) FROM inventory_items i WHERE i.supplier_id = s.id) AS item_count,
      (SELECT COALESCE(SUM(p.total), 0) FROM purchases p
        WHERE p.supplier_id = s.id AND COALESCE(p.status, '') <> 'voided') AS total_spend,
      (SELECT MAX(p.created_at) FROM purchases p WHERE p.supplier_id = s.id) AS last_purchase_at`,
    from: 'suppliers s',
    where: conditions.join(' AND '),
    params,
    orderBy: resolveOrderBy(sort, dir, SUPPLIER_SORTS, 'name', 's.id'),
    page,
    pageSize,
    exportAll,
  });
}

/**
 * Fold `sourceIds` into `targetId`: repoint purchases/inventory, rewrite the
 * legacy free-text supplier columns, archive the losers.
 */
export async function mergeSuppliers(db, targetId, sourceIds = []) {
  const target = await db.get(`SELECT * FROM suppliers WHERE id = ?`, [targetId]);
  if (!target) throw new Error('Target supplier not found.');
  const sources = (sourceIds || []).map(Number).filter((id) => id && id !== Number(targetId));
  if (!sources.length) throw new Error('Pick at least one other supplier to merge in.');

  return db.transaction(async (tx) => {
    for (const id of sources) {
      const src = await tx.get(`SELECT * FROM suppliers WHERE id = ?`, [id]);
      if (!src) continue;
      await tx.run(`UPDATE purchases SET supplier_id = ?, supplier = ? WHERE supplier_id = ?`, [target.id, target.name, id]);
      await tx.run(`UPDATE inventory_items SET supplier_id = ?, supplier = ? WHERE supplier_id = ?`, [target.id, target.name, id]);
      await tx.run(`UPDATE expenses SET supplier = ? WHERE lower(trim(supplier)) = ?`, [target.name, src.normalized_name]);
      await tx.run(`UPDATE inventory_items SET supplier = ? WHERE lower(trim(supplier)) = ?`, [target.name, src.normalized_name]);
      await tx.run(`DELETE FROM suppliers WHERE id = ?`, [id]);
    }
    return tx.get(`SELECT * FROM suppliers WHERE id = ?`, [target.id]);
  });
}

/* ------------------------------------------------------------- purchases */

function money(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function computeTotals(lines, header) {
  const subtotal = lines.reduce((s, l) => s + money(l.line_total), 0);
  const total = subtotal + money(header.tax) + money(header.shipping) - money(header.discount);
  return { subtotal, total };
}

function normalizeLines(rawLines) {
  const lines = [];
  for (const l of rawLines || []) {
    const itemId = Number(l.inventory_item_id || l.item_id);
    if (!itemId) continue;
    const ordered = money(l.quantity_ordered ?? l.quantity);
    const received = l.quantity_received === undefined || l.quantity_received === null || l.quantity_received === ''
      ? ordered
      : money(l.quantity_received);
    const unitCost = money(l.unit_cost);
    lines.push({
      inventory_item_id: itemId,
      quantity_ordered: ordered,
      quantity_received: received,
      unit_cost: unitCost,
      line_total: l.line_total === undefined || l.line_total === null || l.line_total === ''
        ? received * unitCost
        : money(l.line_total),
    });
  }
  return lines;
}

function deriveStatus(lines, requested) {
  if (requested) return requested;
  if (lines.some((l) => l.quantity_received < l.quantity_ordered)) return 'partial';
  return 'received';
}

async function syncPurchaseExpense(db, purchase, lines) {
  if (purchase.status === 'voided' || purchase.status === 'draft') {
    await deleteLinkedExpense(db, 'purchase', purchase.id);
    return null;
  }
  return upsertLinkedExpense(db, 'purchase', purchase.id, {
    description: `Purchase ${purchase.invoice_number || `#${purchase.id}`}${purchase.supplier ? ` — ${purchase.supplier}` : ''} (${lines.length} line${lines.length === 1 ? '' : 's'})`,
    category: 'inventory_purchase',
    amount: purchase.total,
    date: purchase.invoice_date,
    supplier: purchase.supplier || null,
    supplier_id: purchase.supplier_id || null,
    notes: purchase.notes || null,
    payment_method: purchase.payment_method || 'cash',
    logged_by: purchase.received_by || null,
    receipt_url: purchase.attachment_url || null,
  });
}

/** Post every received line into stock through the ledger. `sign` +1 receipt, -1 reversal. */
async function postLines(db, purchaseId, lines, sign, { performedBy, reason }) {
  const applied = [];
  const warnings = [];
  for (const line of lines) {
    if (!(line.quantity_received > 0)) continue;
    const row = await applyStockChange(db, {
      inventory_item_id: line.inventory_item_id,
      quantity: sign * line.quantity_received,
      units: 'purchase',
      unit_cost: sign > 0 ? line.unit_cost : null,
      change_type: 'purchase_receipt',
      performed_by: performedBy,
      reason,
      reference_id: purchaseId,
    });
    if (!row) continue;
    applied.push(row);
    if (row.warning) warnings.push(row.warning);
  }
  return { applied, warnings };
}

/**
 * Create a purchase, receive the stock, write the movements and post the
 * expense — all inside one transaction. Nothing lands if anything throws.
 */
export async function createPurchase(db, data) {
  const lines = normalizeLines(data.items || data.lines);
  if (!lines.length) throw new Error('Add at least one purchase line with an item and quantity.');

  return db.transaction(async (tx) => {
    const supplier = await resolveSupplier(tx, data.supplier || data.supplier_name);
    const status = deriveStatus(lines, data.status);
    const { subtotal, total } = computeTotals(lines, data);

    const result = await tx.run(
      `INSERT INTO purchases
         (supplier_id, supplier, invoice_number, invoice_date, expected_delivery_date, received_by,
          subtotal, tax, discount, shipping, total, notes, attachment_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        supplier?.id || null,
        supplier?.name || null,
        data.invoice_number || null,
        data.invoice_date || nepalDateString(),
        data.expected_delivery_date || null,
        data.received_by || null,
        subtotal,
        money(data.tax),
        money(data.discount),
        money(data.shipping),
        total,
        data.notes || null,
        data.attachment_url || null,
        status,
      ]
    );
    const purchaseId = result.lastInsertRowid;

    for (const line of lines) {
      await tx.run(
        `INSERT INTO purchase_items
           (purchase_id, inventory_item_id, quantity_ordered, quantity_received, unit_cost, line_total)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [purchaseId, line.inventory_item_id, line.quantity_ordered, line.quantity_received, line.unit_cost, line.line_total]
      );
    }

    let stock = { applied: [], warnings: [] };
    if (status !== 'draft') {
      stock = await postLines(tx, purchaseId, lines, 1, {
        performedBy: data.received_by || null,
        reason: data.invoice_number ? `Invoice ${data.invoice_number}` : 'Delivery received',
      });
    }

    const purchase = await tx.get(`SELECT * FROM purchases WHERE id = ?`, [purchaseId]);
    const expense_id = await syncPurchaseExpense(tx, { ...purchase, payment_method: data.payment_method }, lines);

    return { ...purchase, items: lines, stock, expense_id };
  });
}

/** The date a purchase is "on" — the invoice date, falling back to when it landed. */
const PURCHASE_DATE = `COALESCE(p.invoice_date, CAST(p.created_at AS TEXT))`;

const PURCHASE_SORTS = {
  created_at: 'p.created_at',
  invoice_date: PURCHASE_DATE,
  invoice_number: 'p.invoice_number',
  supplier_name: 's.name',
  status: 'p.status',
  total: 'p.total',
};

const PURCHASE_SEARCH_COLUMNS = ['p.invoice_number', 's.name', 'p.supplier', 'p.notes', 'p.status'];

/** @returns {{ rows: any[], pagination: object }} */
export async function listPurchases(
  db,
  { supplierId, from, to, status, page = 1, pageSize = 50, exportAll = false, sort = '', dir = 'DESC', search = '' } = {}
) {
  const conditions = ['1=1'];
  const params = [];

  if (supplierId) {
    conditions.push('p.supplier_id = ?');
    params.push(Number(supplierId));
  }
  if (status && status !== 'all') {
    conditions.push('p.status = ?');
    params.push(status);
  }
  if (from) {
    conditions.push(`${PURCHASE_DATE} >= ?`);
    params.push(from);
  }
  if (to) {
    conditions.push(`${PURCHASE_DATE} <= ?`);
    params.push(to);
  }

  const searchClause = buildSearch(search, PURCHASE_SEARCH_COLUMNS);
  if (searchClause.clause) {
    conditions.push(searchClause.clause);
    params.push(...searchClause.params);
  }

  const where = conditions.join(' AND ');
  const from_ = `purchases p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN users u ON p.received_by = u.id`;

  const [result, totals] = await Promise.all([
    paginateQuery(db, {
      columns: `p.*, s.name AS supplier_name, u.full_name AS received_by_name,
      (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS line_count`,
      from: from_,
      where,
      params,
      orderBy: resolveOrderBy(sort, dir, PURCHASE_SORTS, 'created_at', 'p.id'),
      page,
      pageSize,
      exportAll,
    }),
    // KPI tiles cover the whole filtered range, so they are summed in SQL
    // rather than off whichever page happens to be loaded.
    db.get(
      `SELECT COALESCE(SUM(CASE WHEN COALESCE(p.status,'') <> 'voided' THEN p.total ELSE 0 END), 0) AS spend,
              SUM(CASE WHEN COALESCE(p.status,'') <> 'voided' THEN 1 ELSE 0 END) AS live,
              SUM(CASE WHEN p.status = 'partial' THEN 1 ELSE 0 END) AS partials,
              SUM(CASE WHEN p.status = 'voided' THEN 1 ELSE 0 END) AS voided,
              COUNT(DISTINCT CASE WHEN COALESCE(p.status,'') <> 'voided' THEN p.supplier_id END) AS suppliers_used
       FROM ${from_} WHERE ${where}`,
      params
    ),
  ]);

  return {
    ...result,
    summary: {
      spend: Number(totals?.spend || 0),
      live: Number(totals?.live || 0),
      partials: Number(totals?.partials || 0),
      voided: Number(totals?.voided || 0),
      suppliers_used: Number(totals?.suppliers_used || 0),
    },
  };
}

export async function getPurchase(db, id) {
  const purchase = await db.get(
    `SELECT p.*, s.name AS supplier_name, u.full_name AS received_by_name
     FROM purchases p
     LEFT JOIN suppliers s ON p.supplier_id = s.id
     LEFT JOIN users u ON p.received_by = u.id
     WHERE p.id = ?`,
    [id]
  );
  if (!purchase) return null;
  const items = await db.all(
    `SELECT pi.*, i.item_name, i.purchase_unit, i.consumption_unit, i.conversion_factor
     FROM purchase_items pi
     LEFT JOIN inventory_items i ON pi.inventory_item_id = i.id
     WHERE pi.purchase_id = ?
     ORDER BY pi.id`,
    [id]
  );
  const expense = await db.get(
    `SELECT * FROM expenses WHERE source_type = 'purchase' AND source_id = ? LIMIT 1`,
    [id]
  );
  return { ...purchase, items, expense };
}

/**
 * Edit a purchase: reverse the old receipt, apply the new one, re-sync the
 * expense. One transaction.
 */
export async function updatePurchase(db, id, data) {
  return db.transaction(async (tx) => {
    const current = await tx.get(`SELECT * FROM purchases WHERE id = ?`, [id]);
    if (!current) throw new Error('Purchase not found.');
    if (current.status === 'voided') throw new Error('This purchase is voided — create a new one instead.');

    const oldLines = await tx.all(`SELECT * FROM purchase_items WHERE purchase_id = ?`, [id]);
    await postLines(tx, id, oldLines, -1, {
      performedBy: data.received_by || current.received_by,
      reason: `Purchase #${id} edited — previous receipt reversed`,
    });
    await tx.run(`DELETE FROM purchase_items WHERE purchase_id = ?`, [id]);

    const lines = normalizeLines(data.items || data.lines);
    if (!lines.length) throw new Error('A purchase needs at least one line.');
    const supplier = await resolveSupplier(tx, data.supplier ?? current.supplier);
    const status = deriveStatus(lines, data.status);
    const { subtotal, total } = computeTotals(lines, data);

    await tx.run(
      `UPDATE purchases
       SET supplier_id = ?, supplier = ?, invoice_number = ?, invoice_date = ?,
           expected_delivery_date = ?, received_by = ?, subtotal = ?, tax = ?, discount = ?,
           shipping = ?, total = ?, notes = ?, attachment_url = ?, status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        supplier?.id || null,
        supplier?.name || null,
        data.invoice_number ?? current.invoice_number,
        data.invoice_date ?? current.invoice_date,
        data.expected_delivery_date ?? current.expected_delivery_date,
        data.received_by ?? current.received_by,
        subtotal,
        money(data.tax),
        money(data.discount),
        money(data.shipping),
        total,
        data.notes ?? current.notes,
        data.attachment_url ?? current.attachment_url,
        status,
        id,
      ]
    );

    for (const line of lines) {
      await tx.run(
        `INSERT INTO purchase_items
           (purchase_id, inventory_item_id, quantity_ordered, quantity_received, unit_cost, line_total)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, line.inventory_item_id, line.quantity_ordered, line.quantity_received, line.unit_cost, line.line_total]
      );
    }

    let stock = { applied: [], warnings: [] };
    if (status !== 'draft') {
      stock = await postLines(tx, id, lines, 1, {
        performedBy: data.received_by ?? current.received_by,
        reason: `Purchase #${id} edited`,
      });
    }

    const purchase = await tx.get(`SELECT * FROM purchases WHERE id = ?`, [id]);
    const expense_id = await syncPurchaseExpense(tx, { ...purchase, payment_method: data.payment_method }, lines);
    return { ...purchase, items: lines, stock, expense_id };
  });
}

/**
 * Void a purchase: reverse the stock, drop the linked expense, keep the
 * header and lines for audit. Preferred over deletion — reversal can floor a
 * shortfall at 0, and the ledger records the variance when it does.
 *
 * ponytail: the reversal restores the quantity but leaves cost_per_unit at
 * whatever the moving average became — un-averaging needs a cost-layer stack
 * (FIFO lots). Each movement still carries the unit_cost it was posted at, so
 * historical valuation stays correct; add layers only if on-hand valuation
 * after a void is ever material.
 */
export async function voidPurchase(db, id, { reason, performedBy } = {}) {
  return db.transaction(async (tx) => {
    const purchase = await tx.get(`SELECT * FROM purchases WHERE id = ?`, [id]);
    if (!purchase) throw new Error('Purchase not found.');
    if (purchase.status === 'voided') throw new Error('This purchase is already voided.');

    const lines = await tx.all(`SELECT * FROM purchase_items WHERE purchase_id = ?`, [id]);
    const stock = await postLines(tx, id, lines, -1, {
      performedBy: performedBy || purchase.received_by,
      reason: reason ? `Purchase voided: ${reason}` : `Purchase #${id} voided`,
    });

    await tx.run(
      `UPDATE purchases SET status = 'voided', void_reason = ?, voided_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [reason || null, id]
    );
    await deleteLinkedExpense(tx, 'purchase', id);

    const updated = await tx.get(`SELECT * FROM purchases WHERE id = ?`, [id]);
    return { ...updated, stock };
  });
}

/**
 * Hard delete — only allowed while nothing has been received, otherwise the
 * caller is told to void instead.
 */
export async function deletePurchase(db, id) {
  const purchase = await db.get(`SELECT * FROM purchases WHERE id = ?`, [id]);
  if (!purchase) throw new Error('Purchase not found.');
  if (purchase.status !== 'draft' && purchase.status !== 'voided') {
    throw new Error('This purchase already moved stock — void it instead of deleting.');
  }
  await db.transaction(async (tx) => {
    await deleteLinkedExpense(tx, 'purchase', id);
    await tx.run(`DELETE FROM purchase_items WHERE purchase_id = ?`, [id]);
    await tx.run(`DELETE FROM purchases WHERE id = ?`, [id]);
  });
  return { id: Number(id), deleted: true };
}

/* --------------------------------------------------------- bulk import */

/**
 * Validate + group flat rows into purchases without writing anything.
 * Rows group by invoice_number (blank invoices become one purchase each).
 * Columns: invoice_number, invoice_date, supplier, item_name, quantity, unit_cost.
 */
export async function previewPurchaseImport(db, rows = []) {
  const items = await db.all(
    `SELECT id, item_name, purchase_unit, consumption_unit, unit, conversion_factor
     FROM inventory_items WHERE COALESCE(is_archived, 0) = 0`
  );
  const byName = new Map(items.map((i) => [normalizeName(i.item_name), i]));

  const groups = new Map();
  const errors = [];

  rows.forEach((row, index) => {
    const rowNo = index + 1;
    const name = String(row.item_name || '').trim();
    const qty = Number(row.quantity);
    const cost = Number(row.unit_cost || 0);

    if (!name) return errors.push({ row: rowNo, field: 'item_name', message: 'Item name is required.', data: row });
    const match = byName.get(normalizeName(name));
    if (!match) return errors.push({ row: rowNo, field: 'item_name', message: `No active inventory item named "${name}".`, data: row });
    if (!Number.isFinite(qty) || qty <= 0) return errors.push({ row: rowNo, field: 'quantity', message: 'Quantity must be a number greater than zero.', data: row });
    if (!Number.isFinite(cost) || cost < 0) return errors.push({ row: rowNo, field: 'unit_cost', message: 'Unit cost must be a non-negative number.', data: row });

    const invoice = String(row.invoice_number || '').trim();
    const key = invoice || `__row_${rowNo}`;
    if (!groups.has(key)) {
      groups.set(key, {
        invoice_number: invoice || null,
        invoice_date: row.invoice_date || null,
        supplier: row.supplier || null,
        items: [],
      });
    }
    groups.get(key).items.push({
      inventory_item_id: match.id,
      item_name: match.item_name,
      quantity_ordered: qty,
      quantity_received: qty,
      unit_cost: cost,
      line_total: qty * cost,
      // purely informational for the preview UI — the ledger does the real
      // conversion when createPurchase posts the line with units:'purchase'.
      converts_to: qty * (Number(match.conversion_factor) > 0 ? Number(match.conversion_factor) : 1),
      purchase_unit: match.purchase_unit || match.unit || null,
      consumption_unit: match.consumption_unit || match.unit || null,
    });
  });

  const purchases = Array.from(groups.values()).map((g) => ({
    ...g,
    subtotal: g.items.reduce((s, l) => s + l.line_total, 0),
  }));

  return {
    ok: errors.length === 0,
    counts: {
      rows: rows.length,
      valid: rows.length - errors.length,
      errors: errors.length,
      purchases: purchases.length,
    },
    purchases,
    errors,
  };
}

/** Commit what previewPurchaseImport() produced. Refuses if any row is invalid. */
export async function commitPurchaseImport(db, rows = [], context = {}) {
  const preview = await previewPurchaseImport(db, rows);
  if (!preview.ok) {
    const err = new Error('Fix the flagged rows before committing the import.');
    err.status = 400;
    err.preview = preview;
    throw err;
  }
  const created = [];
  for (const p of preview.purchases) {
    created.push(await createPurchase(db, { ...p, received_by: context.received_by || null }));
  }
  return { created_count: created.length, purchases: created, preview };
}

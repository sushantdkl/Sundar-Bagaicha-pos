/**
 * Admin Bill Management service for /admin/bills.
 *
 * Read side: list + detail across counter and online bills, with payment/order
 * status kept separate. Write side: reopen reactivates the same order in POS so
 * staff can edit items and settle only the delta. Original payments stay on the
 * bill; supplemental collections post a separate `bill_supplement` journal (never
 * replacing the original sale journal). Reductions refund before totals are lowered.
 */

import { ensureSqliteTable } from '@/lib/db/ensure-sqlite-table.js';
import { calculateBillTotals } from '@/lib/billing-totals.js';
import { nepalDateString } from '@/lib/report-dates.js';
import { postJournal, paymentAccountCode, ensureAccountingSchema } from '@/lib/accounting.js';
import { refundBill, voidPaidBill } from '@/lib/bill-corrections.js';
import { deductStockForItems } from '@/lib/stock.js';
import { collectCreditBalance, ensureSplitPaymentSchema, recordInitialSplitSettlement, validateAllocations } from '@/lib/split-payments.js';
import { snapshotOrderItems, parseJsonField } from '@/lib/reopen-diff.js';
import { currentBusinessDayId } from '@/lib/business-days.js';

const num = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const EPS = 0.01;

const VOID_STATES = ['void', 'voided', 'cancelled', 'canceled'];
const OPEN_STATES = ['open', 'reopened', 'in_progress', 'pending', 'unpaid'];
/** Open floor/table/takeaway orders that may not yet have a bill row. */
const LIVE_ORDER_STATUSES = [
  'pending', 'confirmed', 'preparing', 'cooking', 'ready', 'dining', 'served', 'awaiting_payment',
];

export async function ensureBillsAdminSchema(db) {
  // PostgreSQL schema changes are applied by migrations. Keep the list/detail
  // read paths available during a rolling deploy where application code may be
  // live a few moments before migration 025 has run.
  if (db.driver === 'postgres') {
    const row = await db.get(
      `SELECT to_regclass('public.bill_revisions') AS bill_revisions,
              to_regclass('public.bill_audit') AS bill_audit`
    );
    return Boolean(row?.bill_revisions && row?.bill_audit);
  }

  await ensureSqliteTable(
    db,
    `CREATE TABLE IF NOT EXISTS bill_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      reason TEXT,
      original_snapshot TEXT,
      delta_amount REAL DEFAULT 0,
      supplemental_bill_id INTEGER,
      refund_amount REAL DEFAULT 0,
      revised_snapshot TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      finalized_by INTEGER,
      finalized_at DATETIME
    )`
  );
  // Defensive column add for DBs created before revised_snapshot existed.
  if (db.driver !== 'postgres') {
    try {
      const cols = await db.all(`PRAGMA table_info(bill_revisions)`);
      if (cols.length && !cols.some((c) => c.name === 'revised_snapshot')) {
        await db.run(`ALTER TABLE bill_revisions ADD COLUMN revised_snapshot TEXT`).catch(() => {});
      }
    } catch { /* ignore */ }
  }
  await ensureSqliteTable(
    db,
    `CREATE TABLE IF NOT EXISTS bill_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER,
      revision_id INTEGER,
      event TEXT NOT NULL,
      actor_id INTEGER,
      previous_value TEXT,
      new_value TEXT,
      reason TEXT,
      ref TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );
  // Guard: at most one OPEN revision per bill (optimistic concurrency).
  await ensureSqliteTable(
    db,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_revisions_open
       ON bill_revisions (bill_id) WHERE status = 'open'`
  ).catch(() => {});
  return true;
}

export async function recordAudit(db, { bill_id = null, revision_id = null, event, actor_id = null, previous_value = null, new_value = null, reason = null, ref = null }) {
  const schemaReady = await ensureBillsAdminSchema(db);
  if (!schemaReady) {
    throw Object.assign(new Error('Bill administration schema is not installed. Run database migration 025.'), { status: 503 });
  }
  await db.run(
    `INSERT INTO bill_audit (bill_id, revision_id, event, actor_id, previous_value, new_value, reason, ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      bill_id, revision_id, event, actor_id,
      previous_value == null ? null : JSON.stringify(previous_value),
      new_value == null ? null : JSON.stringify(new_value),
      reason, ref,
    ]
  );
}

function channelOf(orderNumber, orderType, tableNumber) {
  if (String(orderNumber || '').startsWith('WEB-')) return 'online';
  if (!String(tableNumber || '').trim()) return 'takeaway';
  return 'counter';
}

function deriveState(row) {
  const status = String(row.status || (row.is_open_order ? 'open' : 'paid')).toLowerCase();
  const grand = num(row.grand_total);
  const paid = num(row.paid_amount);
  const balance = round2(grand - paid);

  const paymentStatus = paid <= EPS ? 'unpaid' : balance > EPS ? 'partial' : 'paid';
  let tab;
  if (VOID_STATES.includes(status)) {
    return { paymentStatus, billStatus: status, orderStatus: status, balance: 0, tab: 'cancelled' };
  }
  else if (row.is_open_order || OPEN_STATES.includes(status)) tab = 'active';
  else if (balance > EPS || String(row.payment_status || '').toLowerCase() === 'partially_paid') tab = 'pending';
  else tab = 'completed';

  return { paymentStatus, billStatus: status, orderStatus: status, balance, tab };
}

/**
 * List bills with filters. Payment status and order status are independent so a
 * bill only ever falls into one primary tab.
 */
export async function listBills(db, {
  tab = 'all', search = null, channel = null, paymentMethod = null,
  paymentStatus = null, orderStatus = null, from = null, to = null,
  reopened = null, page = 1, pageSize = 25,
} = {}) {
  const schemaReady = await ensureBillsAdminSchema(db);
  const billDate = db.driver === 'postgres'
    ? `(COALESCE(b.paid_at, b.created_at) + INTERVAL '5 hours 45 minutes')::date`
    : `date(COALESCE(b.paid_at, b.created_at), '+5 hours', '+45 minutes')`;
  const orderDate = db.driver === 'postgres'
    ? `(o.created_at + INTERVAL '5 hours 45 minutes')::date`
    : `date(o.created_at, '+5 hours', '+45 minutes')`;

  const where = ['1=1'];
  const params = [];

  if (from) { where.push(`${billDate} >= date(?)`); params.push(from); }
  if (to) { where.push(`${billDate} <= date(?)`); params.push(to); }
  if (channel === 'online') where.push(`COALESCE(o.order_number,'') LIKE 'WEB-%'`);
  else if (channel === 'takeaway') where.push(`COALESCE(o.order_number,'') NOT LIKE 'WEB-%' AND NULLIF(TRIM(COALESCE(o.table_number,'')),'') IS NULL`);
  else if (channel === 'counter') where.push(`COALESCE(o.order_number,'') NOT LIKE 'WEB-%' AND NULLIF(TRIM(COALESCE(o.table_number,'')),'') IS NOT NULL`);
  if (paymentMethod) {
    where.push(`EXISTS (SELECT 1 FROM bill_payments bpf WHERE bpf.bill_id = b.id AND LOWER(bpf.payment_method)=LOWER(?))`);
    params.push(paymentMethod);
  }
  if (orderStatus) { where.push('LOWER(COALESCE(b.status,\'paid\')) = LOWER(?)'); params.push(orderStatus); }
  if (reopened === true) {
    where.push(schemaReady
      ? `(LOWER(COALESCE(b.status,'')) = 'reopened' OR EXISTS (SELECT 1 FROM bill_revisions rv WHERE rv.bill_id = b.id))`
      : `LOWER(COALESCE(b.status,'')) = 'reopened'`);
  }
  if (search) {
    where.push(`(LOWER(COALESCE(b.bill_number,'')) LIKE ? OR LOWER(COALESCE(o.order_number,'')) LIKE ?
                 OR LOWER(COALESCE(o.customer_name,'')) LIKE ? OR COALESCE(o.customer_phone,'') LIKE ?)`);
    const like = `%${String(search).toLowerCase()}%`;
    params.push(like, like, like, `%${search}%`);
  }

  const baseFrom = `
    FROM bills b
    JOIN orders o ON b.order_id = o.id
    LEFT JOIN (SELECT bill_id, SUM(amount) AS paid_amount FROM bill_payments GROUP BY bill_id) p ON p.bill_id = b.id
  `;

  const rows = await db.all(
    `SELECT b.id, b.bill_number, b.grand_total, b.status, b.created_at, b.paid_at,
            b.discount_amount, b.subtotal, b.tax, b.vat_amount, b.service_charge,
            b.payment_status, b.outstanding_amount,
            o.id AS order_id, o.order_number, o.order_type, o.customer_name, o.customer_phone, o.table_number, o.updated_at AS order_updated,
            o.status AS live_order_status,
            COALESCE(p.paid_amount, 0) AS paid_amount,
            ${schemaReady
              ? '(SELECT COUNT(*) FROM bill_revisions rv WHERE rv.bill_id = b.id)'
              : '0'} AS revision_count,
            (SELECT payment_method FROM bill_payments bp2 WHERE bp2.bill_id = b.id ORDER BY bp2.id DESC LIMIT 1) AS last_method,
            (SELECT COUNT(*) FROM order_items oi
              WHERE oi.order_id = o.id AND COALESCE(oi.status,'') NOT IN ('voided','cancelled')) AS item_count,
            (SELECT COALESCE(SUM(
              CASE WHEN (oi.quantity - COALESCE(oi.sent_quantity, 0)) > 0
                   THEN (oi.quantity - COALESCE(oi.sent_quantity, 0)) ELSE 0 END
            ), 0) FROM order_items oi
              WHERE oi.order_id = o.id AND COALESCE(oi.status,'') NOT IN ('voided','cancelled')) AS unsent_count,
            0 AS is_open_order
     ${baseFrom}
     WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(b.paid_at, b.created_at) DESC, b.id DESC`,
    params
  );

  // Active floor orders that do not yet have a bill row (Table POS awaiting
  // payment, preparing, dining, etc.). Always load them for tab counts so the
  // Active badge stays correct even while viewing Completed/Pending/Cancelled.
  let openOrders = [];
  const canIncludeOpenOrders = !paymentMethod && reopened !== true;
  if (canIncludeOpenOrders) {
    const oWhere = [
      `o.status IN (${LIVE_ORDER_STATUSES.map(() => '?').join(',')})`,
      `NOT EXISTS (SELECT 1 FROM bills bx WHERE bx.order_id = o.id)`,
      // Hide empty POS drafts (e.g. takeaway created on open with no items yet).
      `(SELECT COUNT(*) FROM order_items oi
         WHERE oi.order_id = o.id AND COALESCE(oi.status,'') NOT IN ('voided','cancelled')) > 0`,
    ];
    const oParams = [...LIVE_ORDER_STATUSES];
    if (from) { oWhere.push(`${orderDate} >= date(?)`); oParams.push(from); }
    if (to) { oWhere.push(`${orderDate} <= date(?)`); oParams.push(to); }
    if (channel === 'online') oWhere.push(`COALESCE(o.order_number,'') LIKE 'WEB-%'`);
    else if (channel === 'takeaway') oWhere.push(`COALESCE(o.order_number,'') NOT LIKE 'WEB-%' AND NULLIF(TRIM(COALESCE(o.table_number,'')),'') IS NULL`);
    else if (channel === 'counter') oWhere.push(`COALESCE(o.order_number,'') NOT LIKE 'WEB-%' AND NULLIF(TRIM(COALESCE(o.table_number,'')),'') IS NOT NULL`);
    if (search) {
      oWhere.push(`(LOWER(COALESCE(o.order_number,'')) LIKE ? OR LOWER(COALESCE(o.customer_name,'')) LIKE ? OR COALESCE(o.customer_phone,'') LIKE ? OR LOWER(COALESCE(o.table_number,'')) LIKE ?)`);
      const like = `%${String(search).toLowerCase()}%`;
      oParams.push(like, like, `%${search}%`, like);
    }
    openOrders = await db.all(
      `SELECT o.id AS order_id, o.order_number, o.order_type, o.customer_name, o.customer_phone,
              o.table_number, o.created_at, o.updated_at AS order_updated, o.status AS live_order_status,
              (
                SELECT COALESCE(SUM(oi.subtotal), 0) FROM order_items oi
                WHERE oi.order_id = o.id AND COALESCE(oi.status,'') NOT IN ('voided','cancelled')
              ) AS grand_total,
              (
                SELECT COUNT(*) FROM order_items oi
                WHERE oi.order_id = o.id AND COALESCE(oi.status,'') NOT IN ('voided','cancelled')
              ) AS item_count,
              (
                SELECT COALESCE(SUM(
                  CASE WHEN (oi.quantity - COALESCE(oi.sent_quantity, 0)) > 0
                       THEN (oi.quantity - COALESCE(oi.sent_quantity, 0)) ELSE 0 END
                ), 0) FROM order_items oi
                WHERE oi.order_id = o.id AND COALESCE(oi.status,'') NOT IN ('voided','cancelled')
              ) AS unsent_count
       FROM orders o
       WHERE ${oWhere.join(' AND ')}
       ORDER BY o.updated_at DESC, o.id DESC`,
      oParams
    ).catch(() => []);
  }

  const openRows = (openOrders || []).map((o) => ({
    id: `order-${o.order_id}`,
    bill_number: null,
    grand_total: o.grand_total,
    status: o.live_order_status === 'awaiting_payment' ? 'unpaid' : 'open',
    created_at: o.created_at,
    paid_at: null,
    payment_status: 'unpaid',
    outstanding_amount: o.grand_total,
    order_id: o.order_id,
    order_number: o.order_number,
    order_type: o.order_type,
    customer_name: o.customer_name,
    customer_phone: o.customer_phone,
    table_number: o.table_number,
    order_updated: o.order_updated,
    live_order_status: o.live_order_status,
    paid_amount: 0,
    revision_count: 0,
    last_method: null,
    item_count: o.item_count,
    unsent_count: o.unsent_count,
    is_open_order: 1,
  }));

  const displayOpenRows = (!tab || tab === 'all' || tab === 'active') ? openRows : [];
  const allRows = [...displayOpenRows, ...rows];
  const countRows = [...openRows, ...rows];

  let enriched = allRows.map((r) => {
    const st = deriveState(r);
    return {
      id: r.id,
      orderId: r.order_id || null,
      billNumber: r.bill_number,
      orderNumber: r.order_number,
      channel: channelOf(r.order_number, r.order_type, r.table_number),
      customerName: r.customer_name || null,
      customerPhone: r.customer_phone || null,
      tableNumber: r.table_number || null,
      total: round2(r.grand_total),
      paid: round2(r.paid_amount),
      balance: st.balance,
      paymentStatus: st.paymentStatus,
      billStatus: r.is_open_order ? 'open_order' : st.billStatus,
      orderStatus: r.live_order_status || st.orderStatus,
      lastMethod: r.last_method || null,
      createdAt: r.created_at,
      updatedAt: r.paid_at || r.order_updated || r.created_at,
      reopened: num(r.revision_count) > 0 || String(r.status || '').toLowerCase() === 'reopened',
      isOpenOrder: Boolean(r.is_open_order),
      itemCount: num(r.item_count),
      unsentCount: num(r.unsent_count),
      tab: st.tab,
    };
  });

  if (paymentStatus) enriched = enriched.filter((b) => b.paymentStatus === paymentStatus);
  if (tab && tab !== 'all') enriched = enriched.filter((b) => b.tab === tab);

  const counts = { active: 0, pending: 0, completed: 0, cancelled: 0, all: countRows.length };
  for (const r of countRows) counts[deriveState(r).tab] += 1;

  const total = enriched.length;
  const start = (Math.max(1, page) - 1) * pageSize;
  const paged = enriched.slice(start, start + pageSize);

  return { bills: paged, total, page, pageSize, counts };
}

/** Full bill detail including items, payments, revisions and activity. */
export async function getBillDetail(db, id) {
  await ensureBillsAdminSchema(db);
  const b = await db.get(
    `SELECT b.*, o.order_number, o.order_type, o.customer_name, o.customer_phone,
            o.table_id, o.table_number, o.waiter_id, o.notes AS order_notes,
            o.customer_id AS order_customer_id,
            u.full_name AS cashier_name
     FROM bills b
     JOIN orders o ON b.order_id = o.id
     LEFT JOIN users u ON b.cashier_id = u.id
     WHERE b.id = ?`,
    [id]
  );
  if (!b) return null;

  const [items, payments, allocations, revisions, audit, linkedCustomer] = await Promise.all([
    db.all(
      `SELECT oi.*, COALESCE(mi.name, oi.item_name) AS item_name
       FROM order_items oi
       LEFT JOIN menu_items mi ON COALESCE(oi.menu_item_id, oi.item_id) = mi.id
       WHERE oi.order_id = ?`,
      [b.order_id]
    ).catch(() => []),
    db.all('SELECT * FROM bill_payments WHERE bill_id = ? ORDER BY id ASC', [id]).catch(() => []),
    db.all('SELECT * FROM bill_payment_allocations WHERE bill_id = ? ORDER BY id ASC', [id]).catch(() => []),
    db.all('SELECT * FROM bill_revisions WHERE bill_id = ? ORDER BY id DESC', [id]).catch(() => []),
    db.all(
      `SELECT a.*, u.full_name AS actor_name
       FROM bill_audit a LEFT JOIN users u ON a.actor_id = u.id
       WHERE a.bill_id = ? ORDER BY a.id DESC`,
      [id]
    ).catch(() => []),
    b.customer_id
      ? db.get('SELECT id, name, phone, credit_limit, current_credit, is_blacklisted FROM customers WHERE id = ?', [b.customer_id]).catch(() => null)
      : Promise.resolve(null),
  ]);

  const paid = round2((payments || []).reduce((s, p) => s + num(p.amount), 0));
  const st = deriveState({ ...b, paid_amount: paid });

  return {
    id: b.id,
    businessDayId: b.business_day_id || null,
    billNumber: b.bill_number,
    orderId: b.order_id,
    orderNumber: b.order_number,
    channel: channelOf(b.order_number, b.order_type, b.table_number),
    customer: linkedCustomer
      ? {
          id: linkedCustomer.id,
          name: linkedCustomer.name || b.customer_name,
          phone: linkedCustomer.phone || b.customer_phone,
          credit_limit: round2(linkedCustomer.credit_limit),
          current_credit: round2(linkedCustomer.current_credit),
          is_blacklisted: Boolean(linkedCustomer.is_blacklisted),
        }
      : (b.customer_name ? { id: null, name: b.customer_name, phone: b.customer_phone } : null),
    legacy: {
      tableId: b.table_id || null,
      tableNumber: b.table_number || null,
      waiterId: b.waiter_id || null,
      cashierName: b.cashier_name || null,
      orderType: b.order_type || null,
      orderCustomerId: b.order_customer_id || null,
    },
    totals: {
      subtotal: round2(b.subtotal), discount: round2(b.discount_amount),
      tax: round2(b.tax ?? b.vat_amount), serviceCharge: round2(b.service_charge),
      deliveryFee: round2(b.delivery_fee),
      grandTotal: round2(b.grand_total), paid, balance: st.balance,
    },
    paymentStatus: st.paymentStatus,
    billStatus: st.billStatus,
    orderStatus: st.orderStatus,
    tab: st.tab,
    voided: {
      reason: b.void_reason || null,
      at: b.voided_at || null,
    },
    createdAt: b.created_at,
    paidAt: b.paid_at,
    items: (items || []).map((i) => ({
      menuItemId: i.menu_item_id ?? i.item_id ?? null,
      name: i.item_name, variant: i.variant_name || null,
      quantity: num(i.quantity), unitPrice: round2(i.price ?? i.unit_price),
      total: round2(i.subtotal ?? (num(i.price ?? i.unit_price) * num(i.quantity))),
      status: i.status || null,
    })),
    payments: (payments || []).map((p) => ({
      id: p.id, method: p.payment_method, amount: round2(p.amount),
      provider: p.provider || null, reference: p.reference_number || null,
      verificationStatus: p.verification_status || null, settlementStatus: p.settlement_status || null,
      createdAt: p.created_at,
    })),
    allocations: (allocations || []).map((p) => ({
      id: p.id, method: p.method, amount: round2(p.amount), provider: p.provider || null,
      reference: p.reference_number || null, dueDate: p.due_date || null,
      verificationStatus: p.verification_status || null, settlementStatus: p.settlement_status || null,
      createdAt: p.created_at,
    })),
    revisions: (revisions || []).map((r) => ({
      id: r.id, status: r.status, reason: r.reason, deltaAmount: round2(r.delta_amount),
      refundAmount: round2(r.refund_amount), supplementalBillId: r.supplemental_bill_id,
      createdBy: r.created_by, createdAt: r.created_at, finalizedAt: r.finalized_at,
    })),
    activity: (audit || []).map((a) => ({
      id: a.id, event: a.event, actor: a.actor_name || null, reason: a.reason || null,
      previousValue: parseJsonField(a.previous_value),
      newValue: parseJsonField(a.new_value),
      ref: a.ref || null, createdAt: a.created_at,
    })),
    canReopen: (st.tab === 'completed' || String(b.status || '').toLowerCase() === 'reopened')
      && !VOID_STATES.includes(st.orderStatus),
  };
}

/**
 * Reopen a completed bill back into the SAME order in POS, with all previous
 * items loaded for editing. NON-DESTRUCTIVE of accounting history: the original
 * paid invoice is marked `reopened` (still visible) and checkout only settles
 * the difference vs what was already paid.
 */
export async function reopenBill(db, { billId, reason, actorId = null }) {
  await ensureBillsAdminSchema(db);
  if (!reason || !String(reason).trim()) {
    throw Object.assign(new Error('A reason is required to reopen a bill.'), { status: 400 });
  }

  const detail = await getBillDetail(db, billId);
  if (!detail) throw Object.assign(new Error('Bill not found.'), { status: 404 });
  const businessDayId = await currentBusinessDayId(db, { required: true, allowStale: true });
  if (Number(detail.businessDayId || detail.raw?.business_day_id || 0) !== Number(businessDayId)) {
    throw Object.assign(new Error('A bill from a closed business day cannot be reopened in normal operation.'), { status: 409 });
  }
  if (VOID_STATES.includes(detail.orderStatus)) {
    throw Object.assign(new Error('A voided or cancelled bill cannot be reopened — create a new order instead.'), { status: 409 });
  }

  const orderId = detail.orderId;
  if (!orderId) throw Object.assign(new Error('This bill has no linked order.'), { status: 409 });

  const trimmedReason = String(reason).trim();
  const tableId = detail.legacy?.tableId ? Number(detail.legacy.tableId) : null;
  const order = await db.get('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order) throw Object.assign(new Error('Linked order not found.'), { status: 404 });

  const billRow = await db.get('SELECT id, status, grand_total FROM bills WHERE id = ?', [billId]);
  const billStatus = String(billRow?.status || '').toLowerCase();
  const alreadyReopened = billStatus === 'reopened';
  const orderLive = !['completed', 'cancelled'].includes(String(order.status || ''));

  const itemRows = await db.all(
    `SELECT oi.*, COALESCE(mi.name, oi.item_name) AS item_name
     FROM order_items oi
     LEFT JOIN menu_items mi ON COALESCE(oi.menu_item_id, oi.item_id) = mi.id
     WHERE oi.order_id = ? AND COALESCE(oi.status,'') NOT IN ('voided','cancelled')
     ORDER BY oi.id`,
    [orderId]
  ).catch(() => []);
  const itemsSnapshot = snapshotOrderItems(itemRows);

  // Already reopened and live → just send staff back to POS with the same cart.
  if (alreadyReopened && orderLive) {
    if (tableId) {
      await db.run(
        `UPDATE tables SET current_order_id = ?, status = 'dining', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [orderId, tableId]
      );
    }
    await recordAudit(db, {
      bill_id: billId, event: 'bill_reopened_to_pos', actor_id: actorId, reason: trimmedReason,
      new_value: { orderId, orderNumber: order.order_number, resumed: true, items: itemsSnapshot },
      ref: `order:${orderId}`,
    });
    return {
      orderId,
      orderNumber: order.order_number,
      resumed: true,
      posPath: `/admin/pos?order=${orderId}`,
      bill: detail,
    };
  }

  if (detail.tab !== 'completed') {
    throw Object.assign(new Error('Only a completed, fully-settled bill can be reopened.'), { status: 409 });
  }

  await db.transaction(async (tx) => {
    await tx.run(
      `UPDATE orders SET status = 'dining', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [orderId]
    );
    await tx.run(
      `UPDATE bills SET status = 'reopened', payment_status = COALESCE(payment_status, 'paid') WHERE id = ?`,
      [billId]
    );
    // Keep previously sent lines as sent so Print KOT only covers NEW items.
    // Editing of sent lines is allowed while the bill stays `reopened` (items API).
    if (tableId) {
      await tx.run(
        `UPDATE orders SET status = 'cancelled',
            notes = COALESCE(notes, '') || ' | Auto-cancelled: original bill reopened on this table',
            updated_at = CURRENT_TIMESTAMP
         WHERE table_id = ? AND id != ? AND status NOT IN ('completed','cancelled')`,
        [tableId, orderId]
      );
      await tx.run(
        `UPDATE tables SET current_order_id = ?, status = 'dining', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [orderId, tableId]
      );
    }
  });

  await recordAudit(db, {
    bill_id: billId, event: 'bill_reopened_to_pos', actor_id: actorId, reason: trimmedReason,
    previous_value: { orderStatus: order.status, billStatus: 'paid', items: itemsSnapshot },
    new_value: { orderId, orderNumber: order.order_number, orderStatus: 'dining', billStatus: 'reopened', items: itemsSnapshot },
    ref: `order:${orderId}`,
  });

  return {
    orderId,
    orderNumber: order.order_number,
    resumed: false,
    posPath: `/admin/pos?order=${orderId}`,
    bill: await getBillDetail(db, billId),
  };
}

/**
 * Finalize a reopened revision. Recomputes the revised grand total server-side
 * from the submitted items (using the ORIGINAL bill's tax/service/discount rates
 * so the math cannot be tampered with client-side), then determines the
 * financial treatment. The ORIGINAL invoice is never mutated. Money movement is
 * intentionally delegated to the existing refund / payment workflows — this
 * function records the outcome + delta once and audits it.
 *
 *   newTotal > original → 'supplement_due'  (collect only the additional amount)
 *   newTotal < original → 'refund_due'       (use the refund/credit workflow)
 *   newTotal = original → 'no_change'
 */
export async function finalizeRevision(db, { billId, revisionId, items = null, actorId = null, reason = null }) {
  await ensureBillsAdminSchema(db);
  const rev = await db.get(`SELECT * FROM bill_revisions WHERE id = ? AND bill_id = ?`, [revisionId, billId]);
  if (!rev) throw Object.assign(new Error('Revision not found.'), { status: 404 });
  if (rev.status !== 'open') throw Object.assign(new Error('This revision is no longer open.'), { status: 409 });

  const original = await db.get(
    `SELECT grand_total, subtotal, discount_amount, tax_percent, service_charge_percent, delivery_fee FROM bills WHERE id = ?`,
    [billId]
  );
  if (!original) throw Object.assign(new Error('Bill not found.'), { status: 404 });

  const snapshot = JSON.parse(rev.original_snapshot || '{}');
  const revisedItems = Array.isArray(items) && items.length ? items : (snapshot.items || []);
  const newSubtotal = round2(revisedItems.reduce((s, i) => s + num(i.total ?? (num(i.unitPrice) * num(i.quantity))), 0));

  const totals = calculateBillTotals(newSubtotal, {
    discountAmount: num(original.discount_amount) || undefined,
    vatPercent: num(original.tax_percent),
    servicePercent: num(original.service_charge_percent),
    deliveryFee: num(original.delivery_fee),
  });
  const newTotal = round2(totals.total);
  const originalTotal = round2(original.grand_total);
  const delta = round2(newTotal - originalTotal);

  let treatment;
  let status;
  if (delta > EPS) { treatment = 'supplement_due'; status = 'awaiting_supplement'; }
  else if (delta < -EPS) { treatment = 'refund_due'; status = 'awaiting_refund'; }
  else { treatment = 'no_change'; status = 'finalized'; }

  await db.run(
    `UPDATE bill_revisions
       SET status = ?, delta_amount = ?, refund_amount = ?, revised_snapshot = ?, finalized_by = ?, finalized_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [status, delta, delta < 0 ? -delta : 0, JSON.stringify(revisedItems), actorId, revisionId]
  );

  await recordAudit(db, {
    bill_id: billId, revision_id: revisionId,
    event: treatment === 'no_change' ? 'revision_finalized' : `revision_${treatment}`,
    actor_id: actorId, reason,
    previous_value: { grandTotal: originalTotal },
    new_value: { grandTotal: newTotal, delta, treatment },
    ref: `revision:${revisionId}`,
  });

  return {
    revisionId, treatment, status,
    originalTotal, newTotal, delta,
    additionalDue: delta > 0 ? delta : 0,
    refundDue: delta < 0 ? -delta : 0,
    // The original invoice is untouched; act on the delta via the existing flows.
    nextAction:
      treatment === 'supplement_due'
        ? 'Collect the additional amount as a linked supplemental payment.'
        : treatment === 'refund_due'
          ? 'Process the difference through the existing refund / credit-note workflow.'
          : 'No financial change — revision recorded.',
  };
}

/**
 * Ensure the columns/tables the refund path needs exist on older SQLite dev DBs
 * (production gets these from migration 023). No-op on Postgres.
 */
async function ensureRefundSchema(db) {
  if (db.driver === 'postgres') return;
  try {
    const cols = await db.all(`PRAGMA table_info(bills)`);
    if (!cols.some((c) => c.name === 'refunded_amount')) {
      await db.run(`ALTER TABLE bills ADD COLUMN refunded_amount REAL DEFAULT 0`).catch(() => {});
    }
  } catch { /* ignore */ }
  await ensureSqliteTable(
    db,
    `CREATE TABLE IF NOT EXISTS bill_corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      reason TEXT,
      journal_id INTEGER,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );
}

/**
 * Positive per-item quantity increases between the original snapshot and the
 * revised items, as deduction input [{ menu_item_id, quantity, item_name }].
 * Items new to the revision count their full quantity. Used to consume stock
 * for exactly the items added during a reopen — nothing that was already sold.
 */
function addedItemDeltas(rev) {
  let original = [];
  let revised = [];
  try { original = (JSON.parse(rev.original_snapshot || '{}').items) || []; } catch { original = []; }
  try { revised = JSON.parse(rev.revised_snapshot || '[]') || []; } catch { revised = []; }
  const keyOf = (i) => `${i.menuItemId ?? i.menu_item_id ?? i.name}|${i.variant || ''}`;
  const origQty = new Map();
  for (const i of original) origQty.set(keyOf(i), (origQty.get(keyOf(i)) || 0) + num(i.quantity));
  const out = [];
  for (const i of revised) {
    const before = origQty.get(keyOf(i)) || 0;
    const delta = num(i.quantity) - before;
    if (delta > 0) {
      out.push({ menu_item_id: i.menuItemId ?? i.menu_item_id ?? null, quantity: delta, item_name: i.name });
    }
  }
  return out;
}

/**
 * Settle a finalized revision's financial difference by reusing the EXISTING
 * services — never a new accounting engine, and never a rewrite of the original
 * invoice:
 *   supplement_due → create a linked supplemental bill + collect only the delta
 *                    + post ONE sale journal (postSaleJournal) for the delta.
 *   refund_due     → route the difference through refundBill (books the reversal
 *                    + a bill_corrections record against the original bill).
 * Idempotent: a revision can only be settled once (status gate + transition).
 */
export async function applyRevisionSettlement(db, {
  billId, revisionId, method = 'cash', reference = null, allocations: requestedAllocations = null,
  requestKey = null, actorId = null, actorRole = 'admin', reason = null,
}) {
  await ensureBillsAdminSchema(db);
  await ensureAccountingSchema(db);
  await ensureSplitPaymentSchema(db);

  const rev = await db.get(`SELECT * FROM bill_revisions WHERE id = ? AND bill_id = ?`, [revisionId, billId]);
  if (!rev) throw Object.assign(new Error('Revision not found.'), { status: 404 });
  if (rev.status === 'finalized') throw Object.assign(new Error('This revision is already settled.'), { status: 409 });
  if (!['awaiting_supplement', 'awaiting_refund'].includes(rev.status)) {
    throw Object.assign(new Error('This revision has no financial difference to settle.'), { status: 409 });
  }

  const orig = await db.get(`SELECT * FROM bills WHERE id = ?`, [billId]);
  if (!orig) throw Object.assign(new Error('Bill not found.'), { status: 404 });
  // ---- Higher total: supplemental bill + delta revenue -------------------
  if (rev.status === 'awaiting_supplement') {
    const delta = round2(rev.delta_amount);
    if (!(delta > EPS)) throw Object.assign(new Error('No additional amount is due.'), { status: 409 });
    const customer = orig.customer_id ? await db.get('SELECT * FROM customers WHERE id=?', [orig.customer_id]) : null;
    const rawAllocations = Array.isArray(requestedAllocations) && requestedAllocations.length
      ? requestedAllocations
      : [{ method, amount: delta, cash_tendered: method === 'cash' ? delta : undefined, reference }];
    const allocations = validateAllocations(rawAllocations, delta, { customer, allowCredit: true, actorRole });
    const settlementKey = String(requestKey || `revision-${revisionId}`).slice(0, 100);

    const result = await db.transaction(async (tx) => {
      const businessDayId = await currentBusinessDayId(tx, { required: true, allowStale: true });
      // Concurrency: re-check the revision is still awaiting inside the txn.
      const cur = await tx.get(`SELECT status FROM bill_revisions WHERE id = ?`, [revisionId]);
      if (cur?.status !== 'awaiting_supplement') {
        throw Object.assign(new Error('This revision was already settled.'), { status: 409 });
      }
      const suppNumber = `${orig.bill_number}-R${revisionId}`;
      const ins = await tx.run(
        `INSERT INTO bills (bill_number, order_id, customer_id, subtotal, tax, vat_amount, service_charge,
           discount_amount, grand_total, status, payment_status, outstanding_amount, idempotency_key, business_day_id, created_at)
         VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, 'unpaid', 'unpaid', ?, ?, ?, CURRENT_TIMESTAMP)`,
        [suppNumber, orig.order_id, orig.customer_id || null, delta, delta, delta, settlementKey, businessDayId]
      );
      const suppId = ins.lastInsertRowid;
      const payment = await recordInitialSplitSettlement(tx, {
        billId: suppId, billNumber: suppNumber, total: delta, tax: 0, allocations,
        customer, actorId, requestKey: settlementKey, businessDayId,
      });

      // Consume inventory for the ADDED items only — same periodic-COGS
      // mechanism the original sale uses (deductStockForItems). This posts the
      // additional cost/inventory exactly once, alongside the delta revenue.
      const added = addedItemDeltas(rev);
      let stockWarnings = [];
      if (added.length) {
        try {
          const res = await deductStockForItems(tx, added, { orderId: orig.order_id, performedBy: actorId });
          stockWarnings = res?.warnings || [];
        } catch {
          // Never let an inventory hiccup roll back a settled payment; surface a warning instead.
          stockWarnings = ['Added-item stock could not be deducted automatically — adjust stock manually.'];
        }
      }

      await tx.run(
        `UPDATE bill_revisions SET status = 'finalized', supplemental_bill_id = ?, finalized_by = ?, finalized_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [suppId, actorId, revisionId]
      );
      return { suppId, suppNumber, payment, stockWarnings, addedCount: added.length };
    });

    await recordAudit(db, {
      bill_id: billId, revision_id: revisionId, event: 'payment_added', actor_id: actorId, reason,
      new_value: { supplementalBillId: result.suppId, amount: round2(rev.delta_amount), allocations: result.payment.allocations },
      ref: `supplemental_bill:${result.suppId}`,
    });
    await recordAudit(db, {
      bill_id: billId, revision_id: revisionId, event: 'revision_finalized', actor_id: actorId,
      new_value: { treatment: 'supplement_collected', supplementalBillId: result.suppId },
      ref: `revision:${revisionId}`,
    });
    return {
      treatment: 'supplement_collected', additionalCollected: round2(rev.delta_amount),
      supplementalBillId: result.suppId, supplementalBillNumber: result.suppNumber,
      payment: result.payment,
      stockDeductedForItems: result.addedCount, warnings: result.stockWarnings || [],
    };
  }

  // ---- Lower total: refund the difference via the existing workflow -------
  await ensureRefundSchema(db);
  const refundDue = round2(rev.refund_amount || -rev.delta_amount);
  if (!(refundDue > EPS)) throw Object.assign(new Error('No refund is due.'), { status: 409 });

  const refundRes = await refundBill(db, {
    bill_id: billId, amount: refundDue, method,
    reason: reason || 'Reopen — items removed', created_by: actorId,
  });
  await db.run(
    `UPDATE bill_revisions SET status = 'finalized', refund_amount = ?, finalized_by = ?, finalized_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [refundDue, actorId, revisionId]
  );
  await recordAudit(db, {
    bill_id: billId, revision_id: revisionId, event: 'refund_created', actor_id: actorId, reason,
    new_value: { amount: refundDue, method, journalId: refundRes?.journal_id ?? null },
    ref: `refund:${refundRes?.journal_id ?? ''}`,
  });
  await recordAudit(db, {
    bill_id: billId, revision_id: revisionId, event: 'revision_finalized', actor_id: actorId,
    new_value: { treatment: 'refund_issued', amount: refundDue }, ref: `revision:${revisionId}`,
  });
  return { treatment: 'refund_issued', refundIssued: refundDue };
}

/** Ensure void-related columns exist on older SQLite dev DBs. No-op on Postgres. */
async function ensureVoidSchema(db) {
  if (db.driver === 'postgres') return;
  try {
    const cols = await db.all(`PRAGMA table_info(bills)`);
    if (cols.length && !cols.some((c) => c.name === 'void_reason')) {
      await db.run(`ALTER TABLE bills ADD COLUMN void_reason TEXT`).catch(() => {});
    }
    if (cols.length && !cols.some((c) => c.name === 'voided_at')) {
      await db.run(`ALTER TABLE bills ADD COLUMN voided_at DATETIME`).catch(() => {});
    }
    const cc = await db.all(`PRAGMA table_info(bill_corrections)`).catch(() => []);
    if (cc.length && !cc.some((c) => c.name === 'restocked')) {
      await db.run(`ALTER TABLE bill_corrections ADD COLUMN restocked INTEGER DEFAULT 0`).catch(() => {});
    }
  } catch { /* ignore */ }
}

/** Void a bill via the existing correction engine (reverses the sale journal, restocks). */
export async function voidBillAdmin(db, { billId, reason, restock = true, actorId = null }) {
  if (!reason || !String(reason).trim()) throw Object.assign(new Error('A reason is required to void a bill.'), { status: 400 });
  await ensureBillsAdminSchema(db);
  await ensureRefundSchema(db);
  await ensureVoidSchema(db);
  const before = await db.get(`SELECT status FROM bills WHERE id = ?`, [billId]);
  if (!before) throw Object.assign(new Error('Bill not found.'), { status: 404 });
  const result = await voidPaidBill(db, { bill_id: billId, reason: String(reason).trim(), restock, created_by: actorId });
  await recordAudit(db, {
    bill_id: billId, event: 'bill_voided', actor_id: actorId, reason: String(reason).trim(),
    previous_value: { status: before.status }, new_value: { status: 'voided', restocked: result.restocked },
    ref: `journal:${result.journal_id ?? ''}`,
  });
  return result;
}

/** Standalone refund of a served bill via the existing refund engine. */
export async function refundBillAdmin(db, { billId, amount, full = false, method = 'cash', reason, actorId = null }) {
  if (!reason || !String(reason).trim()) throw Object.assign(new Error('A reason is required to refund.'), { status: 400 });
  await ensureBillsAdminSchema(db);
  await ensureRefundSchema(db);
  const res = await refundBill(db, { bill_id: billId, amount, full, method, reason: String(reason).trim(), created_by: actorId });
  await recordAudit(db, {
    bill_id: billId, event: 'refund_created', actor_id: actorId, reason: String(reason).trim(),
    new_value: { amount: res.amount, method, journalId: res.journal_id }, ref: `refund:${res.journal_id ?? ''}`,
  });
  return res;
}

/**
 * Complete payment on a pending/partially-paid bill. Records the payment and
 * recognises the collected remainder as revenue via a SEPARATE journal (unique
 * external_ref), so it never replaces the original sale journal.
 */
export async function completeBillPayment(db, {
  billId, amount, method = 'cash', reference = null, allocations = null,
  requestKey = null, actorId = null, actorRole = 'admin', verified = false, provider = null,
}) {
  await ensureBillsAdminSchema(db);
  await ensureAccountingSchema(db);
  const bill = await db.get(`SELECT * FROM bills WHERE id = ?`, [billId]);
  if (!bill) throw Object.assign(new Error('Bill not found.'), { status: 404 });
  if (VOID_STATES.includes(String(bill.status || '').toLowerCase())) {
    throw Object.assign(new Error('A voided bill cannot take payment.'), { status: 409 });
  }
  if (num(bill.outstanding_amount) > EPS) {
    const key = requestKey || `credit-collection-${billId}-${Date.now()}`;
    const rows = Array.isArray(allocations) && allocations.length
      ? allocations
      : [{ method, amount: amount ?? bill.outstanding_amount, cash_tendered: method === 'cash' ? (amount ?? bill.outstanding_amount) : undefined, reference, provider, verified }];
    const collection = await collectCreditBalance(db, { billId, allocations: rows, actorId, actorRole, requestKey: key });
    await recordAudit(db, {
      bill_id: billId, event: 'credit_collected', actor_id: actorId,
      previous_value: { outstanding: num(bill.outstanding_amount) },
      new_value: { collected: collection.collected, outstanding: collection.outstanding, allocations: collection.allocations },
      ref: `credit_collection:${key}`,
    });
    return { collected: collection.collected, remainingBalance: collection.outstanding, fullyPaid: collection.outstanding <= EPS, allocations: collection.allocations, idempotent: collection.idempotent };
  }
  const paidRow = await db.get(`SELECT COALESCE(SUM(amount),0) AS s FROM bill_payments WHERE bill_id = ?`, [billId]);
  const balance = round2(num(bill.grand_total) - num(paidRow.s));
  if (balance <= EPS) throw Object.assign(new Error('This bill is already fully paid.'), { status: 409 });
  const amt = amount == null ? balance : round2(amount);
  if (!(amt > 0)) throw Object.assign(new Error('Payment amount must be greater than zero.'), { status: 400 });
  if (amt > balance + EPS) throw Object.assign(new Error(`Only ${balance} is outstanding on this bill.`), { status: 400 });

  const entryDate = nepalDateString(new Date());
  const result = await db.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO bill_payments (bill_id, amount, payment_method, reference_number) VALUES (?, ?, ?, ?)`,
      [billId, amt, method, reference]
    );
    const journalId = await postJournal(tx, {
      entry_date: entryDate,
      memo: `Payment on bill ${bill.bill_number}`,
      source_type: 'bill_payment',
      source_id: billId,
      external_ref: `bill_payment:${billId}:${Date.now()}`,
      created_by: actorId,
      lines: [
        { code: paymentAccountCode(method), debit: amt, credit: 0, memo: `${method} payment` },
        { code: '4010', debit: 0, credit: amt, memo: 'Sales revenue (collection)' },
      ],
    });
    const newBalance = round2(balance - amt);
    if (newBalance <= EPS) {
      await tx.run(`UPDATE bills SET status = 'paid', paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP) WHERE id = ?`, [billId]);
    }
    return { journalId, newBalance };
  });

  await recordAudit(db, {
    bill_id: billId, event: 'payment_completed', actor_id: actorId,
    previous_value: { balance }, new_value: { collected: amt, method, remainingBalance: result.newBalance },
    ref: `journal:${result.journalId ?? ''}`,
  });
  return { collected: amt, remainingBalance: result.newBalance, fullyPaid: result.newBalance <= EPS };
}

/** Record a receipt (re)print for the audit trail. */
export async function logReceiptReprint(db, { billId, kind = 'final', actorId = null }) {
  await ensureBillsAdminSchema(db);
  await recordAudit(db, { bill_id: billId, event: 'receipt_reprinted', actor_id: actorId, new_value: { kind } });
  return { logged: true, kind };
}

/**
 * Fix customer / payment method on an already-settled bill without reopening
 * the cart. Replaces payment rows for display + reports; does not rewrite the
 * original sale journal (audit trail records the change).
 */
export async function reviseBillSettlement(db, {
  billId,
  reason,
  allocations: rawAllocations = null,
  customerId = null,
  customerName = null,
  customerPhone = null,
  actorId = null,
  actorRole = 'admin',
}) {
  await ensureBillsAdminSchema(db);
  await ensureSplitPaymentSchema(db);
  if (!reason || !String(reason).trim()) {
    throw Object.assign(new Error('A reason is required to edit settlement details.'), { status: 400 });
  }

  const bill = await db.get('SELECT * FROM bills WHERE id = ?', [billId]);
  if (!bill) throw Object.assign(new Error('Bill not found.'), { status: 404 });
  if (VOID_STATES.includes(String(bill.status || '').toLowerCase())) {
    throw Object.assign(new Error('A voided bill cannot be edited.'), { status: 409 });
  }

  const order = bill.order_id
    ? await db.get('SELECT * FROM orders WHERE id = ?', [bill.order_id])
    : null;

  let customer = null;
  if (customerId) {
    customer = await db.get(
      'SELECT id, name, phone, credit_limit, current_credit, is_blacklisted FROM customers WHERE id = ?',
      [customerId]
    );
    if (!customer) throw Object.assign(new Error('Customer not found.'), { status: 404 });
  }

  const paidRow = await db.get(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM bill_payments WHERE bill_id = ?`,
    [billId]
  ).catch(() => ({ s: bill.grand_total }));
  const settleTotal = round2(Math.max(num(paidRow?.s), num(bill.grand_total) - num(bill.outstanding_amount), 0));
  if (settleTotal <= EPS && Array.isArray(rawAllocations) && rawAllocations.length) {
    throw Object.assign(new Error('This bill has no recorded payment amount to revise.'), { status: 409 });
  }

  let allocations = null;
  if (Array.isArray(rawAllocations) && rawAllocations.length) {
    allocations = validateAllocations(rawAllocations, settleTotal, {
      customer,
      allowCredit: true,
      actorRole,
    });
  }

  const prevPayments = await db.all(
    `SELECT payment_method AS method, amount, provider, reference_number AS reference
     FROM bill_payments WHERE bill_id = ? ORDER BY id`,
    [billId]
  ).catch(() => []);

  const primaryMethod = (() => {
    if (!allocations?.length) return null;
    const sorted = [...allocations].sort((a, b) => b.cents - a.cents);
    const top = sorted[0];
    if (top.method === 'qr' && top.provider) return String(top.provider).toLowerCase();
    return top.method;
  })();

  await db.transaction(async (tx) => {
    if (customer || customerName || customerPhone) {
      await tx.run(
        `UPDATE bills SET customer_id = COALESCE(?, customer_id) WHERE id = ?`,
        [customer?.id || customerId || null, billId]
      );
      if (order) {
        await tx.run(
          `UPDATE orders SET
             customer_id = COALESCE(?, customer_id),
             customer_name = COALESCE(?, customer_name),
             customer_phone = COALESCE(?, customer_phone),
             updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [
            customer?.id || customerId || null,
            customer?.name || customerName || null,
            customer?.phone || customerPhone || null,
            order.id,
          ]
        );
      }
    }

    if (allocations) {
      await tx.run('DELETE FROM bill_payment_allocations WHERE bill_id = ?', [billId]).catch(() => {});
      await tx.run('DELETE FROM bill_payments WHERE bill_id = ?', [billId]).catch(() => {});

      for (let i = 0; i < allocations.length; i += 1) {
        const a = allocations[i];
        if (a.method === 'credit') {
          await tx.run(
            `INSERT INTO bill_payment_allocations
               (bill_id, payment_id, method, amount, provider, reference_number,
                verification_status, settlement_status, customer_id, due_date, notes, created_by, idempotency_key)
             VALUES (?, NULL, 'credit', ?, NULL, NULL, 'not_required', 'outstanding', ?, ?, ?, ?, ?)`,
            [
              billId, a.amount, customer?.id || null, a.dueDate,
              a.notes, actorId, `revise:${billId}:${i}:${Date.now()}`,
            ]
          ).catch(() => {});
          continue;
        }

        const pay = await tx.run(
          `INSERT INTO bill_payments
             (bill_id, amount, payment_method, reference_number, provider,
              verification_status, settlement_status, customer_id, notes,
              cash_tendered, change_amount, idempotency_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'received', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [
            billId, a.amount, a.method, a.reference, a.provider,
            a.method === 'qr' ? 'verified' : 'not_required',
            customer?.id || null, a.notes,
            a.cashTendered || null, a.change || 0,
            `revise:${billId}:${i}:${Date.now()}`,
          ]
        );
        const paymentId = pay.lastInsertRowid;
        await tx.run(
          `INSERT INTO bill_payment_allocations
             (bill_id, payment_id, method, amount, provider, reference_number,
              verification_status, settlement_status, customer_id, due_date, notes, created_by, idempotency_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'received', ?, ?, ?, ?, ?)`,
          [
            billId, paymentId, a.method, a.amount, a.provider, a.reference,
            a.method === 'qr' ? 'verified' : 'not_required',
            customer?.id || null, a.dueDate, a.notes, actorId,
            `revise-alloc:${billId}:${i}:${Date.now()}`,
          ]
        ).catch(() => {});
      }

      const creditCents = allocations.filter((a) => a.method === 'credit').reduce((s, a) => s + a.cents, 0);
      const outstanding = round2(creditCents / 100);
      const status = outstanding > EPS ? 'partially_paid' : 'paid';
      await tx.run(
        `UPDATE bills SET payment_status = ?, outstanding_amount = ?, status = ?,
           paid_at = CASE WHEN ? <= 0.009 THEN COALESCE(paid_at, CURRENT_TIMESTAMP) ELSE paid_at END
         WHERE id = ?`,
        [status, outstanding, status === 'paid' ? 'paid' : bill.status, outstanding, billId]
      );

      if (order && primaryMethod) {
        await tx.run(
          `UPDATE orders SET payment_method = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [primaryMethod, order.id]
        ).catch(() => {});
      }
    }
  });

  await recordAudit(db, {
    bill_id: billId,
    event: 'settlement_revised',
    actor_id: actorId,
    reason: String(reason).trim(),
    previous_value: {
      payments: prevPayments,
      customer_id: bill.customer_id,
      customer_name: order?.customer_name || null,
    },
    new_value: {
      allocations: allocations?.map((a) => ({
        method: a.method, amount: a.amount, provider: a.provider || null,
      })) || null,
      customer_id: customer?.id || customerId || bill.customer_id,
      customer_name: customer?.name || customerName || order?.customer_name || null,
    },
  });

  return { revised: true, bill: await getBillDetail(db, billId) };
}

export async function cancelRevision(db, { billId, revisionId, actorId = null, reason = 'Reopen discarded' }) {
  await ensureBillsAdminSchema(db);
  const rev = await db.get(`SELECT * FROM bill_revisions WHERE id = ? AND bill_id = ?`, [revisionId, billId]);
  if (!rev) throw Object.assign(new Error('Revision not found.'), { status: 404 });
  if (rev.status !== 'open') throw Object.assign(new Error('Only an open revision can be discarded.'), { status: 409 });
  await db.run(`UPDATE bill_revisions SET status = 'cancelled', finalized_at = CURRENT_TIMESTAMP, finalized_by = ? WHERE id = ?`, [actorId, revisionId]);
  await recordAudit(db, { bill_id: billId, revision_id: revisionId, event: 'revision_cancelled', actor_id: actorId, reason });
  return { cancelled: true };
}

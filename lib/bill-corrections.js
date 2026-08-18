/**
 * Operational refund & void for bills. Orchestrates the pieces that already
 * exist — reuses the accounting engine (reverseJournal / refund), the order
 * workflow (order status + table release) and inventory (restoreStockForItems).
 * No accounting logic is re-implemented here.
 *
 *   voidPaidBill  — reverses the whole sale journal (payment + revenue + tax),
 *                   marks the bill voided, cancels the order, frees the table,
 *                   and (by default) restocks. A void = the sale never happened.
 *   refundBill    — returns money for a served bill: Dr Sales / Cr the medium,
 *                   partial or full, over-refund prevented. Stock stays consumed.
 *
 * Everything runs in one transaction and is written to bill_corrections for a
 * complete audit trail. Nothing historical is deleted.
 */

import { ensureAccountingSchema } from './accounting.js';
import { reverseJournal, refund } from './accounting-corrections.js';
import { currentBusinessDayId } from './business-days.js';
import { ensureSqliteTable } from './db/ensure-sqlite-table.js';
import { ensureColumn, serialPkSql } from './db/schema-helpers.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const bad = (m) => Object.assign(new Error(m), { status: 400 });
const conflict = (m) => Object.assign(new Error(m), { status: 409 });

async function ensureBillCorrectionsSchema(db) {
  if (db.driver === 'postgres') return;
  const pk = serialPkSql(db);
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS bill_corrections (
    ${pk}, bill_id INTEGER NOT NULL, type TEXT NOT NULL, amount REAL NOT NULL,
    reason TEXT NOT NULL, restocked INTEGER DEFAULT 0, journal_id INTEGER,
    created_by INTEGER, business_day_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await ensureColumn(db, 'bill_corrections', 'business_day_id', 'INTEGER');
  await ensureColumn(db, 'bills', 'refunded_amount', 'REAL DEFAULT 0');
  await ensureColumn(db, 'bills', 'void_reason', 'TEXT');
  await ensureColumn(db, 'bills', 'voided_at', 'DATETIME');
}

async function loadBill(db, bill_id, bill_number) {
  let bill = null;
  if (bill_id) bill = await db.get(`SELECT * FROM bills WHERE id = ?`, [bill_id]);
  else if (bill_number) bill = await db.get(`SELECT * FROM bills WHERE bill_number = ?`, [bill_number]);
  if (!bill) throw bad('Bill not found.');
  return bill;
}

async function refundedSoFar(db, billId) {
  const row = await db.get(`SELECT COALESCE(SUM(amount), 0) AS s FROM bill_corrections WHERE bill_id = ? AND type = 'refund'`, [billId]);
  return round2(row?.s || 0);
}

/** Void a paid bill: reverse accounting, cancel order, free table, restock. */
export async function voidPaidBill(db, { bill_id, bill_number, reason, restock = true, created_by = null }) {
  await ensureBillCorrectionsSchema(db);
  if (!String(reason || '').trim()) throw bad('A reason is required to void a bill.');
  const bill = await loadBill(db, bill_id, bill_number);
  if (String(bill.status) === 'voided') throw conflict('This bill is already voided.');
  const priorRefund = await refundedSoFar(db, bill.id);
  if (priorRefund > 0.001) {
    throw conflict('This bill already has a refund. Refund the remaining balance instead of voiding the original sale.');
  }
  await ensureAccountingSchema(db);
  const businessDayId = await currentBusinessDayId(db, { required: true, allowStale: true });

  return db.transaction(async (tx) => {
    // Reverse the sale journal — one contra entry undoes payment + revenue + tax.
    let journalId = null;
    const sale = await tx.get(`SELECT id FROM journal_entries WHERE source_type = 'bill' AND source_id = ?`, [bill.id]);
    if (sale) {
      journalId = await reverseJournal(tx, { journal_id: sale.id, reason: `Void bill ${bill.bill_number}: ${reason}`, created_by });
    }

    await tx.run(`UPDATE bills SET status = 'voided', void_reason = ?, voided_at = CURRENT_TIMESTAMP WHERE id = ?`, [reason, bill.id]);

    let restocked = 0;
    if (bill.order_id) {
      const items = await tx.all(
        `SELECT menu_item_id, item_id, variant_name, quantity FROM order_items
         WHERE order_id = ? AND COALESCE(status, '') NOT IN ('voided', 'cancelled')`,
        [bill.order_id]
      );
      await tx.run(
        `UPDATE orders SET status = 'cancelled', notes = COALESCE(notes, '') || ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [`\nVoided bill ${bill.bill_number}: ${reason}`, bill.order_id]
      );
      await tx.run(
        `UPDATE tables SET status = 'available', current_order_id = NULL, waiter_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE current_order_id = ?`,
        [bill.order_id]
      );
      if (restock && items.length) {
        const { restoreStockForItems } = await import('./stock.js');
        await restoreStockForItems(tx, items, { orderId: bill.order_id, reason: `Void bill ${bill.bill_number}` });
        restocked = 1;
      }
    }

    await tx.run(
      `INSERT INTO bill_corrections (bill_id, type, amount, reason, restocked, journal_id, created_by, business_day_id)
       VALUES (?, 'void', ?, ?, ?, ?, ?, ?)`,
      [bill.id, round2(bill.grand_total), reason, restocked, journalId, created_by, businessDayId]
    );

    return { bill_id: bill.id, bill_number: bill.bill_number, reversed_journal: sale?.id || null, journal_id: journalId, restocked: !!restocked };
  });
}

/** Refund a served bill (full or partial). Over-refund is prevented. */
export async function refundBill(db, { bill_id, bill_number, amount, full = false, method = 'cash', reason, created_by = null }) {
  await ensureBillCorrectionsSchema(db);
  if (!String(reason || '').trim()) throw bad('A reason is required to refund.');
  const bill = await loadBill(db, bill_id, bill_number);
  if (String(bill.status) === 'voided') throw conflict('This bill is voided — there is nothing to refund.');
  await ensureAccountingSchema(db);
  const businessDayId = await currentBusinessDayId(db, { required: true, allowStale: true });

  const prior = await refundedSoFar(db, bill.id);
  const remaining = round2(Number(bill.grand_total) - prior);
  if (remaining <= 0.001) throw conflict('This bill is already fully refunded.');
  const amt = full ? remaining : round2(amount);
  if (!(amt > 0)) throw bad('Refund amount must be greater than zero.');
  if (amt > remaining + 0.001) throw bad(`Only ${remaining} can still be refunded on this bill.`);

  return db.transaction(async (tx) => {
    const journalId = await refund(tx, { amount: amt, method, bill_id: bill.id, reason, created_by, business_day_id: businessDayId });
    const newRefunded = round2(prior + amt);
    const fullyRefunded = newRefunded >= round2(Number(bill.grand_total)) - 0.001;
    await tx.run(
      `UPDATE bills SET refunded_amount = ?, status = CASE WHEN ? = 1 THEN 'refunded' ELSE status END WHERE id = ?`,
      [newRefunded, fullyRefunded ? 1 : 0, bill.id]
    );
    await tx.run(
      `INSERT INTO bill_corrections (bill_id, type, amount, reason, journal_id, created_by, business_day_id) VALUES (?, 'refund', ?, ?, ?, ?, ?)`,
      [bill.id, amt, reason, journalId, created_by, businessDayId]
    );
    return { bill_id: bill.id, amount: amt, refunded_total: newRefunded, remaining: round2(remaining - amt), fully_refunded: fullyRefunded, journal_id: journalId };
  });
}

/** Refund/void history with bill + who did it, for the corrections screen. */
export async function listBillCorrections(db, limit = 50) {
  await ensureBillCorrectionsSchema(db);
  return db.all(
    `SELECT bc.*, b.bill_number, u.full_name AS by_name
     FROM bill_corrections bc
     LEFT JOIN bills b ON bc.bill_id = b.id
     LEFT JOIN users u ON bc.created_by = u.id
     ORDER BY bc.id DESC LIMIT ${Number(limit) || 50}`
  );
}

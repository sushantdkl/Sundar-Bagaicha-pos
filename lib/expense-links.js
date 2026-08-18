/**
 * Expenses created *by* another record (a purchase, a wastage entry) instead of
 * by a human. They carry source_type + source_id; manual expenses keep
 * source_type NULL and are never touched by anything in here.
 */

import { ensureAccountingSchema, postExpenseJournal } from '@/lib/accounting.js';
import { currentBusinessDayId } from '@/lib/business-days.js';
import { nepalDateString } from '@/lib/report-dates.js';

/**
 * Post (or re-post) the accounting journal for one expense row. Wrapped so a
 * bookkeeping error never rolls back the purchase / wastage that created it.
 */
async function postExpenseSafe(db, id, source_type, data) {
  try {
    await ensureAccountingSchema(db);
    await postExpenseJournal(db, {
      id,
      amount: data.amount,
      category: data.category,
      description: data.description,
      payment_method: data.payment_method || 'cash',
      expense_date: data.date,
      logged_by: data.logged_by || null,
      supplier_id: data.supplier_id || null,
      source_type,
      business_day_id: data.business_day_id || null,
    });
  } catch {
    /* accounting is secondary; the source record still stands */
  }
}

/**
 * Create-or-update the single expense that belongs to (source_type, source_id).
 * Pass a tx-scoped db when inside a transaction — this never opens its own.
 */
export async function upsertLinkedExpense(db, source_type, source_id, data) {
  if (!source_type || !source_id) throw new Error('upsertLinkedExpense: source_type and source_id are required.');

  const date = data.date || nepalDateString();
  const businessDayId = data.business_day_id || await currentBusinessDayId(db, { required: true });
  const existing = await db.get(
    `SELECT id, business_day_id FROM expenses WHERE source_type = ? AND source_id = ? LIMIT 1`,
    [source_type, source_id]
  );

  if (existing) {
    if (Number(existing.business_day_id || 0) !== Number(businessDayId)) {
      throw Object.assign(new Error('A closed business day expense cannot be changed.'), { status: 409 });
    }
    await db.run(
      `UPDATE expenses
       SET description = ?, category = ?, amount = ?, expense_date = ?, purchase_date = ?,
           supplier = ?, notes = ?, payment_method = ?, receipt_url = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        data.description,
        data.category,
        Number(data.amount || 0),
        date,
        date,
        data.supplier || null,
        data.notes || null,
        data.payment_method || 'cash',
        data.receipt_url || null,
        existing.id,
      ]
    );
    await postExpenseSafe(db, existing.id, source_type, data);
    return existing.id;
  }

  const result = await db.run(
    `INSERT INTO expenses
       (description, category, amount, expense_date, purchase_date, supplier, notes,
        payment_method, logged_by, receipt_url, source_type, source_id, business_day_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.description,
      data.category,
      Number(data.amount || 0),
      date,
      date,
      data.supplier || null,
      data.notes || null,
      data.payment_method || 'cash',
      data.logged_by || null,
      data.receipt_url || null,
      source_type,
      source_id,
      businessDayId,
    ]
  );
  const id = result?.lastInsertRowid ?? null;
  if (id) await postExpenseSafe(db, id, source_type, data);
  return id;
}

/** Remove the automation-owned expense for a source. Manual expenses are unaffected. */
export async function deleteLinkedExpense(db, source_type, source_id) {
  const rows = await db.all(`SELECT id FROM expenses WHERE source_type = ? AND source_id = ?`, [source_type, source_id]);
  for (const r of rows) {
    // Drop the matching accounting journal so the books don't keep a phantom expense.
    try {
      await db.run(`DELETE FROM journal_entries WHERE source_type = 'expense' AND source_id = ?`, [r.id]);
    } catch {
      /* accounting optional */
    }
  }
  await db.run(`DELETE FROM expenses WHERE source_type = ? AND source_id = ?`, [source_type, source_id]);
}

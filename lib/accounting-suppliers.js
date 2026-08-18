/**
 * Supplier accounting — all derived from the Accounts Payable account (2010)
 * with the supplier sub-ledger tag on each line. No separate balances table:
 *
 *   - a credit purchase posts Cr AP (2010) tagged supplier_id
 *   - a supplier payment posts Dr AP (2010, supplier) / Cr cash|bank
 *
 * Outstanding = Σ(credit - debit) on 2010 per supplier. Ageing applies payments
 * FIFO against the oldest open invoices.
 */

import { postJournal, accountIdByCode, accountBalance, paymentAccountCode, currentDrawerId } from './accounting.js';
import { currentBusinessDayId } from './business-days.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const bad = (m) => Object.assign(new Error(m), { status: 400 });

/** AP account id, memoised per call chain by the caller passing db. */
async function apId(db) {
  return accountIdByCode(db, '2010');
}

/** Per-supplier outstanding payable (only those with a non-zero balance). */
export async function supplierPayables(db) {
  const ap = await apId(db);
  const rows = await db.all(
    `SELECT s.id, s.name,
       COALESCE(SUM(jl.credit - jl.debit), 0) AS outstanding
     FROM suppliers s
     JOIN journal_lines jl ON jl.supplier_id = s.id AND jl.account_id = ?
     GROUP BY s.id, s.name
     HAVING COALESCE(SUM(jl.credit - jl.debit), 0) <> 0
     ORDER BY outstanding DESC`,
    [ap]
  );
  return rows.map((r) => ({ id: r.id, name: r.name, outstanding: round2(r.outstanding) }));
}

/** Statement of one supplier's AP movements (oldest first). */
export async function supplierStatement(db, supplierId, { from = null, to = null } = {}) {
  const ap = await apId(db);
  const params = [ap, supplierId];
  let where = '';
  if (from) { where += ' AND je.entry_date >= ?'; params.push(from); }
  if (to) { where += ' AND je.entry_date <= ?'; params.push(to); }
  return db.all(
    `SELECT je.id AS journal_id, je.entry_date, je.memo, je.source_type, jl.debit, jl.credit
     FROM journal_lines jl JOIN journal_entries je ON jl.journal_id = je.id
     WHERE jl.account_id = ? AND jl.supplier_id = ?${where}
     ORDER BY je.entry_date, je.id, jl.id`,
    params
  );
}

/** All liability accounts with their current balance (credit - debit). */
export async function liabilityLedger(db) {
  return db.all(
    `SELECT a.code, a.name, a.subtype,
       COALESCE(SUM(jl.credit - jl.debit), 0) AS balance
     FROM accounts a
     LEFT JOIN journal_lines jl ON jl.account_id = a.id
     WHERE a.type = 'liability' AND a.parent_id IS NOT NULL
     GROUP BY a.id ORDER BY a.code`
  );
}

const DAY = 24 * 60 * 60 * 1000;
function bucketOf(days) {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

/**
 * FIFO ageing. For each supplier, credits are invoices and debits are payments
 * applied to the oldest open invoice first; whatever is still open is bucketed
 * by the invoice's age.
 */
export async function liabilityAgeing(db) {
  const ap = await apId(db);
  const rows = await db.all(
    `SELECT s.id AS supplier_id, s.name, je.entry_date, jl.debit, jl.credit
     FROM journal_lines jl
     JOIN journal_entries je ON jl.journal_id = je.id
     JOIN suppliers s ON jl.supplier_id = s.id
     WHERE jl.account_id = ?
     ORDER BY s.id, je.entry_date, je.id, jl.id`,
    [ap]
  );

  const now = Date.now();
  const bySupplier = new Map();
  for (const r of rows) {
    if (!bySupplier.has(r.supplier_id)) bySupplier.set(r.supplier_id, { name: r.name, invoices: [], payment: 0 });
    const s = bySupplier.get(r.supplier_id);
    const credit = round2(r.credit);
    const debit = round2(r.debit);
    if (credit > 0) s.invoices.push({ date: r.entry_date, open: credit });
    if (debit > 0) s.payment += debit;
  }

  const result = [];
  for (const [supplier_id, s] of bySupplier) {
    // Apply all payments FIFO to the oldest invoices.
    let pay = s.payment;
    for (const inv of s.invoices) {
      if (pay <= 0) break;
      const applied = Math.min(pay, inv.open);
      inv.open = round2(inv.open - applied);
      pay = round2(pay - applied);
    }
    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    let total = 0;
    for (const inv of s.invoices) {
      if (inv.open <= 0.001) continue;
      const age = Math.max(0, Math.floor((now - new Date(`${String(inv.date).slice(0, 10)}T00:00:00`).getTime()) / DAY));
      buckets[bucketOf(age)] = round2(buckets[bucketOf(age)] + inv.open);
      total = round2(total + inv.open);
    }
    if (total > 0.001) result.push({ supplier_id, name: s.name, ...buckets, total });
  }
  return result.sort((a, b) => b.total - a.total);
}

/**
 * Open (not yet fully paid) purchase invoices for one supplier — same FIFO
 * payment allocation as liabilityAgeing, but scoped to a single supplier and
 * resolved back to the purchase record for display. View-only: a supplier
 * payment settles the oldest invoice(s) automatically, it isn't picked here.
 */
export async function supplierOpenInvoices(db, supplierId) {
  const ap = await apId(db);
  const rows = await db.all(
    `SELECT je.entry_date, je.source_id AS expense_id, jl.debit, jl.credit
     FROM journal_lines jl
     JOIN journal_entries je ON jl.journal_id = je.id
     WHERE jl.account_id = ? AND jl.supplier_id = ? AND je.source_type = 'expense'
     ORDER BY je.entry_date, je.id`,
    [ap, supplierId]
  );

  const invoices = [];
  let payment = 0;
  for (const r of rows) {
    const credit = round2(r.credit);
    const debit = round2(r.debit);
    if (credit > 0) invoices.push({ expense_id: r.expense_id, date: r.entry_date, open: credit, total: credit });
    if (debit > 0) payment = round2(payment + debit);
  }
  let pay = payment;
  for (const inv of invoices) {
    if (pay <= 0) break;
    const applied = Math.min(pay, inv.open);
    inv.open = round2(inv.open - applied);
    pay = round2(pay - applied);
  }

  const open = invoices.filter((inv) => inv.open > 0.009);
  if (!open.length) return [];

  const expenseIds = open.map((inv) => inv.expense_id).filter(Boolean);
  const expenses = expenseIds.length
    ? await db.all(
        `SELECT id, source_id, description FROM expenses WHERE id IN (${expenseIds.map(() => '?').join(',')})`,
        expenseIds
      )
    : [];
  const expenseById = new Map(expenses.map((e) => [e.id, e]));

  const purchaseIds = expenses.map((e) => e.source_id).filter(Boolean);
  const purchases = purchaseIds.length
    ? await db.all(
        `SELECT id, invoice_number FROM purchases WHERE id IN (${purchaseIds.map(() => '?').join(',')})`,
        purchaseIds
      )
    : [];
  const purchaseById = new Map(purchases.map((p) => [p.id, p]));

  return open
    .map((inv) => {
      const expense = expenseById.get(inv.expense_id);
      const purchase = expense ? purchaseById.get(expense.source_id) : null;
      return {
        purchase_id: purchase?.id || null,
        invoice_number: purchase?.invoice_number || null,
        description: expense?.description || null,
        date: inv.date,
        total: inv.total,
        outstanding: inv.open,
      };
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

/** Pay a supplier: Dr Accounts Payable (supplier) / Cr cash|bank. */
export async function paySupplier(db, { supplier_id, amount, method = 'cash', bank_account_id = null, note, external_ref = null, created_by = null, allow_over = false }) {
  const amt = round2(amount);
  if (!supplier_id) throw bad('Which supplier is this payment for?');
  if (!(amt > 0)) throw bad('Amount must be greater than zero.');
  const m = String(method).toLowerCase();
  const creditCode = m === 'cash' ? '1010' : ['bank', 'bank_transfer', 'cheque'].includes(m) ? '1020' : paymentAccountCode(m);

  if (!allow_over) {
    // accountBalance returns debit-credit; AP is credit-normal, so owed = -(debit-credit).
    const owed = round2(-(await accountBalance(db, '2010', { supplierId: supplier_id })));
    if (amt > owed + 0.001) throw bad(`This supplier is only owed ${owed}.`);
  }

  const drawerId = creditCode === '1010' ? await currentDrawerId(db) : null;
  const businessDayId = await currentBusinessDayId(db, { required: true });
  return db.transaction((tx) =>
    postJournal(tx, {
      memo: note || 'Supplier payment',
      source_type: 'supplier_payment',
      source_id: null,
      external_ref,
      created_by,
      business_day_id: businessDayId,
      lines: [
        { code: '2010', debit: amt, credit: 0, supplier_id, memo: 'AP settled' },
        { code: creditCode, debit: 0, credit: amt, drawer_id: drawerId, bank_account_id: creditCode === '1020' ? bank_account_id : null },
      ],
    })
  );
}

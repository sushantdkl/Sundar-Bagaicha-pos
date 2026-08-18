/**
 * Accounts Receivable helpers — customer credit outstanding, ageing, statements.
 * Mirrors AP style; payments reuse collectCreditBalance on individual bills.
 */

import { ensureSplitPaymentSchema, collectCreditBalance, writeOffCreditBalance } from '@/lib/split-payments.js';
import { nepalDateString } from '@/lib/report-dates.js';
import { accountBalance } from '@/lib/accounting.js';

const num = (n) => Number(n || 0);
const round2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;

function ageBucket(dueDate, today) {
  if (!dueDate) return '0-30';
  const due = new Date(`${String(dueDate).slice(0, 10)}T12:00:00+05:45`);
  const now = new Date(`${today}T12:00:00+05:45`);
  const days = Math.max(0, Math.floor((now - due) / 86400000));
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

export async function customerReceivables(db) {
  await ensureSplitPaymentSchema(db);
  const rows = await db.all(
    `SELECT id, name, phone, credit_limit, current_credit, is_vip, is_blacklisted
     FROM customers
     WHERE COALESCE(current_credit, 0) > 0.009
     ORDER BY current_credit DESC`
  );
  return (rows || []).map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    credit_limit: round2(r.credit_limit),
    outstanding: round2(r.current_credit),
    is_vip: Boolean(r.is_vip),
    is_blacklisted: Boolean(r.is_blacklisted),
  }));
}

export async function receivableAgeing(db) {
  await ensureSplitPaymentSchema(db);
  const today = nepalDateString(new Date());
  const open = await db.all(
    `SELECT cl.customer_id, c.name,
            COALESCE(cl.due_date, date(cl.created_at)) AS due_date,
            (COALESCE(cl.debit,0) - COALESCE(cl.credit,0)) AS open_amt
     FROM customer_ledger cl
     JOIN customers c ON c.id = cl.customer_id
     WHERE (COALESCE(cl.debit,0) - COALESCE(cl.credit,0)) > 0.009
        OR cl.entry_type IN ('credit_sale','sale_credit')`
  ).catch(() => []);

  // Prefer customer.current_credit as truth; allocate to buckets by oldest open debit lines.
  const byCustomer = new Map();
  for (const row of open || []) {
    const amt = round2(row.open_amt);
    if (!(amt > 0)) continue;
    const id = row.customer_id;
    if (!byCustomer.has(id)) {
      byCustomer.set(id, { supplier_id: id, customer_id: id, name: row.name, '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0, total: 0 });
    }
    const bucket = ageBucket(row.due_date, today);
    const rec = byCustomer.get(id);
    rec[bucket] = round2(rec[bucket] + amt);
    rec.total = round2(rec.total + amt);
  }

  // Sync totals to customers.current_credit when ledger open lines under/over-count.
  const customers = await customerReceivables(db);
  for (const c of customers) {
    if (!byCustomer.has(c.id)) {
      byCustomer.set(c.id, {
        supplier_id: c.id, customer_id: c.id, name: c.name,
        '0-30': c.outstanding, '31-60': 0, '61-90': 0, '90+': 0, total: c.outstanding,
      });
    } else {
      const rec = byCustomer.get(c.id);
      if (Math.abs(rec.total - c.outstanding) > 0.05) {
        // Scale buckets to match current_credit.
        const scale = rec.total > 0 ? c.outstanding / rec.total : 1;
        for (const b of ['0-30', '31-60', '61-90', '90+']) rec[b] = round2(rec[b] * scale);
        rec.total = c.outstanding;
      }
    }
  }

  return Array.from(byCustomer.values()).filter((r) => r.total > 0.009).sort((a, b) => b.total - a.total);
}

export async function customerArStatement(db, customerId, { from = null, to = null } = {}) {
  await ensureSplitPaymentSchema(db);
  const params = [customerId];
  let dateWhere = '';
  if (from) { dateWhere += " AND date(cl.created_at, '+5 hours', '+45 minutes') >= date(?)"; params.push(from); }
  if (to) { dateWhere += " AND date(cl.created_at, '+5 hours', '+45 minutes') <= date(?)"; params.push(to); }

  const rows = await db.all(
    `SELECT cl.id, cl.created_at AS date, cl.entry_type AS memo,
            cl.debit, cl.credit, b.bill_number, cl.due_date, cl.note
     FROM customer_ledger cl
     LEFT JOIN bills b ON b.id = cl.bill_id
     WHERE cl.customer_id = ? ${dateWhere}
     ORDER BY cl.created_at ASC, cl.id ASC`,
    params
  );

  let running = 0;
  return (rows || []).map((r) => {
    running = round2(running + num(r.debit) - num(r.credit));
    return {
      id: r.id,
      date: r.date,
      memo: `${r.memo || ''}${r.bill_number ? ` · ${r.bill_number}` : ''}${r.note ? ` — ${r.note}` : ''}`,
      debit: round2(r.debit),
      credit: round2(r.credit),
      balance: running,
      due_date: r.due_date,
    };
  });
}

export async function outstandingCreditBills(db, customerId) {
  return db.all(
    `SELECT b.id, b.order_id, b.bill_number, b.grand_total, b.outstanding_amount, b.created_at, b.payment_status
     FROM bills b
     WHERE b.customer_id = ? AND COALESCE(b.outstanding_amount, 0) > 0.009
     ORDER BY b.created_at ASC`,
    [customerId]
  );
}

/** Collect against the oldest outstanding credit bill(s) for a customer. */
export async function collectCustomerCredit(db, {
  customer_id, amount, method = 'cash', reference = null, bank_account_id = null, provider = null,
  note = null, actorId = null, actorRole = 'admin', external_ref = null,
}) {
  await ensureSplitPaymentSchema(db);
  const amt = round2(amount);
  if (!(amt > 0)) throw Object.assign(new Error('Enter a payment amount.'), { status: 400 });

  const customer = await db.get('SELECT * FROM customers WHERE id = ?', [customer_id]);
  if (!customer) throw Object.assign(new Error('Customer not found.'), { status: 404 });
  if (!(num(customer.current_credit) > 0)) {
    throw Object.assign(new Error('This customer has no outstanding credit.'), { status: 409 });
  }

  const bills = await outstandingCreditBills(db, customer_id);
  if (!bills.length) {
    throw Object.assign(new Error('No open credit invoices found for this customer. Adjust via Corrections if needed.'), { status: 409 });
  }

  let remaining = Math.min(amt, round2(customer.current_credit));
  const results = [];
  for (const bill of bills) {
    if (remaining <= 0.009) break;
    const due = round2(bill.outstanding_amount);
    const take = Math.min(remaining, due);
    const key = `${external_ref || 'ar-collect'}:${bill.id}:${take}`;
    const collection = await collectCreditBalance(db, {
      billId: bill.id,
      allocations: [{
        method,
        amount: take,
        cash_tendered: method === 'cash' ? take : undefined,
        reference: reference || note || undefined,
        bank_account_id: bank_account_id || undefined,
        provider: provider || undefined,
      }],
      actorId,
      actorRole,
      requestKey: key,
    });
    results.push({ bill_id: bill.id, bill_number: bill.bill_number, collected: take, ...collection });
    remaining = round2(remaining - take);
  }

  const collected = round2(amt - remaining);
  return { collected, remaining_unapplied: remaining, results };
}

/** Forgive part/all of a customer's outstanding credit — same FIFO-oldest-bill-first shape as collectCustomerCredit. */
export async function writeOffCustomerCredit(db, {
  customer_id, amount, reason = null, actorId = null, actorRole = 'admin', external_ref = null,
}) {
  await ensureSplitPaymentSchema(db);
  const amt = round2(amount);
  if (!(amt > 0)) throw Object.assign(new Error('Enter a discount amount.'), { status: 400 });
  if (actorRole !== 'admin') throw Object.assign(new Error('Only an admin can write off customer credit.'), { status: 403 });

  const customer = await db.get('SELECT * FROM customers WHERE id = ?', [customer_id]);
  if (!customer) throw Object.assign(new Error('Customer not found.'), { status: 404 });
  if (!(num(customer.current_credit) > 0)) {
    throw Object.assign(new Error('This customer has no outstanding credit.'), { status: 409 });
  }

  const bills = await outstandingCreditBills(db, customer_id);
  if (!bills.length) {
    throw Object.assign(new Error('No open credit invoices found for this customer. Adjust via Corrections if needed.'), { status: 409 });
  }

  let remaining = Math.min(amt, round2(customer.current_credit));
  const results = [];
  for (const bill of bills) {
    if (remaining <= 0.009) break;
    const due = round2(bill.outstanding_amount);
    const take = Math.min(remaining, due);
    const key = `${external_ref || 'ar-writeoff'}:${bill.id}:${take}`;
    const writeOff = await writeOffCreditBalance(db, {
      billId: bill.id,
      amount: take,
      reason,
      actorId,
      actorRole,
      requestKey: key,
    });
    results.push({ bill_id: bill.id, bill_number: bill.bill_number, written_off: take, ...writeOff });
    remaining = round2(remaining - take);
  }

  const writtenOff = round2(amt - remaining);
  return { writtenOff, remaining_unapplied: remaining, results };
}

export async function arAccountBalance(db) {
  return round2(await accountBalance(db, '1300'));
}

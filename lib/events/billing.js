/**
 * Final event billing.
 *
 * This is where an event becomes revenue, and it happens exactly once.
 *
 * The settlement has three parts and they must not be confused:
 *
 *   1. what is owed        the contracted quotation plus anything additional
 *                          sold during the event
 *   2. what is already in  advances held in 2030 Event Customer Advances
 *   3. what is paid now    the balance, through the existing payment methods
 *
 * The journal releases the advance and recognises the sale in one balanced
 * entry:
 *
 *   Dr 2030 Event Customer Advances    (the liability clears)
 *   Dr Cash/Bank/QR                    (whatever is collected now)
 *     Cr 4010 Sales Revenue            (net of tax)
 *     Cr 2020 VAT / Tax Payable        (the tax portion)
 *
 * Revenue is recognised here and only here. Deposits never touched 4010, so
 * there is no double count; the advance is consumed rather than re-earned.
 *
 * Duplicate billing is prevented by events.completed_at plus a check for an
 * existing settlement journal, and the whole settlement writes in one
 * transaction so a partial failure leaves nothing behind.
 */
import { postJournal, paymentAccountCode, currentDrawerId, ensureAccountingSchema } from '../accounting.js';
import { toId } from './ids.js';
import { currentBusinessDayId } from '../business-days.js';
import { nextDocumentNumber } from '../document-numbers.js';
import { ensureColumn } from '../db/schema-helpers.js';
import { nepalDateString } from '../report-dates.js';
import { calculateBillTotals } from '../billing-totals.js';
import { ensureEventsSchema } from './schema.js';
import { logEventAudit } from './audit.js';
import { eventOrders } from './production.js';
import { depositBalance } from './deposits.js';
import { ADVANCES_ACCOUNT_CODE } from './deposits.js';
import { getBillablePolicy, explainBillable } from './guests.js';
import { EVENT_STATUS, EVENT_PAYMENT_STATUS, EVENT_AUDIT_ACTION, assertBillable } from './constants.js';
import {
  ensureSplitPaymentSchema, recordSharedBillAllocations, validateAllocations,
} from '../split-payments.js';

const fail = (message, status = 400, extra = {}) => {
  throw Object.assign(new Error(message), { status, ...extra });
};
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const cleanText = (v, max = 300) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

/**
 * Everything owed, assembled but not charged. Safe to call repeatedly.
 */
export async function finalStatement(db, eventId) {
  await ensureEventsSchema(db);
  const event = await db.get(
    `SELECT e.*, c.name AS customer_name, c.phone AS customer_phone,
            c.current_credit, c.credit_limit, c.is_blacklisted
       FROM events e LEFT JOIN customers c ON c.id = e.customer_id
      WHERE e.id = ?`,
    [toId(eventId, 'event')]
  );
  if (!event) fail('Event not found.', 404);

  const [orders, held, policy] = await Promise.all([
    eventOrders(db, event.id),
    depositBalance(db, event.id),
    getBillablePolicy(db),
  ]);

  // Only orders raised beyond the fulfilment order are additional sales; the
  // fulfilment order delivers food the quotation already charges for.
  const additionalOrders = orders.filter((o) => !Number(o.event_production));
  const additionalSales = round2(additionalOrders.reduce((s, o) => s + Number(o.total_amount || 0), 0));

  // Additional sales attract the same service charge and tax the quotation did.
  const contractedSubtotal = round2(event.subtotal);
  const combinedSubtotal = round2(contractedSubtotal + additionalSales);
  const totals = calculateBillTotals(combinedSubtotal, {
    discountAmount: Number(event.discount_amount || 0),
    vatPercent: Number(event.tax_percent || 0),
    servicePercent: Number(event.service_charge_percent || 0),
  });

  const grandTotal = round2(totals.total);
  const balanceDue = round2(grandTotal - held);

  return {
    event_id: event.id,
    event_number: event.event_number,
    status: event.status,
    already_billed: Boolean(event.completed_at),
    guests: explainBillable(event, policy),
    contracted_subtotal: contractedSubtotal,
    additional_sales: additionalSales,
    subtotal: combinedSubtotal,
    discount: round2(totals.discount),
    discount_reason: event.discount_reason,
    service_charge_percent: Number(event.service_charge_percent || 0),
    service_charge: round2(totals.serviceCharge),
    tax_percent: Number(event.tax_percent || 0),
    tax: round2(totals.tax),
    grand_total: grandTotal,
    advances_applied: held,
    balance_due: balanceDue,
    customer: event.customer_id ? {
      id: event.customer_id,
      name: event.customer_name || event.contact_name,
      phone: event.customer_phone || event.contact_phone,
      current_credit: round2(event.current_credit),
      credit_limit: round2(event.credit_limit),
      is_blacklisted: Boolean(event.is_blacklisted),
    } : null,
    orders: orders.map((o) => ({
      id: o.id, order_number: o.order_number,
      is_fulfilment: Boolean(Number(o.event_production)),
      total: round2(o.total_amount),
    })),
  };
}

/**
 * Columns the event bill writes that Postgres gets from migrations (026, 032,
 * 050) but a SQLite dev database does not. Follows the pattern already used by
 * lib/split-payments.js and lib/bill-corrections.js: no-op where the migration
 * ran, additive where it did not, so both drivers accept the same INSERT.
 */
let BILL_COLUMNS_READY = false;
async function ensureEventBillColumns(db) {
  if (BILL_COLUMNS_READY) return;
  await ensureColumn(db, 'bills', 'customer_id', 'INTEGER').catch(() => {});
  await ensureColumn(db, 'bills', 'outstanding_amount', 'NUMERIC(14,2) DEFAULT 0').catch(() => {});
  await ensureColumn(db, 'bills', 'payment_status', "TEXT DEFAULT 'unpaid'").catch(() => {});
  await ensureColumn(db, 'bills', 'idempotency_key', 'TEXT').catch(() => {});
  await ensureColumn(db, 'bills', 'business_day_id', 'INTEGER').catch(() => {});
  await ensureColumn(db, 'bills', 'journal_id', 'INTEGER').catch(() => {});
  await ensureColumn(db, 'bill_payments', 'reference_number', 'TEXT').catch(() => {});
  BILL_COLUMNS_READY = true;
}

/**
 * The order an event's bill hangs on.
 *
 * `bills.order_id` is NOT NULL, and for good reason: every bill in this system
 * answers "what was sold". An event usually already has that order — the
 * fulfilment order production raised — so the bill attaches to it and the item
 * detail flows into the same reports a restaurant bill's does.
 *
 * A venue-only booking (a hall hire with no food) has no order at all, so one
 * is written here. It is inserted directly rather than through OrderRepository
 * on purpose: the repository deducts stock, and there is nothing to deduct for
 * a booking that sells no food. Creating it at settlement — not at booking —
 * is what keeps an unbilled event out of order counts.
 */
async function billableOrderId(tx, event, businessDayId) {
  const existing = await tx.get(
    `SELECT id FROM orders WHERE event_id = ?
      ORDER BY COALESCE(event_production, 0) DESC, id ASC LIMIT 1`,
    [event.id]
  );
  if (existing) return existing.id;

  const orderNumber = await nextDocumentNumber(tx, { type: 'order', prefix: 'ORD' });
  const created = await tx.run(
    `INSERT INTO orders
       (order_number, order_type, status, customer_id, customer_name, customer_phone,
        notes, event_id, business_day_id, created_at, updated_at)
     VALUES (?, 'dine_in', 'completed', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      orderNumber, event.customer_id || null, event.contact_name || null,
      event.contact_phone || null, `Event settlement — ${event.event_number}`,
      event.id, businessDayId,
    ]
  );
  return created.lastInsertRowid;
}

/**
 * Write the event's bill.
 *
 * This is what makes an event sale a first-class sale: it takes a number from
 * the shared bill sequence, so the event prints a receipt and appears in the
 * Sales Report, Analytics and the Dashboard alongside every restaurant bill,
 * with no report needing to know events exist.
 *
 * It deliberately does NOT post a journal. The settlement above already posted
 * the one authoritative entry (source_type 'event_sale'); calling the payment
 * engine here would post a second and double the revenue. The bill carries
 * `journal_id` so the entry it belongs to is never in doubt.
 */
async function writeEventBill(tx, {
  event, statement, advanceApplied, businessDayId, journalId, actor,
}) {
  const billNumber = await nextDocumentNumber(tx, { type: 'bill', prefix: 'BILL' });
  const orderId = await billableOrderId(tx, event, businessDayId);
  const grandTotal = statement.grand_total;

  const result = await tx.run(
    `INSERT INTO bills
       (bill_number, order_id, customer_id, subtotal, tax, vat_amount, service_charge,
        discount_amount, discount_reason, grand_total, status, payment_status, outstanding_amount,
        cashier_id, tax_percent, service_charge_percent, business_day_id, journal_id,
        idempotency_key, created_at, paid_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      billNumber, orderId, event.customer_id || null,
      statement.subtotal, statement.tax, statement.tax, statement.service_charge,
      statement.discount, statement.discount_reason || null, grandTotal,
      'unpaid', 'unpaid', grandTotal,
      actor.id || null, statement.tax_percent, statement.service_charge_percent,
      businessDayId, journalId, `event-sale-${event.id}`,
    ]
  );
  const billId = result.lastInsertRowid;

  // Advances predate this bill and are outside the Cash/QR/Credit allocation
  // constraint. They remain a payment row so the bill's paid total is correct.
  if (advanceApplied > 0.009) {
    await tx.run(
      `INSERT INTO bill_payments (bill_id, amount, payment_method, reference_number, created_at)
       VALUES (?, ?, 'advance', ?, CURRENT_TIMESTAMP)`,
      [billId, advanceApplied, `Advance held for ${event.event_number}`]
    );
  }
  await tx.run(
    `UPDATE orders SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [orderId]
  );
  return { bill_id: billId, bill_number: billNumber, order_id: orderId };
}

/**
 * Settle and complete the event.
 *
 * @param {Array} data.payments  [{ method, amount, reference_number }] — a
 *                               split settlement is simply more than one entry
 */
export async function finaliseBilling(db, eventId, data = {}, actor = {}) {
  await ensureEventsSchema(db);
  await ensureAccountingSchema(db);
  await ensureEventBillColumns(db);
  await ensureSplitPaymentSchema(db);

  const event = await db.get('SELECT * FROM events WHERE id = ?', [toId(eventId, 'event')]);
  if (!event) fail('Event not found.', 404);

  // Two independent guards against billing twice.
  if (event.completed_at) {
    fail(`${event.event_number} was already billed at ${event.completed_at}.`, 409, {
      code: 'already_billed', completed_at: event.completed_at,
    });
  }
  const existing = await db.get(
    `SELECT id FROM journal_entries WHERE source_type = 'event_sale' AND source_id = ?`,
    [event.id]
  );
  if (existing) {
    fail(`${event.event_number} already has a settlement journal.`, 409, { code: 'already_billed' });
  }

  // Any committed event may be settled — a confirmed birthday goes straight to
  // the bill without being walked through Planning, Finalized and In Progress
  // first. The lifecycle owns the rule; this cannot be bypassed here.
  assertBillable(event.status);

  const statement = await finalStatement(db, event.id);
  const balanceDue = statement.balance_due;

  const customer = event.customer_id
    ? await db.get('SELECT * FROM customers WHERE id = ?', [event.customer_id])
    : null;
  const rawAllocations = (Array.isArray(data.allocations) ? data.allocations : data.payments || [])
    .map((p) => ({
      ...p,
      method: String(p.method || 'cash').toLowerCase().trim(),
      amount: round2(p.amount),
      cash_tendered: p.cash_tendered ?? (String(p.method || '').toLowerCase() === 'cash' ? p.amount : undefined),
    }));
  const allocations = balanceDue > 0.009
    ? validateAllocations(rawAllocations, balanceDue, {
      customer, actorRole: actor.role || actor.user_type || 'admin',
    })
    : [];
  const creditOutstanding = round2(allocations
    .filter((p) => p.method === 'credit').reduce((s, p) => s + p.amount, 0));
  const receivedAllocations = allocations.filter((p) => p.method !== 'credit');
  const collected = round2(receivedAllocations.reduce((s, p) => s + p.amount, 0));

  const businessDayId = await currentBusinessDayId(db, { required: true, allowStale: true });
  const entryDate = cleanText(data.entry_date, 10) || nepalDateString();
  const advances = statement.advances_applied;
  const grandTotal = statement.grand_total;
  const taxTotal = statement.tax;

  if (grandTotal <= 0) {
    fail('There is nothing to settle on this event.', 400, { code: 'nothing_to_bill' });
  }
  // Completion earns the full event sale. Any unpaid part is Accounts
  // Receivable, not deferred revenue; later collection must never earn it again.
  const taxPortion = taxTotal;
  const revenuePortion = round2(grandTotal - taxPortion);
  const advanceApplied = round2(Math.min(advances, grandTotal));

  let billed = null;
  const journalId = await db.transaction(async (tx) => {
    // Claim the event first, inside the settlement transaction.
    //
    // The guards above read completed_at a moment ago, which two simultaneous
    // settlements both pass. This UPDATE is the real guard: the second
    // transaction blocks on the row until the first commits, then matches zero
    // rows and rolls the whole settlement back. Without it QA saw two
    // settlements both report success, each writing its own payment rows
    // against one sale.
    const claim = await tx.run(
      `UPDATE events SET completed_at = CURRENT_TIMESTAMP WHERE id = ? AND completed_at IS NULL`,
      [event.id]
    );
    if (!claim?.changes) {
      fail(`${event.event_number} was already billed.`, 409, { code: 'already_billed' });
    }

    const lines = [];
    if (advanceApplied > 0) {
      lines.push({
        code: ADVANCES_ACCOUNT_CODE, debit: advanceApplied, credit: 0,
        customer_id: event.customer_id || null,
        memo: `Advance applied — ${event.event_number}`,
      });
    }
    for (const p of allocations) {
      const code = paymentAccountCode(p.method);
      lines.push({
        code, debit: p.amount, credit: 0,
        drawer_id: code === '1010' ? await currentDrawerId(tx) : null,
        customer_id: code === '1300' ? event.customer_id || null : null,
        memo: `${p.method} settlement${p.reference ? ` ${p.reference}` : ''}`,
      });
    }
    lines.push({ code: '4010', debit: 0, credit: revenuePortion, memo: `Event sale — ${event.event_number}` });
    if (taxPortion > 0) {
      lines.push({ code: '2020', debit: 0, credit: taxPortion, memo: 'VAT / tax payable' });
    }

    const id = await postJournal(tx, {
      entry_date: entryDate,
      memo: `Event settlement — ${event.event_number}`,
      source_type: 'event_sale',
      source_id: event.id,
      created_by: actor.id || null,
      business_day_id: businessDayId,
      lines,
    });

    // Money collected at settlement is recorded as a deposit entry too, so the
    // event's payment history is complete in one place.
    for (const p of receivedAllocations) {
      await tx.run(
        `INSERT INTO event_deposits
           (event_id, entry_type, amount, payment_method, reference_number, received_on,
            notes, status, business_day_id, customer_id, created_by)
         VALUES (?, 'adjustment', ?, ?, ?, ?, 'Final settlement', 'active', ?, ?, ?)`,
        [event.id, p.amount, p.method, p.reference, entryDate,
         businessDayId, event.customer_id || null, actor.id || null]
      );
    }

    // Settling completes the event: this is the single path to COMPLETED, which
    // is why the status matrix deliberately has no route to it.
    await tx.run(
      `UPDATE events
          SET status = ?, payment_status = ?,
              total_amount = ?, subtotal = ?, service_charge_amount = ?, tax_amount = ?,
              deposit_total = ?, outstanding_amount = ?,
              updated_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [
        EVENT_STATUS.COMPLETED,
        creditOutstanding > 0 ? EVENT_PAYMENT_STATUS.PARTIALLY_PAID : EVENT_PAYMENT_STATUS.PAID,
        grandTotal, statement.subtotal, statement.service_charge, taxTotal,
        round2(advances + collected), creditOutstanding,
        actor.id || null, event.id,
      ]
    );

    // The bill is written inside the same transaction as the journal, so an
    // event can never end up with revenue posted and no bill, or the reverse.
    billed = await writeEventBill(tx, {
      event, statement, advanceApplied, businessDayId, journalId: id, actor,
    });
    const settlement = allocations.length
      ? await recordSharedBillAllocations(tx, {
        billId: billed.bill_id, billNumber: billed.bill_number, allocations,
        customer, actorId: actor.id || null, requestKey: `event-sale-${event.id}`,
        businessDayId,
      })
      : { status: 'paid', outstanding: 0, received: 0, allocations: [] };
    if (!allocations.length) {
      await tx.run(
        `UPDATE bills SET status='paid', payment_status='paid', outstanding_amount=0,
            paid_at=CURRENT_TIMESTAMP WHERE id=?`,
        [billed.bill_id]
      );
    }
    billed = { ...billed, ...settlement };

    await logEventAudit(tx, {
      action: EVENT_AUDIT_ACTION.FINAL_BILLED,
      eventId: event.id, entityType: 'event', entityId: event.id, actor,
      reason: cleanText(data.notes, 300),
      next: {
        grand_total: grandTotal, advances_applied: advanceApplied,
        collected, revenue_recognised: revenuePortion, tax: taxPortion,
        journal_id: id, bill_number: billed.bill_number,
        payments: allocations.map((p) => `${p.method}:${p.amount}`),
      },
    });
    await logEventAudit(tx, {
      action: EVENT_AUDIT_ACTION.COMPLETED,
      eventId: event.id, entityType: 'event', entityId: event.id, actor,
      previous: { status: event.status }, next: { status: EVENT_STATUS.COMPLETED },
    });

    return id;
  });

  return {
    event: await db.get('SELECT * FROM events WHERE id = ?', [event.id]),
    statement,
    bill: billed,
    journal_id: journalId,
    advances_applied: advanceApplied,
    collected,
    revenue_recognised: revenuePortion,
    tax_recognised: taxPortion,
  };
}

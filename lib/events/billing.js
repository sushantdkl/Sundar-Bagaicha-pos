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
import { nepalDateString } from '../report-dates.js';
import { calculateBillTotals } from '../billing-totals.js';
import { ensureEventsSchema } from './schema.js';
import { logEventAudit } from './audit.js';
import { eventOrders } from './production.js';
import { depositBalance } from './deposits.js';
import { ADVANCES_ACCOUNT_CODE } from './deposits.js';
import { getBillablePolicy, explainBillable } from './guests.js';
import { EVENT_STATUS, EVENT_PAYMENT_STATUS, EVENT_AUDIT_ACTION, assertTransition } from './constants.js';

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
  const event = await db.get('SELECT * FROM events WHERE id = ?', [toId(eventId, 'event')]);
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
    orders: orders.map((o) => ({
      id: o.id, order_number: o.order_number,
      is_fulfilment: Boolean(Number(o.event_production)),
      total: round2(o.total_amount),
    })),
  };
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

  if (event.status !== EVENT_STATUS.IN_PROGRESS) {
    fail(
      `Only an event in progress can be settled and completed (${event.event_number} is ${event.status}).`,
      409,
      { code: 'not_in_progress' }
    );
  }
  // The lifecycle owns the rule; this cannot be bypassed here.
  assertTransition(event.status, EVENT_STATUS.COMPLETED);

  const statement = await finalStatement(db, event.id);
  const balanceDue = statement.balance_due;

  const payments = (Array.isArray(data.payments) ? data.payments : [])
    .map((p) => ({
      method: String(p.method || 'cash').toLowerCase().trim(),
      amount: round2(p.amount),
      reference_number: cleanText(p.reference_number, 120),
    }))
    .filter((p) => p.amount > 0);

  const collected = round2(payments.reduce((s, p) => s + p.amount, 0));

  // Every method must map to an account before anything is written.
  for (const p of payments) paymentAccountCode(p.method);

  if (balanceDue > 0.009 && collected + 0.009 < balanceDue && !data.allow_partial) {
    fail(
      `The balance is ${balanceDue} but only ${collected} is being collected. Collect the balance, or confirm a partial settlement.`,
      409,
      { code: 'balance_outstanding', balance_due: balanceDue, collected }
    );
  }
  if (collected > balanceDue + 0.009 && !data.allow_overpayment) {
    fail(
      `Collecting ${collected} against a balance of ${balanceDue} would overpay by ${round2(collected - balanceDue)}.`,
      409,
      { code: 'overpayment', balance_due: balanceDue, collected }
    );
  }

  const businessDayId = await currentBusinessDayId(db, { required: true, allowStale: true });
  const entryDate = cleanText(data.entry_date, 10) || nepalDateString();
  const advances = statement.advances_applied;
  const grandTotal = statement.grand_total;
  const taxTotal = statement.tax;

  // What is actually recognised as a sale now: everything settled, whether it
  // arrived earlier as an advance or is being collected at the door.
  const recognised = round2(Math.min(grandTotal, advances + collected));
  if (recognised <= 0) {
    fail('There is nothing to settle on this event.', 400, { code: 'nothing_to_bill' });
  }
  // Tax is apportioned to the part being recognised, so a partial settlement
  // does not book the whole tax liability up front.
  const taxPortion = grandTotal > 0 ? round2((taxTotal * recognised) / grandTotal) : 0;
  const revenuePortion = round2(recognised - taxPortion);
  const advanceApplied = round2(Math.min(advances, recognised));

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
    for (const p of payments) {
      const code = paymentAccountCode(p.method);
      lines.push({
        code, debit: p.amount, credit: 0,
        drawer_id: code === '1010' ? await currentDrawerId(tx) : null,
        customer_id: code === '1300' ? event.customer_id || null : null,
        memo: `${p.method} settlement${p.reference_number ? ` ${p.reference_number}` : ''}`,
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
    for (const p of payments) {
      await tx.run(
        `INSERT INTO event_deposits
           (event_id, entry_type, amount, payment_method, reference_number, received_on,
            notes, status, business_day_id, customer_id, created_by)
         VALUES (?, 'adjustment', ?, ?, ?, ?, 'Final settlement', 'active', ?, ?, ?)`,
        [event.id, p.amount, p.method, p.reference_number, entryDate,
         businessDayId, event.customer_id || null, actor.id || null]
      );
    }

    const fullySettled = advances + collected + 0.009 >= grandTotal;
    await tx.run(
      `UPDATE events
          SET status = ?, payment_status = ?,
              total_amount = ?, subtotal = ?, service_charge_amount = ?, tax_amount = ?,
              deposit_total = ?, outstanding_amount = ?,
              updated_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [
        EVENT_STATUS.COMPLETED,
        fullySettled ? EVENT_PAYMENT_STATUS.PAID : EVENT_PAYMENT_STATUS.PARTIALLY_PAID,
        grandTotal, statement.subtotal, statement.service_charge, taxTotal,
        round2(advances + collected), round2(grandTotal - advances - collected),
        actor.id || null, event.id,
      ]
    );

    await logEventAudit(tx, {
      action: EVENT_AUDIT_ACTION.FINAL_BILLED,
      eventId: event.id, entityType: 'event', entityId: event.id, actor,
      reason: cleanText(data.notes, 300),
      next: {
        grand_total: grandTotal, advances_applied: advanceApplied,
        collected, revenue_recognised: revenuePortion, tax: taxPortion,
        journal_id: id, payments: payments.map((p) => `${p.method}:${p.amount}`),
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
    journal_id: journalId,
    advances_applied: advanceApplied,
    collected,
    revenue_recognised: revenuePortion,
    tax_recognised: taxPortion,
  };
}

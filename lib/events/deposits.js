/**
 * Event deposits, installment schedules and refunds.
 *
 * THE ACCOUNTING RULE THIS MODULE EXISTS TO ENFORCE:
 * money received before an event is a LIABILITY, not revenue.
 *
 *   receive   Dr Cash/Bank/QR clearing      Cr 2030 Event Customer Advances
 *   refund    Dr 2030 Event Customer Advances   Cr Cash/Bank
 *   void      the exact reverse of whichever entry it cancels
 *
 * Revenue is recognised once, at final billing (Phase 14), by releasing 2030
 * into 4010 Sales Revenue. Booking a deposit as sales would overstate revenue
 * in the month the money lands, understate it in the month the event runs, and
 * book profit on events that are later cancelled and refunded.
 *
 * Everything posts through postJournal() in lib/accounting.js — the same engine
 * as sales, purchases, payroll and wastage. There is no second ledger, no
 * stored balance, and no bespoke tax maths here.
 */
import {
  postJournal, paymentAccountCode, currentDrawerId, ensureAccountingSchema, accountIdByCode,
} from '../accounting.js';
import { currentBusinessDayId } from '../business-days.js';
import { nepalDateString } from '../report-dates.js';
import { ensureEventsSchema } from './schema.js';
import { logEventAudit } from './audit.js';
import { recalculateEventTotals } from './lines.js';
import {
  EVENT_AUDIT_ACTION, EVENT_PAYMENT_STATUS, TERMINAL_STATUSES,
  SCHEDULE_TYPES, SCHEDULE_AMOUNT_TYPES, DEPOSIT_ENTRY_TYPE,
} from './constants.js';

const fail = (message, status = 400, extra = {}) => {
  throw Object.assign(new Error(message), { status, ...extra });
};
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const cleanText = (v, max = 300) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

/** The liability account event advances sit in until the event is invoiced. */
export const ADVANCES_ACCOUNT_CODE = '2030';

async function assertAdvancesAccount(db) {
  await ensureAccountingSchema(db);
  try {
    await accountIdByCode(db, ADVANCES_ACCOUNT_CODE);
  } catch {
    fail(
      'The Event Customer Advances account (2030) is missing. Run database migration 046.',
      503,
      { code: 'advances_account_missing' }
    );
  }
}

/* ------------------------------------------------------- payment schedule */

export async function listSchedule(db, eventId) {
  await ensureEventsSchema(db);
  return db.all(
    `SELECT * FROM event_payment_schedule WHERE event_id = ? ORDER BY sort_order, id`,
    [Number(eventId)]
  );
}

/**
 * Replace an event's payment plan.
 *
 * A percentage instalment resolves against the event total at the moment the
 * plan is saved and the resolved figure is stored, so the client is told a real
 * number rather than one that silently moves when the quote changes.
 */
export async function setSchedule(db, eventId, rows = [], actor = {}) {
  await ensureEventsSchema(db);
  const event = await db.get('SELECT * FROM events WHERE id = ?', [Number(eventId)]);
  if (!event) fail('Event not found.', 404);
  if (TERMINAL_STATUSES.includes(event.status)) {
    fail(`A ${event.status.toLowerCase()} event's payment plan can no longer be changed.`, 409);
  }

  const total = round2(event.total_amount);
  const clean = (Array.isArray(rows) ? rows : []).map((r, i) => {
    const label = cleanText(r.label, 120) || `Instalment ${i + 1}`;
    const scheduleType = SCHEDULE_TYPES.includes(r.schedule_type) ? r.schedule_type : 'installment';
    const amountType = SCHEDULE_AMOUNT_TYPES.includes(r.amount_type) ? r.amount_type : 'fixed';
    const value = Number(r.amount_value);
    if (!Number.isFinite(value) || value < 0) fail(`${label}: amount must be zero or more.`);
    if (amountType === 'percent' && value > 100) fail(`${label}: a percentage cannot exceed 100.`);
    const due = amountType === 'percent' ? round2((total * value) / 100) : round2(value);
    return {
      label, schedule_type: scheduleType, amount_type: amountType,
      amount_value: round2(value), due_amount: due,
      due_date: cleanText(r.due_date, 10), sort_order: i,
    };
  });

  const planned = round2(clean.reduce((s, r) => s + r.due_amount, 0));
  const warnings = [];
  if (total > 0 && planned > total + 0.009) {
    warnings.push(`The plan collects ${planned} against a total of ${total} — ${round2(planned - total)} more than the event is worth.`);
  } else if (total > 0 && planned < total - 0.009) {
    warnings.push(`The plan collects ${planned} of ${total} — ${round2(total - planned)} is unscheduled.`);
  }

  const previous = await listSchedule(db, event.id);
  await db.transaction(async (tx) => {
    // Instalments that already carry a payment must not be silently dropped.
    const paid = previous.filter((p) => Number(p.paid_amount || 0) > 0);
    if (paid.length && clean.length < paid.length) {
      fail('An instalment that has already been paid cannot be removed from the plan.', 409, {
        code: 'schedule_has_payments',
      });
    }
    await tx.run('DELETE FROM event_payment_schedule WHERE event_id = ? AND paid_amount = 0', [event.id]);
    for (const r of clean) {
      const existing = paid.find((p) => p.label === r.label);
      if (existing) continue; // keep a paid row exactly as it stands
      await tx.run(
        `INSERT INTO event_payment_schedule
           (event_id, label, schedule_type, amount_type, amount_value, due_amount, due_date, sort_order, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [event.id, r.label, r.schedule_type, r.amount_type, r.amount_value, r.due_amount, r.due_date, r.sort_order, actor.id || null]
      );
    }
    await logEventAudit(tx, {
      action: EVENT_AUDIT_ACTION.UPDATED,
      eventId: event.id, entityType: 'payment_schedule', entityId: event.id, actor,
      previous: previous.map((p) => ({ label: p.label, due: p.due_amount })),
      next: clean.map((c) => ({ label: c.label, due: c.due_amount })),
      detail: 'payment schedule set',
    });
  });

  await refreshPaymentStatus(db, event.id);
  return { schedule: await listSchedule(db, event.id), warnings };
}

/* --------------------------------------------------------------- deposits */

export async function listDeposits(db, eventId, { includeVoided = false } = {}) {
  await ensureEventsSchema(db);
  const where = includeVoided ? '' : "AND d.status = 'active'";
  return db.all(
    `SELECT d.*, u.full_name AS created_by_name, s.label AS schedule_label
       FROM event_deposits d
       LEFT JOIN users u ON u.id = d.created_by
       LEFT JOIN event_payment_schedule s ON s.id = d.schedule_id
      WHERE d.event_id = ? ${where}
      ORDER BY d.received_on, d.id`,
    [Number(eventId)]
  );
}

/** Net of refunds — what the venue is actually holding for this event. */
export async function depositBalance(db, eventId) {
  await ensureEventsSchema(db);
  const row = await db.get(
    `SELECT COALESCE(SUM(CASE WHEN entry_type = 'refund' THEN -amount ELSE amount END), 0) AS held
       FROM event_deposits WHERE event_id = ? AND status = 'active'`,
    [Number(eventId)]
  );
  return round2(row?.held || 0);
}

/** Keep events.payment_status honest against what has actually been received. */
export async function refreshPaymentStatus(db, eventId, { tx = null } = {}) {
  const handle = tx || db;
  const event = await handle.get('SELECT * FROM events WHERE id = ?', [Number(eventId)]);
  if (!event) return null;

  const held = await depositBalance(handle === db ? db : handle, event.id);
  const total = round2(event.total_amount);
  const refunds = await handle.get(
    `SELECT COALESCE(SUM(amount), 0) AS n FROM event_deposits
      WHERE event_id = ? AND status = 'active' AND entry_type = 'refund'`,
    [event.id]
  );
  const scheduled = await handle.get(
    `SELECT COALESCE(SUM(due_amount), 0) AS due FROM event_payment_schedule
      WHERE event_id = ? AND status NOT IN ('waived', 'cancelled')`,
    [event.id]
  );

  let status;
  if (held <= 0.009 && Number(refunds?.n || 0) > 0) status = EVENT_PAYMENT_STATUS.REFUNDED;
  else if (held <= 0.009) {
    status = Number(scheduled?.due || 0) > 0 ? EVENT_PAYMENT_STATUS.DEPOSIT_DUE : EVENT_PAYMENT_STATUS.UNPAID;
  } else if (total > 0 && held + 0.009 >= total) status = EVENT_PAYMENT_STATUS.PAID;
  else status = EVENT_PAYMENT_STATUS.PARTIALLY_PAID;

  await handle.run(
    'UPDATE events SET payment_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [status, event.id]
  );
  return status;
}

/**
 * Record money received against an event.
 *
 * Posts Dr <payment account> / Cr 2030 Event Customer Advances. Never touches
 * 4010 Sales Revenue — that only happens at final billing.
 */
export async function collectDeposit(db, eventId, data = {}, actor = {}) {
  await ensureEventsSchema(db);
  await assertAdvancesAccount(db);

  const event = await db.get('SELECT * FROM events WHERE id = ?', [Number(eventId)]);
  if (!event) fail('Event not found.', 404);
  if (event.status === 'CANCELLED') {
    fail('This event is cancelled. Record a refund instead of taking more money.', 409);
  }

  const amount = round2(data.amount);
  if (!(amount > 0)) fail('Enter a deposit amount greater than zero.');

  const method = String(data.payment_method || 'cash').toLowerCase().trim();
  // Throws on an unmapped method rather than silently posting to cash.
  const accountCode = paymentAccountCode(method);

  const idempotencyKey = cleanText(data.idempotency_key, 100);
  if (idempotencyKey) {
    const existing = await db.get(
      'SELECT * FROM event_deposits WHERE idempotency_key = ?', [idempotencyKey]
    );
    if (existing) {
      // A retried submit must never take the money twice.
      return { deposit: existing, idempotent: true, balance: await depositBalance(db, event.id) };
    }
  }

  // Overpayment guard: the venue should not hold more than the event is worth.
  const held = await depositBalance(db, event.id);
  const total = round2(event.total_amount);
  if (total > 0 && held + amount > total + 0.009 && !data.allow_overpayment) {
    fail(
      `That would hold ${round2(held + amount)} against an event worth ${total}. Reduce the amount, or confirm the overpayment.`,
      409,
      { code: 'overpayment', held, total, attempted: amount, overpay_by: round2(held + amount - total) }
    );
  }

  const businessDayId = await currentBusinessDayId(db, { required: true, allowStale: true });
  const receivedOn = cleanText(data.received_on, 10) || nepalDateString();

  const depositId = await db.transaction(async (tx) => {
    const res = await tx.run(
      `INSERT INTO event_deposits
         (event_id, schedule_id, entry_type, amount, payment_method, provider, reference_number,
          received_on, notes, status, business_day_id, customer_id, idempotency_key, created_by)
       VALUES (?, ?, 'deposit', ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      [
        event.id, data.schedule_id ? Number(data.schedule_id) : null, amount, method,
        cleanText(data.provider, 60), cleanText(data.reference_number, 120), receivedOn,
        cleanText(data.notes, 400), businessDayId, event.customer_id || null,
        idempotencyKey, actor.id || null,
      ]
    );
    const id = res.lastInsertRowid;

    const drawerId = accountCode === '1010' ? await currentDrawerId(tx) : null;
    const journalId = await postJournal(tx, {
      entry_date: receivedOn,
      memo: `Event advance — ${event.event_number}`,
      source_type: 'event_deposit',
      source_id: id,
      created_by: actor.id || null,
      business_day_id: businessDayId,
      lines: [
        { code: accountCode, debit: amount, credit: 0, drawer_id: drawerId, customer_id: event.customer_id || null, memo: `${method} advance` },
        { code: ADVANCES_ACCOUNT_CODE, debit: 0, credit: amount, customer_id: event.customer_id || null, memo: `Advance held for ${event.event_number}` },
      ],
    });
    await tx.run('UPDATE event_deposits SET journal_id = ? WHERE id = ?', [journalId, id]);

    if (data.schedule_id) {
      await tx.run(
        `UPDATE event_payment_schedule
            SET paid_amount = paid_amount + ?,
                status = CASE WHEN paid_amount + ? + 0.009 >= due_amount THEN 'paid' ELSE 'partial' END,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND event_id = ?`,
        [amount, amount, Number(data.schedule_id), event.id]
      );
    }

    await logEventAudit(tx, {
      action: EVENT_AUDIT_ACTION.DEPOSIT_COLLECTED,
      eventId: event.id, entityType: 'deposit', entityId: id, actor,
      reason: cleanText(data.notes, 400),
      next: { amount, method, reference: cleanText(data.reference_number, 120), journal_id: journalId },
    });
    return id;
  });

  await recalculateEventTotals(db, event.id);
  await refreshPaymentStatus(db, event.id);

  return {
    deposit: await db.get('SELECT * FROM event_deposits WHERE id = ?', [depositId]),
    idempotent: false,
    balance: await depositBalance(db, event.id),
  };
}

/**
 * Refund part or all of what is held.
 *
 * Posts Dr 2030 / Cr <payment account>: the liability shrinks and the asset
 * leaves. A refund can never exceed what is actually held.
 */
export async function refundDeposit(db, eventId, data = {}, actor = {}) {
  await ensureEventsSchema(db);
  await assertAdvancesAccount(db);

  const event = await db.get('SELECT * FROM events WHERE id = ?', [Number(eventId)]);
  if (!event) fail('Event not found.', 404);

  const amount = round2(data.amount);
  if (!(amount > 0)) fail('Enter a refund amount greater than zero.');
  const reason = cleanText(data.reason, 400);
  if (!reason) fail('A reason is required to refund a deposit.');

  const held = await depositBalance(db, event.id);
  if (amount > held + 0.009) {
    fail(`Only ${held} is held for this event; ${amount} cannot be refunded.`, 409, {
      code: 'refund_exceeds_held', held,
    });
  }

  const method = String(data.payment_method || 'cash').toLowerCase().trim();
  const accountCode = paymentAccountCode(method);
  const idempotencyKey = cleanText(data.idempotency_key, 100);
  if (idempotencyKey) {
    const existing = await db.get('SELECT * FROM event_deposits WHERE idempotency_key = ?', [idempotencyKey]);
    if (existing) return { refund: existing, idempotent: true, balance: held };
  }

  const businessDayId = await currentBusinessDayId(db, { required: true, allowStale: true });
  const receivedOn = cleanText(data.received_on, 10) || nepalDateString();

  const refundId = await db.transaction(async (tx) => {
    const res = await tx.run(
      `INSERT INTO event_deposits
         (event_id, entry_type, amount, payment_method, provider, reference_number,
          received_on, notes, status, business_day_id, customer_id, idempotency_key, created_by)
       VALUES (?, 'refund', ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      [
        event.id, amount, method, cleanText(data.provider, 60), cleanText(data.reference_number, 120),
        receivedOn, reason, businessDayId, event.customer_id || null, idempotencyKey, actor.id || null,
      ]
    );
    const id = res.lastInsertRowid;

    const drawerId = accountCode === '1010' ? await currentDrawerId(tx) : null;
    const journalId = await postJournal(tx, {
      entry_date: receivedOn,
      memo: `Event advance refunded — ${event.event_number}: ${reason}`,
      source_type: 'event_deposit_refund',
      source_id: id,
      created_by: actor.id || null,
      business_day_id: businessDayId,
      lines: [
        { code: ADVANCES_ACCOUNT_CODE, debit: amount, credit: 0, customer_id: event.customer_id || null, memo: 'Advance released' },
        { code: accountCode, debit: 0, credit: amount, drawer_id: drawerId, memo: `${method} refund` },
      ],
    });
    await tx.run('UPDATE event_deposits SET journal_id = ? WHERE id = ?', [journalId, id]);

    await logEventAudit(tx, {
      action: EVENT_AUDIT_ACTION.DEPOSIT_REFUNDED,
      eventId: event.id, entityType: 'deposit', entityId: id, actor, reason,
      next: { amount, method, journal_id: journalId },
    });
    return id;
  });

  await recalculateEventTotals(db, event.id);
  await refreshPaymentStatus(db, event.id);

  return {
    refund: await db.get('SELECT * FROM event_deposits WHERE id = ?', [refundId]),
    idempotent: false,
    balance: await depositBalance(db, event.id),
  };
}

/**
 * Void an entry recorded in error, reversing its journal exactly.
 *
 * A void is not a refund: it says the entry should never have existed, so the
 * reversal mirrors whichever direction the original went.
 */
export async function voidDeposit(db, depositId, reason, actor = {}) {
  await ensureEventsSchema(db);
  const clean = cleanText(reason, 400);
  if (!clean) fail('A reason is required to void a deposit entry.');

  const row = await db.get('SELECT * FROM event_deposits WHERE id = ?', [Number(depositId)]);
  if (!row) fail('Deposit entry not found.', 404);
  if (row.status === 'voided') fail('That entry is already voided.', 409);

  const event = await db.get('SELECT * FROM events WHERE id = ?', [row.event_id]);
  const accountCode = paymentAccountCode(row.payment_method);
  const amount = round2(row.amount);
  const isRefund = row.entry_type === DEPOSIT_ENTRY_TYPE.REFUND;

  await db.transaction(async (tx) => {
    const drawerId = accountCode === '1010' ? await currentDrawerId(tx) : null;
    await postJournal(tx, {
      entry_date: nepalDateString(),
      memo: `Void event ${row.entry_type} #${row.id}: ${clean}`,
      source_type: 'event_deposit_void',
      source_id: row.id,
      created_by: actor.id || null,
      business_day_id: row.business_day_id || null,
      lines: isRefund
        // Reversing a refund: the money comes back and the liability returns.
        ? [
          { code: accountCode, debit: amount, credit: 0, drawer_id: drawerId, memo: 'Refund reversed' },
          { code: ADVANCES_ACCOUNT_CODE, debit: 0, credit: amount, memo: 'Advance restored' },
        ]
        // Reversing a receipt: the liability clears and the asset leaves.
        : [
          { code: ADVANCES_ACCOUNT_CODE, debit: amount, credit: 0, memo: 'Advance reversed' },
          { code: accountCode, debit: 0, credit: amount, drawer_id: drawerId, memo: 'Receipt reversed' },
        ],
    });
    await tx.run(
      `UPDATE event_deposits SET status = 'voided', voided_by = ?, voided_at = CURRENT_TIMESTAMP, void_reason = ? WHERE id = ?`,
      [actor.id || null, clean, row.id]
    );
    if (row.schedule_id && !isRefund) {
      await tx.run(
        `UPDATE event_payment_schedule
            SET paid_amount = CASE WHEN paid_amount - ? < 0 THEN 0 ELSE paid_amount - ? END,
                status = 'pending', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [amount, amount, row.schedule_id]
      );
    }
    await logEventAudit(tx, {
      action: EVENT_AUDIT_ACTION.DEPOSIT_VOIDED,
      eventId: row.event_id, entityType: 'deposit', entityId: row.id, actor, reason: clean,
      previous: { amount, type: row.entry_type },
    });
  });

  await recalculateEventTotals(db, event.id);
  await refreshPaymentStatus(db, event.id);
  return db.get('SELECT * FROM event_deposits WHERE id = ?', [row.id]);
}

/** Everything the deposits screen needs in one read. */
export async function depositSummary(db, eventId) {
  const event = await db.get('SELECT * FROM events WHERE id = ?', [Number(eventId)]);
  if (!event) fail('Event not found.', 404);
  const [schedule, deposits, held] = await Promise.all([
    listSchedule(db, event.id),
    listDeposits(db, event.id, { includeVoided: true }),
    depositBalance(db, event.id),
  ]);
  return {
    event_id: event.id,
    total: round2(event.total_amount),
    held,
    outstanding: round2(round2(event.total_amount) - held),
    payment_status: event.payment_status,
    schedule,
    deposits,
  };
}

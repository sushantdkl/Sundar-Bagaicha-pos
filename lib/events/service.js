/**
 * Events service — create/read/update/cancel a booking, plus the dashboard and
 * calendar aggregates.
 *
 * Reuses the existing engines rather than duplicating them:
 *   - nextDocumentNumber()  for EVT-001 style numbers
 *   - customers            via phone-normalised lookup, same as sales
 *   - postJournal()        NOT called here — a booking is not a financial event
 *   - stock                NOT touched — booking must never move inventory
 *
 * Every mutation runs in a transaction with its audit row, so an action and
 * its evidence commit or roll back together.
 */
import { nextDocumentNumber } from '../document-numbers.js';
import { normalizePhone, ensureCustomersTable } from '../customers.js';
import { nepalDateString } from '../report-dates.js';
import { ensureEventsSchema } from './schema.js';
import { logEventAudit } from './audit.js';
import { findSpaceConflicts, checkCapacity, toDateString } from './conflicts.js';
import {
  EVENT_STATUS,
  EVENT_PAYMENT_STATUS,
  EVENT_DOCUMENT,
  BLOCKING_STATUSES,
  COMMITTED_STATUSES,
  TERMINAL_STATUSES,
  EVENT_AUDIT_ACTION,
  assertTransition,
} from './constants.js';

const fail = (message, status = 400, extra = {}) => {
  throw Object.assign(new Error(message), { status, ...extra });
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/* ------------------------------------------------------------- validation */

function cleanText(value, { max = 2000 } = {}) {
  const s = String(value ?? '').trim();
  return s ? s.slice(0, max) : null;
}

function parseGuests(value, label) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) fail(`${label} must be a number.`);
  if (!Number.isInteger(n)) fail(`${label} must be a whole number of people.`);
  if (n < 0) fail(`${label} cannot be negative.`);
  if (n > 100000) fail(`${label} looks unrealistic.`);
  return n;
}

/** Shared field validation for create and update. */
function validateEventFields(data, { partial = false } = {}) {
  const out = {};

  if (!partial || data.event_type !== undefined) {
    const type = cleanText(data.event_type, { max: 80 });
    if (!type) fail('Choose an event type.');
    out.event_type = type;
  }

  if (!partial || data.event_date !== undefined) {
    const date = cleanText(data.event_date, { max: 10 });
    if (!date || !DATE_RE.test(date)) fail('Enter the event date as YYYY-MM-DD.');
    out.event_date = date;
  }

  if (data.end_date !== undefined) {
    const end = cleanText(data.end_date, { max: 10 });
    if (end && !DATE_RE.test(end)) fail('Enter the end date as YYYY-MM-DD.');
    out.end_date = end || null;
  }

  for (const key of ['start_time', 'end_time']) {
    if (data[key] === undefined) continue;
    const t = cleanText(data[key], { max: 5 });
    if (t && !TIME_RE.test(t)) fail(`Enter ${key.replace('_', ' ')} as HH:MM.`);
    out[key] = t || null;
  }

  if (data.expected_guests !== undefined) out.expected_guests = parseGuests(data.expected_guests, 'Expected guests');
  if (data.guaranteed_guests !== undefined) out.guaranteed_guests = parseGuests(data.guaranteed_guests, 'Guaranteed guests');
  if (data.actual_guests !== undefined) out.actual_guests = parseGuests(data.actual_guests, 'Actual guests');

  if (data.space_id !== undefined) {
    out.space_id = data.space_id === '' || data.space_id == null ? null : Number(data.space_id);
    if (out.space_id != null && !Number.isInteger(out.space_id)) fail('Choose a valid event space.');
  }

  if (data.title !== undefined) out.title = cleanText(data.title, { max: 200 });
  if (data.notes !== undefined) out.notes = cleanText(data.notes);
  if (data.internal_notes !== undefined) out.internal_notes = cleanText(data.internal_notes);
  if (data.contact_name !== undefined) out.contact_name = cleanText(data.contact_name, { max: 120 });
  if (data.contact_email !== undefined) out.contact_email = cleanText(data.contact_email, { max: 160 });
  if (data.contact_phone !== undefined) out.contact_phone = cleanText(data.contact_phone, { max: 40 });

  return out;
}

/** Date/time coherence, checked once both halves are known. */
function assertChronology(event) {
  const startDate = event.event_date;
  const endDate = event.end_date || startDate;
  if (endDate < startDate) fail('The event cannot end before it starts.');
  if (endDate === startDate && event.start_time && event.end_time && event.end_time <= event.start_time) {
    fail('The end time must be after the start time.');
  }
  if (
    event.guaranteed_guests != null && event.expected_guests != null &&
    event.guaranteed_guests > event.expected_guests * 10
  ) {
    fail('Guaranteed guests looks inconsistent with expected guests.');
  }
}

/* ------------------------------------------------------------- customers */

/**
 * Link the booking to a customer record, reusing the same phone-normalised
 * identity the sales side uses so an event customer and a walk-in customer are
 * the same person.
 */
async function resolveCustomer(db, data) {
  const phone = cleanText(data.contact_phone, { max: 40 });
  const name = cleanText(data.contact_name, { max: 120 });
  if (data.customer_id) {
    const existing = await db.get('SELECT * FROM customers WHERE id = ?', [Number(data.customer_id)]);
    if (!existing) fail('That customer no longer exists.', 404);
    return existing;
  }
  if (!phone) return null;

  await ensureCustomersTable(db);
  const digits = normalizePhone(phone);
  const found = await db.get(
    'SELECT * FROM customers WHERE phone_digits = ? OR phone = ? ORDER BY id LIMIT 1',
    [digits, phone]
  );
  if (found) return found;
  if (!name) return null;

  const inserted = await db.run(
    'INSERT INTO customers (name, phone, phone_digits) VALUES (?, ?, ?)',
    [name, phone, digits]
  );
  return db.get('SELECT * FROM customers WHERE id = ?', [inserted.lastInsertRowid]);
}

/* ---------------------------------------------------------------- reads */

const EVENT_SELECT = `
  SELECT e.*,
         s.name AS space_name,
         s.max_capacity AS space_max_capacity,
         s.min_capacity AS space_min_capacity,
         s.standard_charge AS space_standard_charge,
         c.name AS customer_name,
         c.phone AS customer_phone,
         cu.full_name AS created_by_name
    FROM events e
    LEFT JOIN event_spaces s ON s.id = e.space_id
    LEFT JOIN customers c ON c.id = e.customer_id
    LEFT JOIN users cu ON cu.id = e.created_by`;

/**
 * Normalise calendar columns to 'YYYY-MM-DD'.
 *
 * The Postgres driver maps a DATE column to a JS Date at local midnight, which
 * serialises through UTC and lands a Nepal (+05:45) booking on the previous
 * day. Every event read goes through here so the API always returns the
 * wall-clock day that was entered, on either engine.
 */
function normaliseDates(row) {
  if (!row) return row;
  for (const key of ['event_date', 'end_date']) {
    if (row[key] != null) row[key] = toDateString(row[key]);
  }
  return row;
}

export async function getEvent(db, id) {
  await ensureEventsSchema(db);
  const event = await db.get(`${EVENT_SELECT} WHERE e.id = ?`, [Number(id)]);
  if (!event) fail('Event not found.', 404);
  return normaliseDates(event);
}

export async function listEvents(db, filters = {}) {
  await ensureEventsSchema(db);
  const where = [];
  const params = [];

  if (filters.status && filters.status !== 'all') {
    where.push('e.status = ?');
    params.push(filters.status);
  }
  if (filters.exclude_cancelled) {
    where.push(`e.status != '${EVENT_STATUS.CANCELLED}'`);
  }
  if (filters.space_id) {
    where.push('e.space_id = ?');
    params.push(Number(filters.space_id));
  }
  if (filters.customer_id) {
    where.push('e.customer_id = ?');
    params.push(Number(filters.customer_id));
  }
  if (filters.from) {
    where.push('COALESCE(e.end_date, e.event_date) >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    where.push('e.event_date <= ?');
    params.push(filters.to);
  }
  if (filters.search) {
    const q = `%${String(filters.search).toLowerCase()}%`;
    where.push(`(LOWER(e.event_number) LIKE ? OR LOWER(COALESCE(e.title,'')) LIKE ?
                 OR LOWER(COALESCE(e.contact_name,'')) LIKE ? OR LOWER(COALESCE(e.contact_phone,'')) LIKE ?
                 OR LOWER(COALESCE(c.name,'')) LIKE ?)`);
    params.push(q, q, q, q, q);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(filters.pageSize) || 50));
  const offset = (page - 1) * pageSize;

  const total = await db.get(
    `SELECT COUNT(*) AS n FROM events e LEFT JOIN customers c ON c.id = e.customer_id ${whereSql}`,
    params
  );
  const rows = await db.all(
    `${EVENT_SELECT} ${whereSql} ORDER BY e.event_date DESC, e.id DESC LIMIT ${pageSize} OFFSET ${offset}`,
    params
  );

  return {
    rows: rows.map(normaliseDates),
    pagination: {
      page,
      pageSize,
      total: Number(total?.n || 0),
      pages: Math.max(1, Math.ceil(Number(total?.n || 0) / pageSize)),
    },
  };
}

/* ------------------------------------------------------- space enforcement */

/**
 * Gate a booking against its space: active, available, and within capacity.
 *
 * Two breaches are blocking, and both can be overridden by a manager who says
 * why — the override is never silent, and never implicit:
 *
 *   - space_conflict  a committed booking already holds the slot
 *   - capacity        more guests than the room holds
 *
 * The caller passes `capacity_override` / `conflict_override` plus an
 * `override_reason`. Each accepted override is returned so the caller can write
 * its audit row inside the same transaction as the booking itself.
 *
 * Falling below a space's minimum capacity is a warning, not a breach.
 */
async function assertSpaceUsable(db, {
  spaceId, eventDate, endDate, startTime, endTime, guests, status,
  data = {}, excludeEventId = null, requireActive = false,
}) {
  const empty = { warnings: [], overrides: [], space: null };
  if (!spaceId) return empty;

  const reason = String(data.override_reason || '').trim();
  const overrides = [];
  const warnings = [];

  const conflicts = await findSpaceConflicts(db, {
    spaceId, eventDate, endDate, startTime, endTime, excludeEventId,
  });
  const space = conflicts.space;

  // An inactive space may stay attached to existing bookings, but must not be
  // newly assigned — that is what "inactive" means.
  if (requireActive && space && !space.is_active) {
    fail(`${space.name} is inactive and cannot take new bookings.`, 409, { code: 'space_inactive' });
  }

  if (!conflicts.ok && BLOCKING_STATUSES.includes(status)) {
    if (!data.conflict_override) {
      fail(conflicts.blocking[0].message, 409, {
        code: 'space_conflict',
        conflicts: conflicts.blocking,
        overridable: true,
      });
    }
    if (!reason) {
      fail('A reason is required to double-book a space.', 400, { code: 'override_reason_required' });
    }
    overrides.push({
      action: EVENT_AUDIT_ACTION.SPACE_OVERRIDE,
      reason,
      detail: { space: space?.name, conflicts: conflicts.blocking },
    });
  }
  warnings.push(...conflicts.warnings);

  const capacity = checkCapacity(space, guests);
  if (!capacity.ok) {
    if (!data.capacity_override) {
      fail(capacity.breaches[0].message, 409, {
        code: 'capacity_exceeded',
        breaches: capacity.breaches,
        overridable: true,
      });
    }
    if (!reason) {
      fail('A reason is required to exceed a space capacity.', 400, { code: 'override_reason_required' });
    }
    overrides.push({
      action: EVENT_AUDIT_ACTION.CAPACITY_OVERRIDE,
      reason,
      detail: { space: space?.name, breaches: capacity.breaches, guests },
    });
  }
  warnings.push(...capacity.warnings);

  return { warnings, overrides, space };
}

/** Write the audit row for each accepted override, inside the caller's tx. */
async function recordOverrides(tx, overrides, eventId, actor) {
  for (const o of overrides) {
    await logEventAudit(tx, {
      action: o.action,
      eventId,
      entityType: 'event',
      entityId: eventId,
      actor,
      reason: o.reason,
      detail: o.detail,
    });
  }
}

/* --------------------------------------------------------------- create */

export async function createEvent(db, data = {}, actor = {}) {
  await ensureEventsSchema(db);
  const fields = validateEventFields(data);
  assertChronology(fields);

  const status = data.status && Object.values(EVENT_STATUS).includes(data.status)
    ? data.status
    : EVENT_STATUS.INQUIRY;
  if (TERMINAL_STATUSES.includes(status)) {
    fail('A new event cannot start as completed or cancelled.');
  }

  const guard = await assertSpaceUsable(db, {
    spaceId: fields.space_id,
    eventDate: fields.event_date,
    endDate: fields.end_date,
    startTime: fields.start_time,
    endTime: fields.end_time,
    guests: fields.expected_guests,
    status,
    data,
    requireActive: true,
  });

  const customer = await resolveCustomer(db, data);

  const created = await db.transaction(async (tx) => {
    const eventNumber = await nextDocumentNumber(tx, EVENT_DOCUMENT);
    const result = await tx.run(
      `INSERT INTO events (
         event_number, customer_id, contact_name, contact_phone, contact_email,
         title, event_type, event_date, end_date, start_time, end_time,
         space_id, expected_guests, guaranteed_guests, actual_guests,
         status, payment_status, notes, internal_notes,
         created_by, updated_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        eventNumber,
        customer?.id || null,
        fields.contact_name || customer?.name || null,
        fields.contact_phone || customer?.phone || null,
        fields.contact_email || null,
        fields.title || null,
        fields.event_type,
        fields.event_date,
        fields.end_date || null,
        fields.start_time || null,
        fields.end_time || null,
        fields.space_id || null,
        fields.expected_guests ?? null,
        fields.guaranteed_guests ?? null,
        fields.actual_guests ?? null,
        status,
        EVENT_PAYMENT_STATUS.UNPAID,
        fields.notes || null,
        fields.internal_notes || null,
        actor.id || null,
        actor.id || null,
      ]
    );
    const eventId = result.lastInsertRowid;

    await logEventAudit(tx, {
      action: EVENT_AUDIT_ACTION.CREATED,
      eventId,
      entityType: 'event',
      entityId: eventId,
      actor,
      next: { event_number: eventNumber, status, event_date: fields.event_date, space_id: fields.space_id || null },
      detail: guard.warnings.length ? { warnings: guard.warnings } : null,
    });

    await recordOverrides(tx, guard.overrides, eventId, actor);

    return eventId;
  });

  const event = await getEvent(db, created);
  return { event, warnings: guard.warnings };
}

/* --------------------------------------------------------------- update */

const UPDATABLE = [
  'title', 'event_type', 'event_date', 'end_date', 'start_time', 'end_time',
  'space_id', 'expected_guests', 'guaranteed_guests', 'actual_guests',
  'notes', 'internal_notes', 'contact_name', 'contact_phone', 'contact_email',
];

export async function updateEvent(db, id, data = {}, actor = {}) {
  const existing = await getEvent(db, id);
  if (TERMINAL_STATUSES.includes(existing.status)) {
    fail(`A ${existing.status.toLowerCase()} event can no longer be edited.`, 409);
  }

  const fields = validateEventFields(data, { partial: true });
  const merged = { ...existing, ...fields };
  assertChronology(merged);

  const scheduleChanged = ['event_date', 'end_date', 'start_time', 'end_time', 'space_id']
    .some((k) => fields[k] !== undefined && String(fields[k] ?? '') !== String(existing[k] ?? ''));

  // Re-check the space whenever the schedule, the room or the head count moves.
  const guestsChangedForCapacity =
    fields.expected_guests !== undefined &&
    Number(fields.expected_guests ?? 0) !== Number(existing.expected_guests ?? 0);
  let guard = { warnings: [], overrides: [] };
  if ((scheduleChanged || guestsChangedForCapacity) && merged.space_id) {
    guard = await assertSpaceUsable(db, {
      spaceId: merged.space_id,
      eventDate: merged.event_date,
      endDate: merged.end_date,
      startTime: merged.start_time,
      endTime: merged.end_time,
      guests: merged.expected_guests,
      status: existing.status,
      data,
      excludeEventId: existing.id,
      // Only a newly chosen space must be active; an event already sitting in a
      // retired space can still be edited.
      requireActive: fields.space_id !== undefined && fields.space_id !== existing.space_id,
    });
  }
  const warnings = guard.warnings;

  const sets = [];
  const params = [];
  for (const key of UPDATABLE) {
    if (fields[key] === undefined) continue;
    sets.push(`${key} = ?`);
    params.push(fields[key]);
  }
  if (!sets.length) return { event: existing, warnings };

  // Guest-count changes are audited separately — Phase 7 depends on this history.
  const guestChange = ['expected_guests', 'guaranteed_guests', 'actual_guests']
    .filter((k) => fields[k] !== undefined && Number(fields[k] ?? -1) !== Number(existing[k] ?? -1));

  await db.transaction(async (tx) => {
    await tx.run(
      `UPDATE events SET ${sets.join(', ')}, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [...params, actor.id || null, existing.id]
    );

    if (guestChange.length) {
      await logEventAudit(tx, {
        action: EVENT_AUDIT_ACTION.GUESTS_CHANGED,
        eventId: existing.id,
        entityType: 'event',
        entityId: existing.id,
        actor,
        previous: Object.fromEntries(guestChange.map((k) => [k, existing[k]])),
        next: Object.fromEntries(guestChange.map((k) => [k, fields[k]])),
      });
    }

    await recordOverrides(tx, guard.overrides, existing.id, actor);

    const otherChanges = Object.keys(fields).filter((k) => !guestChange.includes(k));
    if (otherChanges.length) {
      await logEventAudit(tx, {
        action: EVENT_AUDIT_ACTION.UPDATED,
        eventId: existing.id,
        entityType: 'event',
        entityId: existing.id,
        actor,
        previous: Object.fromEntries(otherChanges.map((k) => [k, existing[k]])),
        next: Object.fromEntries(otherChanges.map((k) => [k, fields[k]])),
      });
    }
  });

  return { event: await getEvent(db, existing.id), warnings };
}

/* -------------------------------------------------------- status changes */

export async function changeEventStatus(db, id, nextStatus, actor = {}, options = {}) {
  const { reason = null } = options;
  const existing = await getEvent(db, id);
  assertTransition(existing.status, nextStatus);

  // Committing a booking must not double-book a space that a provisional
  // booking was allowed to share, and must not commit an over-capacity room.
  let guard = { warnings: [], overrides: [] };
  if (BLOCKING_STATUSES.includes(nextStatus) && existing.space_id) {
    guard = await assertSpaceUsable(db, {
      spaceId: existing.space_id,
      eventDate: existing.event_date,
      endDate: existing.end_date,
      startTime: existing.start_time,
      endTime: existing.end_time,
      guests: existing.expected_guests,
      status: nextStatus,
      data: options,
      excludeEventId: existing.id,
    });
  }

  const stamps = {
    [EVENT_STATUS.QUOTED]: 'quoted_at',
    [EVENT_STATUS.CONFIRMED]: 'confirmed_at',
    [EVENT_STATUS.FINALIZED]: 'finalized_at',
    [EVENT_STATUS.IN_PROGRESS]: 'started_at',
    [EVENT_STATUS.COMPLETED]: 'completed_at',
  };
  const stampColumn = stamps[nextStatus];

  await db.transaction(async (tx) => {
    await tx.run(
      `UPDATE events
          SET status = ?,
              ${stampColumn ? `${stampColumn} = COALESCE(${stampColumn}, CURRENT_TIMESTAMP),` : ''}
              updated_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [nextStatus, actor.id || null, existing.id]
    );
    await recordOverrides(tx, guard.overrides, existing.id, actor);
    await logEventAudit(tx, {
      action: EVENT_AUDIT_ACTION.STATUS_CHANGED,
      eventId: existing.id,
      entityType: 'event',
      entityId: existing.id,
      actor,
      reason,
      previous: existing.status,
      next: nextStatus,
    });
  });

  return getEvent(db, existing.id);
}

export async function cancelEvent(db, id, reason, actor = {}) {
  const clean = String(reason || '').trim();
  if (!clean) fail('A reason is required to cancel an event.');

  const existing = await getEvent(db, id);
  assertTransition(existing.status, EVENT_STATUS.CANCELLED);

  await db.transaction(async (tx) => {
    await tx.run(
      `UPDATE events
          SET status = ?, cancel_reason = ?, cancelled_at = CURRENT_TIMESTAMP,
              updated_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [EVENT_STATUS.CANCELLED, clean, actor.id || null, existing.id]
    );
    await logEventAudit(tx, {
      action: EVENT_AUDIT_ACTION.CANCELLED,
      eventId: existing.id,
      entityType: 'event',
      entityId: existing.id,
      actor,
      reason: clean,
      previous: existing.status,
      next: EVENT_STATUS.CANCELLED,
    });
  });

  // Deposits already taken are deliberately left untouched: refunding is a
  // separate, audited financial decision (Phase 9), not a side effect.
  return getEvent(db, existing.id);
}

/* ------------------------------------------------------------ dashboard */

const committedList = COMMITTED_STATUSES.map((s) => `'${s}'`).join(',');

export async function eventsDashboard(db, { today = nepalDateString() } = {}) {
  await ensureEventsSchema(db);
  const monthStart = `${today.slice(0, 7)}-01`;
  // Month end is computed here rather than with SQLite's date(x, '+1 month'),
  // which PostgreSQL has no equivalent for.
  const [curYear, curMonth] = today.split('-').map(Number);
  const lastDay = new Date(Date.UTC(curYear, curMonth, 0)).getUTCDate();
  const monthEnd = `${today.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;

  const [todayRow, upcoming, month, guests, confirmedValue, deposits, outstanding, completed] =
    await Promise.all([
      db.get(
        `SELECT COUNT(*) AS n, COALESCE(SUM(COALESCE(guaranteed_guests, expected_guests, 0)), 0) AS guests
           FROM events
          WHERE event_date = ? AND status != '${EVENT_STATUS.CANCELLED}'`,
        [today]
      ),
      db.get(
        `SELECT COUNT(*) AS n FROM events
          WHERE event_date > ? AND status IN (${committedList})`,
        [today]
      ),
      db.get(
        `SELECT COUNT(*) AS n FROM events
          WHERE event_date BETWEEN ? AND ?
            AND status != '${EVENT_STATUS.CANCELLED}'`,
        [monthStart, monthEnd]
      ),
      db.get(
        `SELECT COALESCE(SUM(COALESCE(guaranteed_guests, expected_guests, 0)), 0) AS n
           FROM events
          WHERE event_date >= ? AND status IN (${committedList})`,
        [today]
      ),
      db.get(
        `SELECT COALESCE(SUM(total_amount), 0) AS v FROM events
          WHERE status IN (${committedList}) AND status != '${EVENT_STATUS.COMPLETED}'`
      ),
      db.get(
        `SELECT COALESCE(SUM(amount), 0) AS v FROM event_deposits
          WHERE status = 'active' AND entry_type = 'deposit'`
      ),
      db.get(
        `SELECT COALESCE(SUM(outstanding_amount), 0) AS v FROM events
          WHERE status IN (${committedList})`
      ),
      db.get(
        `SELECT COUNT(*) AS n, COALESCE(SUM(total_amount), 0) AS v FROM events
          WHERE status = '${EVENT_STATUS.COMPLETED}'`
      ),
    ]);

  return {
    today,
    events_today: Number(todayRow?.n || 0),
    guests_today: Number(todayRow?.guests || 0),
    upcoming_events: Number(upcoming?.n || 0),
    events_this_month: Number(month?.n || 0),
    expected_guests: Number(guests?.n || 0),
    confirmed_value: round2(confirmedValue?.v),
    deposits_received: round2(deposits?.v),
    outstanding_balance: round2(outstanding?.v),
    completed_events: Number(completed?.n || 0),
    completed_revenue: round2(completed?.v),
  };
}

/** Calendar feed. Cancelled bookings are excluded unless explicitly asked for. */
export async function calendarEvents(db, { from, to, includeCancelled = false } = {}) {
  await ensureEventsSchema(db);
  if (!from || !to) fail('A calendar range needs a from and to date.');

  const where = [
    'COALESCE(e.end_date, e.event_date) >= ?',
    'e.event_date <= ?',
  ];
  if (!includeCancelled) where.push(`e.status != '${EVENT_STATUS.CANCELLED}'`);

  const rows = await db.all(
    `SELECT e.id, e.event_number, e.title, e.event_type, e.event_date, e.end_date,
            e.start_time, e.end_time, e.status, e.payment_status,
            e.expected_guests, e.guaranteed_guests, e.total_amount,
            e.space_id, s.name AS space_name,
            COALESCE(c.name, e.contact_name) AS customer_name
       FROM events e
       LEFT JOIN event_spaces s ON s.id = e.space_id
       LEFT JOIN customers c ON c.id = e.customer_id
      WHERE ${where.join(' AND ')}
      ORDER BY e.event_date ASC, COALESCE(e.start_time, '00:00') ASC, e.id ASC`,
    [from, to]
  );
  return rows.map(normaliseDates);
}

export { listSpaces } from './spaces.js';

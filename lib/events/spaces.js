/**
 * Event space management.
 *
 * Spaces are business configuration — every value here is entered by the venue.
 * Nothing is seeded and no space name appears in application logic; the module
 * works identically with one space or twenty.
 *
 * Capacity and availability are enforced at booking time (see service.js).
 * A manager may override either, but only with an explicit intent flag and a
 * reason, and every override writes an audit row.
 */
import { ensureEventsSchema } from './schema.js';
import { logEventAudit } from './audit.js';
import { occupancyWindow, toDateString } from './conflicts.js';
import { EVENT_AUDIT_ACTION, BLOCKING_STATUSES, PROVISIONAL_STATUSES } from './constants.js';

const fail = (message, status = 400, extra = {}) => {
  throw Object.assign(new Error(message), { status, ...extra });
};

const cleanText = (value, max = 500) => {
  const s = String(value ?? '').trim();
  return s ? s.slice(0, max) : null;
};

function parseOptionalInt(value, label, { min = 0 } = {}) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) fail(`${label} must be a number.`);
  if (!Number.isInteger(n)) fail(`${label} must be a whole number.`);
  if (n < min) fail(`${label} cannot be less than ${min}.`);
  if (n > 100000) fail(`${label} looks unrealistic.`);
  return n;
}

function parseMoney(value, label) {
  if (value === '' || value == null) return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) fail(`${label} must be a number.`);
  if (n < 0) fail(`${label} cannot be negative.`);
  return Math.round(n * 100) / 100;
}

function validateSpaceFields(data, { partial = false } = {}) {
  const out = {};

  if (!partial || data.name !== undefined) {
    const name = cleanText(data.name, 120);
    if (!name) fail('Enter a name for the space.');
    out.name = name;
  }
  if (data.description !== undefined) out.description = cleanText(data.description, 1000);
  if (data.min_capacity !== undefined) out.min_capacity = parseOptionalInt(data.min_capacity, 'Minimum capacity');
  if (data.max_capacity !== undefined) {
    out.max_capacity = parseOptionalInt(data.max_capacity, 'Maximum capacity', { min: 1 });
  }
  if (data.standard_charge !== undefined) out.standard_charge = parseMoney(data.standard_charge, 'Venue charge');
  if (data.setup_buffer_minutes !== undefined) {
    out.setup_buffer_minutes = parseOptionalInt(data.setup_buffer_minutes, 'Setup buffer') ?? 0;
  }
  if (data.cleanup_buffer_minutes !== undefined) {
    out.cleanup_buffer_minutes = parseOptionalInt(data.cleanup_buffer_minutes, 'Cleanup buffer') ?? 0;
  }
  if (data.display_order !== undefined) out.display_order = parseOptionalInt(data.display_order, 'Display order') ?? 0;
  if (data.is_active !== undefined) out.is_active = data.is_active ? 1 : 0;

  return out;
}

function assertCapacityOrder(space) {
  const min = space.min_capacity;
  const max = space.max_capacity;
  if (min != null && max != null && max < min) {
    fail('Maximum capacity cannot be lower than the minimum capacity.');
  }
}

/* ------------------------------------------------------------------ reads */

export async function listSpaces(db, { activeOnly = false, withUsage = false } = {}) {
  await ensureEventsSchema(db);
  const where = activeOnly ? 'WHERE s.is_active = 1' : '';
  const rows = await db.all(
    `SELECT s.*
       FROM event_spaces s
       ${where}
      ORDER BY s.display_order, s.name`
  );
  if (!withUsage || !rows.length) return rows;

  // Upcoming committed bookings per space — shown on the management screen so
  // nobody deactivates or shrinks a space that is already sold.
  const active = [...BLOCKING_STATUSES];
  const counts = await db.all(
    `SELECT space_id, COUNT(*) AS n
       FROM events
      WHERE space_id IS NOT NULL
        AND status IN (${active.map(() => '?').join(',')})
      GROUP BY space_id`,
    active
  );
  const map = new Map(counts.map((c) => [Number(c.space_id), Number(c.n)]));
  return rows.map((r) => ({ ...r, committed_events: map.get(Number(r.id)) || 0 }));
}

export async function getSpace(db, id) {
  await ensureEventsSchema(db);
  const space = await db.get('SELECT * FROM event_spaces WHERE id = ?', [Number(id)]);
  if (!space) fail('Event space not found.', 404);
  return space;
}

/**
 * Bookings held in a space, with the buffer-extended window each one occupies.
 * This is what the booking screen shows so a user can see why a slot clashes.
 */
export async function spaceBookings(db, id, { from = null, to = null } = {}) {
  const space = await getSpace(db, id);
  const statuses = [...BLOCKING_STATUSES, ...PROVISIONAL_STATUSES];
  const params = [space.id, ...statuses];
  let sql = `SELECT id, event_number, title, event_type, event_date, end_date,
                    start_time, end_time, status, expected_guests, guaranteed_guests
               FROM events
              WHERE space_id = ?
                AND status IN (${statuses.map(() => '?').join(',')})`;
  if (from) { sql += ' AND COALESCE(end_date, event_date) >= ?'; params.push(from); }
  if (to) { sql += ' AND event_date <= ?'; params.push(to); }
  sql += ' ORDER BY event_date, COALESCE(start_time, \'00:00\')';

  const rows = await db.all(sql, params);
  return rows.map((row) => {
    const win = occupancyWindow(row, space);
    return {
      ...row,
      event_date: toDateString(row.event_date),
      end_date: toDateString(row.end_date),
      occupies_from: win ? win.start.toISOString() : null,
      occupies_to: win ? win.end.toISOString() : null,
    };
  });
}

/* ---------------------------------------------------------------- writes */

export async function createSpace(db, data = {}, actor = {}) {
  await ensureEventsSchema(db);
  const fields = validateSpaceFields(data);
  assertCapacityOrder(fields);

  const clash = await db.get('SELECT id FROM event_spaces WHERE LOWER(name) = LOWER(?)', [fields.name]);
  if (clash) fail('A space with that name already exists.', 409);

  const id = await db.transaction(async (tx) => {
    const res = await tx.run(
      `INSERT INTO event_spaces
         (name, description, min_capacity, max_capacity, standard_charge,
          setup_buffer_minutes, cleanup_buffer_minutes, is_active, display_order,
          created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        fields.name,
        fields.description ?? null,
        fields.min_capacity ?? null,
        fields.max_capacity ?? null,
        fields.standard_charge ?? 0,
        fields.setup_buffer_minutes ?? 0,
        fields.cleanup_buffer_minutes ?? 0,
        fields.is_active === 0 ? 0 : 1,
        fields.display_order ?? 0,
        actor.id || null,
      ]
    );
    const newId = res.lastInsertRowid;
    await logEventAudit(tx, {
      action: EVENT_AUDIT_ACTION.SPACE_CONFIG_CHANGED,
      entityType: 'space',
      entityId: newId,
      actor,
      next: fields,
      detail: 'created',
    });
    return newId;
  });

  return getSpace(db, id);
}

const UPDATABLE = [
  'name', 'description', 'min_capacity', 'max_capacity', 'standard_charge',
  'setup_buffer_minutes', 'cleanup_buffer_minutes', 'is_active', 'display_order',
];

export async function updateSpace(db, id, data = {}, actor = {}) {
  const existing = await getSpace(db, id);
  const fields = validateSpaceFields(data, { partial: true });
  assertCapacityOrder({ ...existing, ...fields });

  if (fields.name && fields.name.toLowerCase() !== String(existing.name).toLowerCase()) {
    const clash = await db.get(
      'SELECT id FROM event_spaces WHERE LOWER(name) = LOWER(?) AND id != ?',
      [fields.name, existing.id]
    );
    if (clash) fail('A space with that name already exists.', 409);
  }

  // Deactivating a space that still holds committed bookings would hide it from
  // the very screens those bookings are managed on.
  if (fields.is_active === 0 && existing.is_active) {
    const held = await db.get(
      `SELECT COUNT(*) AS n FROM events
        WHERE space_id = ? AND status IN (${BLOCKING_STATUSES.map(() => '?').join(',')})`,
      [existing.id, ...BLOCKING_STATUSES]
    );
    if (Number(held?.n || 0) > 0) {
      fail(
        `${existing.name} still has ${held.n} committed booking(s). Move or cancel them before deactivating it.`,
        409,
        { code: 'space_in_use' }
      );
    }
  }

  const sets = [];
  const params = [];
  for (const key of UPDATABLE) {
    if (fields[key] === undefined) continue;
    sets.push(`${key} = ?`);
    params.push(fields[key]);
  }
  if (!sets.length) return existing;

  await db.transaction(async (tx) => {
    await tx.run(
      `UPDATE event_spaces SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [...params, existing.id]
    );
    await logEventAudit(tx, {
      action: EVENT_AUDIT_ACTION.SPACE_CONFIG_CHANGED,
      entityType: 'space',
      entityId: existing.id,
      actor,
      previous: Object.fromEntries(Object.keys(fields).map((k) => [k, existing[k]])),
      next: fields,
    });
  });

  return getSpace(db, existing.id);
}

/**
 * Spaces are deactivated, never deleted: historical events reference them and
 * events.space_id is ON DELETE RESTRICT precisely to prevent that loss.
 */
export async function deactivateSpace(db, id, actor = {}) {
  return updateSpace(db, id, { is_active: 0 }, actor);
}

/**
 * Append-only audit trail for sensitive event actions.
 *
 * Mirrors logPosEvent() in lib/kot-service.js so both trails read alike.
 * Pass a transaction-scoped db to record the audit row inside the same
 * transaction as the change it describes — an audited action and its evidence
 * must commit or roll back together.
 */
import { ensureEventsSchema } from './schema.js';

/** Values are stored as text so numbers, strings and objects all round-trip. */
function serialise(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * @param {object} db      database or transaction handle
 * @param {object} entry
 * @param {string} entry.action        one of EVENT_AUDIT_ACTION
 * @param {number} [entry.eventId]     null for configuration-level changes
 * @param {string} [entry.entityType]  'event' | 'menu_line' | 'deposit' | 'space' | 'package' | ...
 * @param {number} [entry.entityId]
 * @param {object} [entry.actor]       { id, full_name, username }
 * @param {string} [entry.reason]
 * @param {*}      [entry.previous]
 * @param {*}      [entry.next]
 * @param {*}      [entry.detail]
 */
export async function logEventAudit(db, entry = {}) {
  const action = String(entry.action || '').trim();
  if (!action) {
    throw Object.assign(new Error('An audit entry needs an action.'), { status: 500 });
  }
  await ensureEventsSchema(db);

  const actor = entry.actor || {};
  await db.run(
    `INSERT INTO event_audit
       (event_id, action, entity_type, entity_id, actor_id, actor_name,
        reason, previous_value, new_value, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.eventId ?? null,
      action,
      entry.entityType || null,
      entry.entityId ?? null,
      actor.id ?? null,
      actor.full_name || actor.username || null,
      entry.reason || null,
      serialise(entry.previous),
      serialise(entry.next),
      serialise(entry.detail),
    ]
  );
}

/**
 * Read the trail for one event, newest first. `limit` is clamped and inlined
 * because SQLite and Postgres disagree on parameterising LIMIT.
 */
export async function eventAuditHistory(db, eventId, { limit = 100 } = {}) {
  await ensureEventsSchema(db);
  const capped = Math.min(500, Math.max(1, Number(limit) || 100));
  return db.all(
    `SELECT * FROM event_audit
      WHERE event_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ${capped}`,
    [eventId]
  );
}

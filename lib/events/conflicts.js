/**
 * Event space availability.
 *
 * Mirrors the shape of lib/reservation-conflicts.js (occupancy window +
 * overlap test) but uses each space's own setup/cleanup buffers instead of the
 * global reservation hold/dining/cleaning settings.
 *
 * A space is occupied from (start - setup_buffer) to (end + cleanup_buffer),
 * so two bookings that merely touch are fine, while a booking that starts
 * during another's teardown is not.
 *
 * Committed bookings (CONFIRMED and later) BLOCK. Provisional ones
 * (INQUIRY/DRAFT/QUOTED) only WARN — a venue routinely holds several tentative
 * enquiries for the same slot and confirms one.
 */
import { BLOCKING_STATUSES, PROVISIONAL_STATUSES } from './constants.js';

const MINUTE = 60 * 1000;

/**
 * A calendar date column can arrive as a 'YYYY-MM-DD' string (SQLite) or as a
 * JS Date built at local midnight (the Postgres driver's DATE mapping). Both
 * normalise to the same wall-clock day here — serialising a Date through UTC
 * would shift Nepal (+05:45) back a day.
 */
export function toDateString(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
  }
  return String(value).slice(0, 10);
}

/** Add or subtract whole days from a YYYY-MM-DD date, staying in wall-clock. */
export function shiftDate(dateStr, days) {
  const base = toDateString(dateStr);
  if (!base) return base;
  const [y, m, d] = base.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Nepal is UTC+05:45; a date+time with no zone is local wall-clock. */
export function eventDateTime(dateStr, timeStr, fallbackTime = '00:00') {
  const day = toDateString(dateStr);
  if (!day) return null;
  const time = /^\d{2}:\d{2}(:\d{2})?$/.test(String(timeStr || '')) ? timeStr : fallbackTime;
  const d = new Date(`${day}T${time.length === 5 ? `${time}:00` : time}+05:45`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The window a booking physically occupies its space for, buffers included.
 * An event with no end time is treated as running to the end of its last day,
 * which is the safe assumption for a venue.
 */
export function occupancyWindow(event, space = {}) {
  const start = eventDateTime(event.event_date, event.start_time, '00:00');
  if (!start) return null;
  const endDate = event.end_date || event.event_date;
  const end = event.end_time
    ? eventDateTime(endDate, event.end_time)
    : eventDateTime(endDate, '23:59');
  if (!end) return null;

  const setup = Number(space.setup_buffer_minutes || 0);
  const cleanup = Number(space.cleanup_buffer_minutes || 0);
  return {
    start: new Date(start.getTime() - setup * MINUTE),
    end: new Date(end.getTime() + cleanup * MINUTE),
    eventStart: start,
    eventEnd: end,
  };
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Find bookings that clash with the proposed one.
 *
 * @returns {{ ok: boolean, blocking: Array, warnings: Array, window: object|null }}
 *   ok=false means a committed booking already holds the space. Callers may
 *   still proceed on `warnings` alone.
 */
export async function findSpaceConflicts(db, {
  spaceId,
  eventDate,
  endDate = null,
  startTime = null,
  endTime = null,
  excludeEventId = null,
}) {
  if (!spaceId || !eventDate) return { ok: true, blocking: [], warnings: [], window: null };

  const space = await db.get('SELECT * FROM event_spaces WHERE id = ?', [spaceId]);
  if (!space) {
    throw Object.assign(new Error('That event space no longer exists.'), { status: 404 });
  }

  const proposed = occupancyWindow(
    { event_date: eventDate, end_date: endDate, start_time: startTime, end_time: endTime },
    space
  );
  if (!proposed) {
    throw Object.assign(new Error('Enter a valid event date and time.'), { status: 400 });
  }

  // Candidate window widened by a day either side so multi-day and
  // buffer-extended bookings are not missed by the date filter.
  //
  // The shift is computed in JavaScript, not in SQL: SQLite's two-argument
  // date(x, '-1 day') has no PostgreSQL equivalent, and lib/db/sql.js only
  // translates the Nepal-offset form. Comparing plain YYYY-MM-DD strings works
  // identically on both engines.
  const relevant = [...BLOCKING_STATUSES, ...PROVISIONAL_STATUSES];
  const lowerBound = shiftDate(eventDate, -1);
  const upperBound = shiftDate(endDate || eventDate, 1);
  let sql = `SELECT id, event_number, title, event_type, event_date, end_date,
                    start_time, end_time, status, expected_guests
               FROM events
              WHERE space_id = ?
                AND status IN (${relevant.map(() => '?').join(',')})
                AND COALESCE(end_date, event_date) >= ?
                AND event_date <= ?`;
  const sqlParams = [spaceId, ...relevant, lowerBound, upperBound];
  if (excludeEventId) {
    sql += ' AND id != ?';
    sqlParams.push(excludeEventId);
  }

  const candidates = await db.all(sql, sqlParams);

  const blocking = [];
  const warnings = [];
  for (const other of candidates) {
    const otherWindow = occupancyWindow(other, space);
    if (!otherWindow) continue;
    if (!overlaps(proposed.start, proposed.end, otherWindow.start, otherWindow.end)) continue;

    const entry = {
      id: other.id,
      event_number: other.event_number,
      title: other.title || other.event_type,
      status: other.status,
      event_date: other.event_date,
      start_time: other.start_time,
      end_time: other.end_time,
      message: `${other.event_number} (${other.status}) already uses ${space.name} in that window.`,
    };
    if (BLOCKING_STATUSES.includes(other.status)) blocking.push(entry);
    else warnings.push({ ...entry, message: `${entry.message} It is only provisional.` });
  }

  return { ok: blocking.length === 0, blocking, warnings, window: proposed, space };
}

/**
 * Capacity check.
 *
 * Exceeding the maximum is a BLOCKING breach — a room cannot hold more people
 * than it holds, and overselling it is a safety problem, not a preference. The
 * caller may still proceed with an explicit, audited manager override.
 *
 * Falling below the minimum is only a warning: it costs the venue money but
 * harms nobody, and venues routinely accept a small party.
 */
export function checkCapacity(space, guests) {
  const count = Number(guests || 0);
  if (!space || !count) return { ok: true, breaches: [], warnings: [] };
  const breaches = [];
  const warnings = [];

  if (space.max_capacity != null && count > Number(space.max_capacity)) {
    breaches.push({
      type: 'capacity',
      message: `${space.name} holds ${space.max_capacity} guests; this booking expects ${count}.`,
    });
  }
  if (space.min_capacity != null && count > 0 && count < Number(space.min_capacity)) {
    warnings.push({
      type: 'min_capacity',
      message: `${space.name} has a ${space.min_capacity} guest minimum; this booking expects ${count}.`,
    });
  }
  return { ok: breaches.length === 0, breaches, warnings };
}

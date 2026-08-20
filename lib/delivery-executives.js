/**
 * Delivery executives — the people who carry delivery orders.
 *
 * ATTRIBUTION, NOT A SECOND SALES SYSTEM
 *
 * Assignment writes one column, `orders.delivery_executive_id`. The order, its
 * KOT, its bill, its stock movements and its revenue are entirely untouched.
 * "Delivered amount" on an executive is therefore a *view* of sales that are
 * already counted once in the Sales Report — summing the two would double the
 * business's revenue, which is exactly what this design avoids.
 *
 * EXECUTIVE STATUS IS NOT ORDER STATUS
 *
 *   order:      preparing → ready → out for delivery → delivered
 *   executive:  AVAILABLE / BUSY / OFF_DUTY
 *
 * They move together but are not the same field. In particular an executive
 * carrying three orders who completes one is still BUSY, so status is always
 * recomputed from the assignments that are actually still open rather than
 * being flipped to AVAILABLE on the first completion.
 */
import { ensureSqliteTable } from './db/ensure-sqlite-table.js';
import { ensureColumn, serialPkSql } from './db/schema-helpers.js';

const fail = (message, status = 400, extra = {}) => {
  throw Object.assign(new Error(message), { status, ...extra });
};
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const clean = (v, max = 200) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

export const EXECUTIVE_STATUSES = ['AVAILABLE', 'BUSY', 'OFF_DUTY'];

export const EXECUTIVE_STATUS_LABEL = {
  AVAILABLE: 'Available',
  BUSY: 'Busy',
  OFF_DUTY: 'Off duty',
};

/** An order still on the road: assigned, not yet completed or cancelled. */
const OPEN_DELIVERY = `LOWER(COALESCE(o.status, '')) NOT IN ('completed', 'cancelled')`;

/** A delivery that actually happened, and so counts toward delivered totals. */
const DONE_DELIVERY = `LOWER(COALESCE(o.status, '')) = 'completed'`;

let READY = false;

/** SQLite parity for dev; Postgres gets all of this from migration 051. */
export async function ensureDeliveryExecutiveSchema(db) {
  if (READY) return;
  const pk = serialPkSql(db);
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS delivery_executives (
    ${pk}, name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT,
    status TEXT NOT NULL DEFAULT 'AVAILABLE', user_id INTEGER, notes TEXT,
    is_active INTEGER NOT NULL DEFAULT 1, created_by INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await ensureColumn(db, 'orders', 'delivery_executive_id', 'INTEGER').catch(() => {});
  await ensureColumn(db, 'orders', 'delivery_assigned_at', 'DATETIME').catch(() => {});
  // Selected by executiveDeliveries; present in Postgres from an earlier
  // migration but not in the SQLite seed.
  await ensureColumn(db, 'orders', 'delivery_address', 'TEXT').catch(() => {});
  READY = true;
}

/* ------------------------------------------------------------------- reads */

/**
 * Every executive with their delivery counts.
 *
 * The totals are subqueries against `orders` and `bills` rather than stored
 * counters: a counter drifts the moment an order is cancelled or a bill voided,
 * and there is no reason to keep one when the orders themselves are the truth.
 */
export async function listExecutives(db, { includeInactive = false, from = null, to = null } = {}) {
  await ensureDeliveryExecutiveSchema(db);

  const range = [];
  const rangeParams = [];
  if (from) { range.push('o.created_at >= ?'); rangeParams.push(from); }
  if (to) { range.push('o.created_at < ?'); rangeParams.push(to); }
  const rangeSql = range.length ? `AND ${range.join(' AND ')}` : '';

  const where = includeInactive ? '' : 'WHERE COALESCE(e.is_active, 1) = 1';
  return db.all(
    `SELECT e.*,
            (SELECT COUNT(*) FROM orders o
              WHERE o.delivery_executive_id = e.id AND ${OPEN_DELIVERY}) AS active_deliveries,
            (SELECT COUNT(*) FROM orders o
              WHERE o.delivery_executive_id = e.id AND ${DONE_DELIVERY} ${rangeSql}) AS completed_deliveries,
            (SELECT COALESCE(SUM(b.grand_total), 0) FROM orders o
               JOIN bills b ON b.order_id = o.id
              WHERE o.delivery_executive_id = e.id AND ${DONE_DELIVERY}
                AND LOWER(COALESCE(b.status, '')) IN ('paid', 'partially_paid') ${rangeSql}
            ) AS delivered_amount
       FROM delivery_executives e ${where}
      ORDER BY COALESCE(e.is_active, 1) DESC, e.name`,
    [...rangeParams, ...rangeParams, ...rangeParams]
  );
}

export async function getExecutive(db, id) {
  await ensureDeliveryExecutiveSchema(db);
  const row = await db.get(
    `SELECT e.*, u.full_name AS user_full_name
       FROM delivery_executives e
       LEFT JOIN users u ON u.id = e.user_id
      WHERE e.id = ?`,
    [Number(id)]
  );
  if (!row) fail('Delivery executive not found.', 404);
  return row;
}

/**
 * The orders one executive has carried.
 *
 * Returns the order plus its bill total, so the detail page can answer "what
 * has this person delivered?" without re-deriving money from order items.
 */
export async function executiveDeliveries(db, id, { from = null, to = null, status = null } = {}) {
  await ensureDeliveryExecutiveSchema(db);
  const where = ['o.delivery_executive_id = ?'];
  const params = [Number(id)];
  if (from) { where.push('o.created_at >= ?'); params.push(from); }
  if (to) { where.push('o.created_at < ?'); params.push(to); }
  if (status === 'active') where.push(OPEN_DELIVERY);
  if (status === 'completed') where.push(DONE_DELIVERY);
  if (status === 'cancelled') where.push(`LOWER(COALESCE(o.status, '')) = 'cancelled'`);

  return db.all(
    `SELECT o.id, o.order_number, o.status, o.created_at, o.delivery_assigned_at,
            o.customer_name, o.customer_phone, o.delivery_address,
            b.id AS bill_id, b.bill_number, b.grand_total, b.status AS bill_status
       FROM orders o
       LEFT JOIN bills b ON b.order_id = o.id
      WHERE ${where.join(' AND ')}
      ORDER BY o.created_at DESC`,
    params
  );
}

/** Headline figures for one executive's detail page. */
export async function executiveSummary(db, id, { from = null, to = null } = {}) {
  const rows = await executiveDeliveries(db, id, { from, to });
  const completed = rows.filter((r) => String(r.status || '').toLowerCase() === 'completed');
  const cancelled = rows.filter((r) => String(r.status || '').toLowerCase() === 'cancelled');
  const active = rows.filter(
    (r) => !['completed', 'cancelled'].includes(String(r.status || '').toLowerCase())
  );
  const delivered = completed.reduce((sum, r) => (
    ['paid', 'partially_paid'].includes(String(r.bill_status || '').toLowerCase())
      ? sum + Number(r.grand_total || 0)
      : sum
  ), 0);

  return {
    total_orders: rows.length,
    active_deliveries: active.length,
    completed_deliveries: completed.length,
    cancelled_deliveries: cancelled.length,
    delivered_amount: round2(delivered),
  };
}

/* ------------------------------------------------------------------ writes */

export async function createExecutive(db, data = {}, actor = {}) {
  await ensureDeliveryExecutiveSchema(db);
  const name = clean(data.name, 120);
  if (!name) fail('Name is required.');

  const phone = clean(data.phone, 40);
  if (!phone) fail('Phone is required.');
  if (!/^[0-9+\-\s()]{7,20}$/.test(phone)) fail('Enter a valid phone number.');

  const email = clean(data.email, 160);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Enter a valid email address.');

  const status = String(data.status || 'AVAILABLE').toUpperCase();
  if (!EXECUTIVE_STATUSES.includes(status)) {
    fail(`Status must be one of ${EXECUTIVE_STATUSES.join(', ')}.`);
  }
  await assertPhoneFree(db, phone);

  const userId = data.user_id ? Number(data.user_id) : null;
  if (userId) {
    const user = await db.get('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) fail('That staff member no longer exists.', 400);
    const taken = await db.get(
      'SELECT id FROM delivery_executives WHERE user_id = ? AND COALESCE(is_active, 1) = 1',
      [userId]
    );
    if (taken) fail('That staff member is already a delivery executive.', 409, { code: 'duplicate_user' });
  }

  const res = await db.run(
    `INSERT INTO delivery_executives (name, phone, email, status, user_id, notes, is_active, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    [name, phone, email, status, userId, clean(data.notes, 300), actor.id || null]
  );
  return getExecutive(db, res.lastInsertRowid);
}

export async function updateExecutive(db, id, data = {}) {
  const existing = await getExecutive(db, id);

  const name = data.name === undefined ? existing.name : clean(data.name, 120);
  if (!name) fail('Name is required.');

  const phone = data.phone === undefined ? existing.phone : clean(data.phone, 40);
  if (!phone) fail('Phone is required.');
  if (!/^[0-9+\-\s()]{7,20}$/.test(phone)) fail('Enter a valid phone number.');
  if (phone !== existing.phone) await assertPhoneFree(db, phone, existing.id);

  const email = data.email === undefined ? existing.email : clean(data.email, 160);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Enter a valid email address.');

  let status = existing.status;
  if (data.status !== undefined) {
    status = String(data.status).toUpperCase();
    if (!EXECUTIVE_STATUSES.includes(status)) {
      fail(`Status must be one of ${EXECUTIVE_STATUSES.join(', ')}.`);
    }
    // Going off duty with live deliveries would leave those orders owned by
    // someone the assignment picker will not offer. Reassign them first.
    if (status === 'OFF_DUTY') {
      const open = await countOpenDeliveries(db, existing.id);
      if (open > 0) {
        fail(
          `${existing.name} still has ${open} delivery${open === 1 ? '' : 'ies'} in progress. Reassign or complete them before going off duty.`,
          409,
          { code: 'has_active_deliveries', active: open }
        );
      }
    }
  }

  const isActive = data.is_active === undefined ? existing.is_active : (data.is_active ? 1 : 0);
  if (!isActive && existing.is_active) {
    const open = await countOpenDeliveries(db, existing.id);
    if (open > 0) {
      fail(
        `${existing.name} still has ${open} delivery${open === 1 ? '' : 'ies'} in progress and cannot be deactivated yet.`,
        409,
        { code: 'has_active_deliveries', active: open }
      );
    }
  }

  await db.run(
    `UPDATE delivery_executives
        SET name = ?, phone = ?, email = ?, status = ?, notes = ?, is_active = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [name, phone, email, status,
      data.notes === undefined ? existing.notes : clean(data.notes, 300),
      isActive, existing.id]
  );
  return getExecutive(db, existing.id);
}

async function assertPhoneFree(db, phone, exceptId = null) {
  const rows = await db.all(
    'SELECT id, name, phone FROM delivery_executives WHERE COALESCE(is_active, 1) = 1'
  );
  const clash = rows.find((r) => String(r.phone).trim() === phone && Number(r.id) !== Number(exceptId));
  if (clash) {
    fail(`${clash.name} already uses that phone number.`, 409, { code: 'duplicate_phone' });
  }
}

async function countOpenDeliveries(db, executiveId) {
  const row = await db.get(
    `SELECT COUNT(*) AS n FROM orders o WHERE o.delivery_executive_id = ? AND ${OPEN_DELIVERY}`,
    [Number(executiveId)]
  );
  return Number(row?.n || 0);
}

/* -------------------------------------------------------------- assignment */

/**
 * Assign (or clear) the executive on a delivery order.
 *
 * Runs in one transaction and re-reads the order inside it, so two admins
 * assigning the same order at once cannot both win: the second sees the first's
 * assignment and is told, rather than silently overwriting it. Pass
 * `reassign: true` to take it deliberately.
 */
export async function assignDelivery(db, orderId, executiveId, { actor = {}, reassign = false, allowOffDuty = false } = {}) {
  await ensureDeliveryExecutiveSchema(db);

  return db.transaction(async (tx) => {
    const lock = tx.driver === 'postgres' ? ' FOR UPDATE' : '';
    const order = await tx.get(`SELECT * FROM orders WHERE id = ?${lock}`, [Number(orderId)]);
    if (!order) fail('Order not found.', 404);
    if (String(order.order_type || '').toLowerCase() !== 'delivery') {
      fail('Only a delivery order can be given a delivery executive.', 409, { code: 'not_delivery' });
    }
    if (['completed', 'cancelled'].includes(String(order.status || '').toLowerCase())) {
      fail('This order is closed and can no longer be reassigned.', 409, { code: 'order_closed' });
    }

    // Unassign.
    if (!executiveId) {
      const previous = order.delivery_executive_id;
      await tx.run(
        `UPDATE orders SET delivery_executive_id = NULL, delivery_assigned_at = NULL,
                           updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [order.id]
      );
      if (previous) await refreshStatusFromAssignments(tx, previous);
      return { order_id: order.id, delivery_executive_id: null };
    }

    const executive = await tx.get(
      'SELECT * FROM delivery_executives WHERE id = ?', [Number(executiveId)]
    );
    if (!executive) fail('Delivery executive not found.', 404);
    if (!executive.is_active) fail(`${executive.name} is deactivated.`, 409, { code: 'inactive' });
    if (executive.status === 'OFF_DUTY' && !allowOffDuty) {
      fail(
        `${executive.name} is off duty. Choose an available executive, or confirm the override.`,
        409,
        { code: 'off_duty' }
      );
    }
    if (order.delivery_executive_id && Number(order.delivery_executive_id) !== Number(executiveId) && !reassign) {
      fail(
        'This order is already assigned to another executive. Confirm the reassignment to take it over.',
        409,
        { code: 'already_assigned', current: order.delivery_executive_id }
      );
    }

    const previous = order.delivery_executive_id;
    await tx.run(
      `UPDATE orders SET delivery_executive_id = ?, delivery_assigned_at = CURRENT_TIMESTAMP,
                         updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [executive.id, order.id]
    );

    // Both sides are recomputed: the new owner may become BUSY, and the former
    // owner may now be free.
    await refreshStatusFromAssignments(tx, executive.id);
    if (previous && Number(previous) !== Number(executive.id)) {
      await refreshStatusFromAssignments(tx, previous);
    }
    void actor;
    return { order_id: order.id, delivery_executive_id: executive.id };
  });
}

/**
 * Recompute one executive's availability from the deliveries they actually
 * still hold.
 *
 * Never flips OFF_DUTY — that is a human decision about whether someone is
 * working today, not something a completed order should undo.
 */
export async function refreshStatusFromAssignments(db, executiveId) {
  const executive = await db.get(
    'SELECT id, status FROM delivery_executives WHERE id = ?', [Number(executiveId)]
  );
  if (!executive || executive.status === 'OFF_DUTY') return executive || null;

  const open = await countOpenDeliveries(db, executiveId);
  const next = open > 0 ? 'BUSY' : 'AVAILABLE';
  if (next !== executive.status) {
    await db.run(
      'UPDATE delivery_executives SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [next, executive.id]
    );
  }
  return { ...executive, status: next };
}

/**
 * Live event operations.
 *
 * One read that answers what a manager standing at a running event needs:
 * what is the kitchen still working on, what has been added since it started,
 * what does the bill stand at, and what is still owed.
 *
 * The actions available during an event are the ones that already exist —
 * additional orders (production.js), extra quotation lines (lines.js), guest
 * count changes (guests.js), deposits (deposits.js). This module adds no new
 * way to move stock or money; it only assembles the picture.
 *
 * Event orders are deliberately kept off the restaurant floor: they carry the
 * event number as their party label and are excluded from table occupancy by
 * having no table unless one is explicitly given.
 */
import { ensureEventsSchema } from './schema.js';
import { toId } from './ids.js';
import { listLines } from './lines.js';
import { eventOrders } from './production.js';
import { depositBalance } from './deposits.js';
import { getBillablePolicy, explainBillable } from './guests.js';
import { EVENT_STATUS } from './constants.js';

const fail = (message, status = 400, extra = {}) => {
  throw Object.assign(new Error(message), { status, ...extra });
};
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Everything the live screen shows.
 *
 * The "current estimated bill" is the quotation total plus whatever additional
 * orders have been rung up since production started. It is explicitly an
 * estimate: the binding number is produced at final billing (Phase 14), and
 * calling it an estimate here stops anyone treating this screen as an invoice.
 */
export async function liveSnapshot(db, eventId) {
  await ensureEventsSchema(db);
  const event = await db.get(
    `SELECT e.*, s.name AS space_name, c.name AS customer_name
       FROM events e
       LEFT JOIN event_spaces s ON s.id = e.space_id
       LEFT JOIN customers c ON c.id = e.customer_id
      WHERE e.id = ?`,
    [toId(eventId, 'event')]
  );
  if (!event) fail('Event not found.', 404);

  const [lines, orders, held, policy] = await Promise.all([
    listLines(db, event.id),
    eventOrders(db, event.id),
    depositBalance(db, event.id),
    getBillablePolicy(db),
  ]);

  const orderIds = orders.map((o) => o.id);
  // The fulfilment order delivers food the quotation already charges for, so
  // only genuinely additional orders add to the bill.
  const additionalOrderIds = orders.filter((o) => !Number(o.event_production)).map((o) => o.id);
  let kots = [];
  let orderItems = [];
  if (orderIds.length) {
    const placeholders = orderIds.map(() => '?').join(',');
    kots = await db.all(
      `SELECT k.id, k.kot_number, k.status, k.order_id, k.printed_at, k.completed_at,
              o.order_number
         FROM kots k
         JOIN orders o ON o.id = k.order_id
        WHERE k.order_id IN (${placeholders})
          AND COALESCE(k.voided, 0) = 0
        ORDER BY k.id DESC`,
      orderIds
    );
    orderItems = await db.all(
      `SELECT oi.id, oi.order_id, oi.item_name, oi.quantity, oi.price, oi.subtotal, oi.status,
              o.order_number, mi.base_price AS menu_price
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         LEFT JOIN menu_items mi ON mi.id = COALESCE(oi.menu_item_id, oi.item_id)
        WHERE oi.order_id IN (${placeholders})
          AND COALESCE(oi.status, '') NOT IN ('voided', 'cancelled')
        ORDER BY oi.order_id, oi.id`,
      orderIds
    );
  }

  // Additional sales are what the kitchen rang up beyond the contracted
  // quotation — drinks, extra plates, late-night snacks.
  const additionalSet = new Set(additionalOrderIds);
  const additionalSales = round2(
    orderItems.filter((i) => additionalSet.has(i.order_id))
      .reduce((s, i) => s + Number(i.subtotal || 0), 0)
  );
  const contracted = round2(event.total_amount);
  const estimatedBill = round2(contracted + additionalSales);
  const remaining = round2(estimatedBill - held);

  const activeKots = kots.filter((k) => !['completed', 'served', 'cancelled'].includes(String(k.status || '')));

  return {
    event: {
      id: event.id,
      event_number: event.event_number,
      title: event.title,
      status: event.status,
      is_live: event.status === EVENT_STATUS.IN_PROGRESS,
      space: event.space_name,
      customer: event.customer_name || event.contact_name,
      started_at: event.started_at,
      payment_status: event.payment_status,
    },
    guests: explainBillable(event, policy),
    orders,
    kots,
    active_kots: activeKots.length,
    // Each line shows the ordinary restaurant price beside what the event pays,
    // so a manager can see the negotiated difference at a glance.
    items: orderItems.map((i) => ({
      id: i.id,
      order_number: i.order_number,
      name: i.item_name,
      quantity: Number(i.quantity),
      charged_price: round2(i.price),
      restaurant_price: i.menu_price == null ? null : round2(i.menu_price),
      difference: i.menu_price == null ? null : round2(Number(i.price) - Number(i.menu_price)),
      subtotal: round2(i.subtotal),
    })),
    quotation: {
      lines: lines.length,
      contracted_total: contracted,
    },
    money: {
      contracted_total: contracted,
      additional_sales: additionalSales,
      estimated_bill: estimatedBill,
      paid: held,
      remaining,
      // Naming it an estimate is deliberate — the binding figure comes from
      // final billing, not from this screen.
      is_estimate: true,
    },
  };
}

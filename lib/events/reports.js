/**
 * Events reporting.
 *
 * The existing restaurant reports stay the source of truth. This module adds
 * event attribution beside them; it never recomputes restaurant sales, and it
 * never produces a second, competing sales total.
 *
 * Two figures that must not be confused, and are kept apart deliberately:
 *
 *   recognised sales   revenue actually earned, read from the settlement
 *                      journal (source_type 'event_sale'). This is the only
 *                      number that belongs beside restaurant sales.
 *
 *   committed value    quotations for events that have not happened yet. Real
 *                      money is expected, but nothing has been earned. It is
 *                      reported separately and never added to sales.
 *
 * Deposits held are a liability, not either of the above.
 */
import { ensureEventsSchema } from './schema.js';
import { nepalDateString } from '../report-dates.js';
import { COMMITTED_STATUSES, EVENT_STATUS } from './constants.js';
import { toDateString } from './conflicts.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const committedList = COMMITTED_STATUSES.map((s) => `'${s}'`).join(',');

/**
 * Sales split by channel for a date range.
 *
 * Restaurant sales come from bills exactly as they always have. Event sales
 * come from the settlement journal. They are reported side by side and summed
 * once, so the consolidated total cannot double count.
 */
export async function salesByChannel(db, { from, to } = {}) {
  await ensureEventsSchema(db);
  const start = from || nepalDateString();
  const end = to || nepalDateString();

  // Restaurant: paid bills whose order is not part of an event.
  const restaurant = await db.get(
    `SELECT COALESCE(SUM(b.grand_total), 0) AS total, COUNT(*) AS bills
       FROM bills b
       JOIN orders o ON o.id = b.order_id
      WHERE b.status = 'paid'
        AND o.event_id IS NULL
        AND DATE(COALESCE(b.paid_at, b.created_at)) BETWEEN ? AND ?`,
    [start, end]
  );

  // Events: what the settlement journal actually recognised as revenue.
  const events = await db.get(
    `SELECT COALESCE(SUM(jl.credit), 0) AS total, COUNT(DISTINCT je.source_id) AS events
       FROM journal_entries je
       JOIN journal_lines jl ON jl.journal_id = je.id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.source_type = 'event_sale'
        AND a.code = '4010'
        AND je.entry_date BETWEEN ? AND ?`,
    [start, end]
  );

  const restaurantTotal = round2(restaurant?.total);
  const eventTotal = round2(events?.total);

  return {
    from: start,
    to: end,
    restaurant_sales: restaurantTotal,
    restaurant_bills: Number(restaurant?.bills || 0),
    event_sales: eventTotal,
    events_settled: Number(events?.events || 0),
    total_sales: round2(restaurantTotal + eventTotal),
    note: 'Restaurant sales are bill totals; event sales are revenue recognised at settlement. Event deposits and unsettled quotations are excluded from both.',
  };
}

/** The events report: counts, revenue, guests, mix, outstanding and profit. */
export async function eventsReport(db, { from, to } = {}) {
  await ensureEventsSchema(db);
  const start = from || `${nepalDateString().slice(0, 7)}-01`;
  const end = to || nepalDateString();

  const [counts, completed, cancelled, guests, mix, types, deposits, committed, upcoming] = await Promise.all([
    db.get(
      `SELECT COUNT(*) AS n FROM events WHERE event_date BETWEEN ? AND ?`, [start, end]
    ),
    db.get(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(total_amount), 0) AS revenue,
              COALESCE(SUM(COALESCE(actual_guests, guaranteed_guests, expected_guests, 0)), 0) AS guests
         FROM events
        WHERE status = '${EVENT_STATUS.COMPLETED}' AND event_date BETWEEN ? AND ?`,
      [start, end]
    ),
    db.get(
      `SELECT COUNT(*) AS n FROM events
        WHERE status = '${EVENT_STATUS.CANCELLED}' AND event_date BETWEEN ? AND ?`,
      [start, end]
    ),
    db.get(
      `SELECT COALESCE(SUM(COALESCE(actual_guests, guaranteed_guests, expected_guests, 0)), 0) AS n
         FROM events
        WHERE status IN (${committedList}) AND event_date BETWEEN ? AND ?`,
      [start, end]
    ),
    db.all(
      `SELECT p.name AS package_name,
              COUNT(*) AS times_sold,
              COALESCE(SUM(l.quantity), 0) AS guests,
              COALESCE(SUM(l.line_total), 0) AS revenue
         FROM event_menu_lines l
         JOIN events e ON e.id = l.event_id
         LEFT JOIN event_packages p ON p.id = l.package_id
        WHERE l.line_type = 'package'
          AND e.status IN (${committedList})
          AND e.event_date BETWEEN ? AND ?
        GROUP BY p.name
        ORDER BY revenue DESC`,
      [start, end]
    ),
    db.all(
      `SELECT event_type, COUNT(*) AS n, COALESCE(SUM(total_amount), 0) AS value
         FROM events
        WHERE status != '${EVENT_STATUS.CANCELLED}' AND event_date BETWEEN ? AND ?
        GROUP BY event_type ORDER BY n DESC`,
      [start, end]
    ),
    db.get(
      `SELECT COALESCE(SUM(CASE WHEN entry_type = 'refund' THEN -amount ELSE amount END), 0) AS held
         FROM event_deposits d
         JOIN events e ON e.id = d.event_id
        WHERE d.status = 'active' AND e.status != '${EVENT_STATUS.COMPLETED}'`
    ),
    db.get(
      `SELECT COALESCE(SUM(outstanding_amount), 0) AS n FROM events
        WHERE status IN (${committedList}) AND event_date BETWEEN ? AND ?`,
      [start, end]
    ),
    // Money contracted for events that have not happened — expected, not earned.
    db.get(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total_amount), 0) AS value
         FROM events
        WHERE status IN (${committedList}) AND status != '${EVENT_STATUS.COMPLETED}'
          AND event_date >= ?`,
      [nepalDateString()]
    ),
  ]);

  const completedCount = Number(completed?.n || 0);
  const completedRevenue = round2(completed?.revenue);
  const completedGuests = Number(completed?.guests || 0);

  return {
    from: start,
    to: end,
    events: Number(counts?.n || 0),
    completed_events: completedCount,
    cancelled_events: Number(cancelled?.n || 0),
    completed_revenue: completedRevenue,
    revenue_per_event: completedCount ? round2(completedRevenue / completedCount) : 0,
    average_spend_per_guest: completedGuests ? round2(completedRevenue / completedGuests) : 0,
    guests_committed: Number(guests?.n || 0),
    completed_guests: completedGuests,
    package_mix: mix.map((m) => ({
      package: m.package_name || 'Unnamed package',
      times_sold: Number(m.times_sold),
      guests: Number(m.guests),
      revenue: round2(m.revenue),
    })),
    event_types: types.map((t) => ({ type: t.event_type, count: Number(t.n), value: round2(t.value) })),
    deposits_held: round2(deposits?.held),
    outstanding_balance: round2(committed?.n),
    upcoming_committed: {
      events: Number(upcoming?.n || 0),
      value: round2(upcoming?.value),
      note: 'Contracted but not yet earned — deliberately excluded from sales.',
    },
  };
}

/**
 * Profitability across events, ranked. Actual food cost comes from the stock
 * ledger; expenses from expenses.event_id.
 */
export async function profitabilityReport(db, { from, to, limit = 50 } = {}) {
  await ensureEventsSchema(db);
  const start = from || `${nepalDateString().slice(0, 7)}-01`;
  const end = to || nepalDateString();
  const capped = Math.min(200, Math.max(1, Number(limit) || 50));

  const rows = await db.all(
    `SELECT e.id, e.event_number, e.title, e.event_type, e.event_date, e.status,
            COALESCE(e.actual_guests, e.guaranteed_guests, e.expected_guests, 0) AS guests,
            COALESCE((
              SELECT SUM(jl.credit) FROM journal_entries je
              JOIN journal_lines jl ON jl.journal_id = je.id
              JOIN accounts a ON a.id = jl.account_id
              WHERE je.source_type = 'event_sale' AND je.source_id = e.id AND a.code = '4010'
            ), 0) AS recognised_revenue,
            COALESCE((
              -- stock_movements.reference_id is TEXT and holds ids from
              -- several sources, so the order id is cast rather than the
              -- column: casting the column would fail on non-numeric rows.
              SELECT SUM(-sm.quantity_changed * i.cost_per_unit)
              FROM stock_movements sm
              JOIN inventory_items i ON i.id = sm.inventory_item_id
              JOIN orders o ON CAST(o.id AS TEXT) = sm.reference_id
              WHERE o.event_id = e.id AND sm.change_type = 'order_deduction'
            ), 0) AS food_cost,
            COALESCE((
              SELECT SUM(x.amount) FROM expenses x WHERE x.event_id = e.id
            ), 0) AS event_expenses
       FROM events e
      WHERE e.event_date BETWEEN ? AND ?
        AND e.status = '${EVENT_STATUS.COMPLETED}'
      ORDER BY e.event_date DESC
      LIMIT ${capped}`,
    [start, end]
  );

  const events = rows.map((r) => {
    const revenue = round2(r.recognised_revenue);
    const foodCost = round2(r.food_cost);
    const expenses = round2(r.event_expenses);
    const contribution = round2(revenue - foodCost - expenses);
    return {
      event_id: r.id,
      event_number: r.event_number,
      title: r.title,
      event_type: r.event_type,
      // Postgres hands back a DATE as a JS Date, which serialises through UTC
      // and lands a Nepal (+05:45) booking on the previous day.
      event_date: toDateString(r.event_date),
      guests: Number(r.guests),
      revenue,
      food_cost: foodCost,
      event_expenses: expenses,
      contribution,
      food_cost_percent: revenue > 0 ? round2((foodCost / revenue) * 100) : null,
      contribution_percent: revenue > 0 ? round2((contribution / revenue) * 100) : null,
      contribution_per_guest: Number(r.guests) ? round2(contribution / Number(r.guests)) : null,
    };
  });

  const ranked = [...events].sort((a, b) => b.contribution - a.contribution);
  const totals = events.reduce((acc, e) => ({
    revenue: round2(acc.revenue + e.revenue),
    food_cost: round2(acc.food_cost + e.food_cost),
    event_expenses: round2(acc.event_expenses + e.event_expenses),
    contribution: round2(acc.contribution + e.contribution),
  }), { revenue: 0, food_cost: 0, event_expenses: 0, contribution: 0 });

  return {
    from: start,
    to: end,
    events,
    most_profitable: ranked.slice(0, 5),
    least_profitable: ranked.slice(-5).reverse(),
    totals: {
      ...totals,
      food_cost_percent: totals.revenue > 0 ? round2((totals.food_cost / totals.revenue) * 100) : null,
      contribution_percent: totals.revenue > 0 ? round2((totals.contribution / totals.revenue) * 100) : null,
    },
  };
}

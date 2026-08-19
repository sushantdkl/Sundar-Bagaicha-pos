/**
 * Event profitability.
 *
 * Two different questions, deliberately answered by different data:
 *
 *   BEFORE the event   estimated contribution from the quotation and the recipe
 *                      BOM — what we think we will make
 *
 *   AFTER the event    actual contribution from what the stock ledger says was
 *                      really consumed, plus expenses actually booked
 *
 * The second must never fall back to the first. A quote's estimated food cost
 * is a plan; once production has run, `stock_movements` knows what the kitchen
 * actually used, including the over-portioning and waste that make the
 * difference between a profitable event and a busy one.
 *
 * Cost sources, and what is deliberately excluded:
 *
 *   included   raw materials consumed by this event's orders, valued at the
 *              inventory cost of the moment
 *   included   expenses booked against the event (decoration, DJ, hired staff)
 *   EXCLUDED   purchase invoices linked to the event — unused stock stays with
 *              the restaurant, so charging the invoice overstates event cost
 */
import { ensureEventsSchema } from './schema.js';
import { listLines } from './lines.js';
import { packageFoodCost } from './components.js';
import { eventForecast } from './forecast.js';
import { eventOrders } from './production.js';
import { eventExpenses } from './expenses.js';
import { FOOD_LINE_TYPES } from './constants.js';

const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Configurable warning thresholds, held in settings rather than in code. */
export const THRESHOLD_KEYS = {
  FOOD_COST_PERCENT: 'events_target_food_cost_percent',
  CONTRIBUTION_PERCENT: 'events_min_contribution_percent',
};
const DEFAULTS = { food_cost_percent: 45, contribution_percent: 30 };

export async function getThresholds(db) {
  try {
    const rows = await db.all(
      `SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (?, ?)`,
      [THRESHOLD_KEYS.FOOD_COST_PERCENT, THRESHOLD_KEYS.CONTRIBUTION_PERCENT]
    );
    const map = Object.fromEntries((rows || []).map((r) => [r.setting_key, Number(r.setting_value)]));
    return {
      food_cost_percent: Number.isFinite(map[THRESHOLD_KEYS.FOOD_COST_PERCENT])
        ? map[THRESHOLD_KEYS.FOOD_COST_PERCENT] : DEFAULTS.food_cost_percent,
      contribution_percent: Number.isFinite(map[THRESHOLD_KEYS.CONTRIBUTION_PERCENT])
        ? map[THRESHOLD_KEYS.CONTRIBUTION_PERCENT] : DEFAULTS.contribution_percent,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function setThresholds(db, { food_cost_percent, contribution_percent } = {}) {
  const write = async (key, value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100) fail(`${key} must be a percentage between 0 and 100.`);
    const existing = await db.get('SELECT id FROM system_settings WHERE setting_key = ?', [key]);
    if (existing) {
      await db.run('UPDATE system_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?', [String(n), key]);
    } else {
      await db.run('INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)', [key, String(n)]);
    }
  };
  if (food_cost_percent !== undefined) await write(THRESHOLD_KEYS.FOOD_COST_PERCENT, food_cost_percent);
  if (contribution_percent !== undefined) await write(THRESHOLD_KEYS.CONTRIBUTION_PERCENT, contribution_percent);
  return getThresholds(db);
}

/**
 * Pre-event estimate, for the quotation screen.
 * Costs come from the recipe BOM at current prices — nothing has been consumed.
 */
export async function estimatedProfitability(db, eventId) {
  await ensureEventsSchema(db);
  const event = await db.get('SELECT * FROM events WHERE id = ?', [Number(eventId)]);
  if (!event) fail('Event not found.', 404);

  const [lines, thresholds] = await Promise.all([listLines(db, event.id), getThresholds(db)]);
  const forecast = await eventForecast(db, event.id);

  // Package lines cost through their components; other food lines through the
  // forecast, which already resolved their recipes.
  let foodCost = 0;
  const uncosted = [];
  for (const line of lines) {
    if (!FOOD_LINE_TYPES.includes(line.line_type) || !line.consumes_inventory) continue;
    if (line.line_type === 'package' && line.package_id) {
      const cost = await packageFoodCost(db, line.package_id, { guests: Number(line.quantity || 0) });
      foodCost += Number(cost.food_cost_total || 0);
      uncosted.push(...cost.uncosted.map((u) => ({ ...u, line: line.item_name })));
    }
  }
  // Non-package food lines are already priced into the forecast's cost figure.
  const forecastCost = Number(forecast.summary.estimated_food_cost || 0);
  const estimatedFoodCost = round2(Math.max(foodCost, forecastCost));

  const revenue = round2(event.total_amount);
  const guests = forecast.guests || Number(event.guaranteed_guests || event.expected_guests || 0);
  const contribution = round2(revenue - estimatedFoodCost);
  const foodCostPercent = revenue > 0 ? round2((estimatedFoodCost / revenue) * 100) : null;
  const contributionPercent = revenue > 0 ? round2((contribution / revenue) * 100) : null;

  const warnings = [];
  if (foodCostPercent != null && foodCostPercent > thresholds.food_cost_percent) {
    warnings.push({
      type: 'food_cost',
      message: `Estimated food cost is ${foodCostPercent}%; the target maximum is ${thresholds.food_cost_percent}%.`,
    });
  }
  if (contributionPercent != null && contributionPercent < thresholds.contribution_percent) {
    warnings.push({
      type: 'contribution',
      message: `Estimated contribution is ${contributionPercent}%; the target minimum is ${thresholds.contribution_percent}%.`,
    });
  }
  if (!forecast.complete || uncosted.length) {
    warnings.push({
      type: 'incomplete',
      message: 'Some food has no recipe, so the real cost is higher than this estimate.',
    });
  }

  return {
    basis: 'estimate',
    event_id: event.id,
    event_number: event.event_number,
    guests,
    revenue,
    food_cost: estimatedFoodCost,
    contribution,
    food_cost_percent: foodCostPercent,
    contribution_percent: contributionPercent,
    selling_price_per_guest: guests ? round2(revenue / guests) : null,
    food_cost_per_guest: guests ? round2(estimatedFoodCost / guests) : null,
    thresholds,
    warnings,
    // Thresholds inform; they never block. A manager may knowingly run a loss
    // leader, and the system's job is to make sure they know.
    blocking: false,
    complete: forecast.complete && uncosted.length === 0,
  };
}

/**
 * Post-event actual, from what really happened.
 *
 * Food cost is read from stock_movements for this event's orders, not from the
 * quote. Expenses are the ones booked against the event.
 */
export async function actualProfitability(db, eventId) {
  await ensureEventsSchema(db);
  const event = await db.get('SELECT * FROM events WHERE id = ?', [Number(eventId)]);
  if (!event) fail('Event not found.', 404);

  const [orders, expenses, thresholds] = await Promise.all([
    eventOrders(db, event.id),
    eventExpenses(db, event.id),
    getThresholds(db),
  ]);

  // Consumption recorded against this event's orders, valued at the inventory
  // cost held for each item.
  let consumption = [];
  if (orders.length) {
    const ids = orders.map((o) => o.id);
    consumption = await db.all(
      `SELECT sm.inventory_item_id, i.item_name, i.consumption_unit, i.unit,
              SUM(-sm.quantity_changed) AS quantity,
              i.cost_per_unit
         FROM stock_movements sm
         JOIN inventory_items i ON i.id = sm.inventory_item_id
        WHERE sm.reference_id IN (${ids.map(() => '?').join(',')})
          AND sm.change_type = 'order_deduction'
        GROUP BY sm.inventory_item_id, i.item_name, i.consumption_unit, i.unit, i.cost_per_unit`,
      ids
    );
  }

  const consumptionRows = consumption.map((c) => ({
    inventory_item_id: c.inventory_item_id,
    item_name: c.item_name,
    unit: c.consumption_unit || c.unit || '',
    quantity: round2(c.quantity),
    cost_per_unit: round2(c.cost_per_unit),
    cost: round2(Number(c.quantity || 0) * Number(c.cost_per_unit || 0)),
  }));
  const actualFoodCost = round2(consumptionRows.reduce((s, r) => s + r.cost, 0));
  const eventExpenseTotal = round2(expenses.total);

  // Revenue is the contracted total plus anything additional that was sold.
  const additional = orders.filter((o) => !Number(o.event_production));
  const additionalSales = round2(additional.reduce((s, o) => s + Number(o.total_amount || 0), 0));
  const revenue = round2(Number(event.total_amount || 0) + additionalSales);

  const totalCost = round2(actualFoodCost + eventExpenseTotal);
  const contribution = round2(revenue - totalCost);
  const guests = Number(event.actual_guests || event.guaranteed_guests || event.expected_guests || 0);

  const estimate = await estimatedProfitability(db, event.id).catch(() => null);

  return {
    basis: 'actual',
    event_id: event.id,
    event_number: event.event_number,
    status: event.status,
    guests,
    revenue,
    contracted_revenue: round2(event.total_amount),
    additional_sales: additionalSales,
    food_cost: actualFoodCost,
    event_expenses: eventExpenseTotal,
    total_cost: totalCost,
    contribution,
    food_cost_percent: revenue > 0 ? round2((actualFoodCost / revenue) * 100) : null,
    contribution_percent: revenue > 0 ? round2((contribution / revenue) * 100) : null,
    contribution_per_guest: guests ? round2(contribution / guests) : null,
    consumption: consumptionRows,
    expenses_by_category: expenses.by_category,
    thresholds,
    // The estimate is shown beside the actual so the gap is visible, but the
    // actual never falls back to it.
    estimate: estimate ? {
      food_cost: estimate.food_cost,
      contribution: estimate.contribution,
      variance: round2(contribution - estimate.contribution),
    } : null,
    has_consumption: consumptionRows.length > 0,
    note: consumptionRows.length
      ? null
      : 'No consumption is recorded against this event yet — food cost will read zero until production has run.',
  };
}

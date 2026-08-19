/**
 * Event inventory forecast.
 *
 * Answers "what do we need to buy for this event" WITHOUT reserving or
 * deducting anything. Every function here is read-only:
 *
 *   explodeRecipe()      walks the BOM and returns a quantity map — no writes
 *   deductRawMaterials() is the only thing that moves stock, and is NOT called
 *                        from this file or anywhere else in the events module
 *
 * Stock moves once, later, when an event is started (Phase 11) and production
 * flows through the ordinary POS order path. Forecasting a 300-guest wedding
 * must leave every inventory quantity byte-identical, and the QA proves it.
 *
 * Requirements come from the same place the kitchen's costs do: package
 * components and quotation lines resolved to recipes, exploded through
 * sub-recipes, expressed in consumption units.
 */
import { explodeRecipe, getRecipeByMenuItemId } from '../recipes.js';
import { toId } from './ids.js';
import { ensureEventsSchema } from './schema.js';
import { listComponents } from './components.js';
import { listLines } from './lines.js';
import { getBillablePolicy, billableGuests } from './guests.js';
import { FOOD_LINE_TYPES } from './constants.js';

const fail = (message, status = 400, extra = {}) => {
  throw Object.assign(new Error(message), { status, ...extra });
};
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Merge a recipe explosion into the running requirement map. */
function accumulate(target, deltaMap, sourceLabel) {
  for (const [rawId, qty] of deltaMap) {
    const key = Number(rawId);
    const entry = target.get(key) || { required: 0, sources: [] };
    entry.required += Number(qty);
    entry.sources.push({ from: sourceLabel, quantity: round4(qty) });
    target.set(key, entry);
  }
}

/**
 * Ingredient requirement for an event.
 *
 * Package lines contribute (components × quantity_per_guest × guests taking it).
 * Menu-item and custom-food lines contribute (their recipe × line quantity).
 * Anything marked not stock-backed contributes nothing, deliberately.
 *
 * @returns rows of { item, required, available, shortage, unit }
 */
export async function eventForecast(db, eventId, { guestsOverride = null } = {}) {
  await ensureEventsSchema(db);
  const event = await db.get('SELECT * FROM events WHERE id = ?', [toId(eventId, 'event')]);
  if (!event) fail('Event not found.', 404);

  const [lines, policy] = await Promise.all([listLines(db, event.id), getBillablePolicy(db)]);
  const headcount = guestsOverride != null
    ? Number(guestsOverride)
    : billableGuests(event, policy);

  const required = new Map();
  const unresolved = [];

  for (const line of lines) {
    if (!FOOD_LINE_TYPES.includes(line.line_type)) continue;
    if (!line.consumes_inventory) continue;

    const quantity = Number(line.quantity || 0);
    if (quantity <= 0) continue;

    if (line.line_type === 'package' && line.package_id) {
      const components = await listComponents(db, line.package_id);
      if (!components.length) {
        unresolved.push({
          line_id: line.id, name: line.item_name,
          reason: 'This package has no menu components, so its ingredients are unknown.',
        });
        continue;
      }
      for (const component of components) {
        if (!component.consumes_inventory) continue;
        const recipe = component.recipe_id
          ? await db.get('SELECT * FROM recipes WHERE id = ?', [component.recipe_id])
          : await getRecipeByMenuItemId(db, component.menu_item_id);
        if (!recipe) {
          unresolved.push({
            line_id: line.id, name: `${line.item_name} → ${component.component_name}`,
            reason: 'No recipe is linked, so its ingredients are unknown.',
          });
          continue;
        }
        // guests on the line × portions per guest = recipe yields needed
        const multiplier = quantity * Number(component.quantity_per_guest || 0);
        if (multiplier <= 0) continue;
        const map = await explodeRecipe(db, recipe.id, multiplier);
        accumulate(required, map, `${line.item_name} · ${component.component_name}`);
      }
      continue;
    }

    const recipe = line.recipe_id
      ? await db.get('SELECT * FROM recipes WHERE id = ?', [line.recipe_id])
      : await getRecipeByMenuItemId(db, line.menu_item_id);
    if (!recipe) {
      unresolved.push({
        line_id: line.id, name: line.item_name,
        reason: line.menu_item_id
          ? 'The linked menu item has no recipe.'
          : 'No recipe is linked to this line.',
      });
      continue;
    }
    const map = await explodeRecipe(db, recipe.id, quantity);
    accumulate(required, map, line.item_name);
  }

  const rows = [];
  for (const [rawId, entry] of required) {
    const item = await db.get('SELECT * FROM inventory_items WHERE id = ?', [rawId]);
    if (!item) continue;
    const need = round4(entry.required);
    const available = round4(item.quantity);
    const shortage = round4(Math.max(0, need - available));
    rows.push({
      inventory_item_id: rawId,
      item_name: item.item_name || item.name,
      unit: item.consumption_unit || item.unit || '',
      required: need,
      available,
      shortage,
      sufficient: shortage <= 0,
      cost_per_unit: round2(item.cost_per_unit),
      // What it would cost to buy the gap, at the last known cost.
      purchase_cost: round2(shortage * Number(item.cost_per_unit || 0)),
      sources: entry.sources,
    });
  }
  rows.sort((a, b) => b.shortage - a.shortage || a.item_name.localeCompare(b.item_name));

  const shortages = rows.filter((r) => !r.sufficient);
  return {
    event_id: event.id,
    event_number: event.event_number,
    event_date: event.event_date,
    guests: headcount,
    rows,
    unresolved,
    complete: unresolved.length === 0,
    summary: {
      ingredients: rows.length,
      short: shortages.length,
      estimated_food_cost: round2(rows.reduce((s, r) => s + r.required * Number(r.cost_per_unit || 0), 0)),
      estimated_purchase_cost: round2(shortages.reduce((s, r) => s + r.purchase_cost, 0)),
    },
  };
}

/**
 * Combined requirement across several upcoming events, so a purchaser can buy
 * once for the week rather than per booking.
 */
export async function forecastRange(db, { from, to, statuses = null } = {}) {
  await ensureEventsSchema(db);
  if (!from || !to) fail('A forecast range needs a from and to date.');
  const list = statuses && statuses.length
    ? statuses
    : ['CONFIRMED', 'PLANNING', 'FINALIZED', 'IN_PROGRESS'];

  const events = await db.all(
    `SELECT id, event_number, event_date FROM events
      WHERE event_date >= ? AND event_date <= ?
        AND status IN (${list.map(() => '?').join(',')})
      ORDER BY event_date, id`,
    [from, to, ...list]
  );

  const merged = new Map();
  const perEvent = [];
  for (const e of events) {
    const forecast = await eventForecast(db, e.id);
    perEvent.push({
      event_id: e.id, event_number: forecast.event_number,
      event_date: forecast.event_date, guests: forecast.guests,
      short: forecast.summary.short, complete: forecast.complete,
    });
    for (const row of forecast.rows) {
      const entry = merged.get(row.inventory_item_id) || {
        inventory_item_id: row.inventory_item_id, item_name: row.item_name,
        unit: row.unit, required: 0, available: row.available,
        cost_per_unit: row.cost_per_unit, events: [],
      };
      entry.required = round4(entry.required + row.required);
      entry.events.push({ event_number: forecast.event_number, required: row.required });
      merged.set(row.inventory_item_id, entry);
    }
  }

  const rows = [...merged.values()].map((r) => {
    const shortage = round4(Math.max(0, r.required - r.available));
    return {
      ...r,
      shortage,
      sufficient: shortage <= 0,
      purchase_cost: round2(shortage * Number(r.cost_per_unit || 0)),
    };
  }).sort((a, b) => b.shortage - a.shortage || a.item_name.localeCompare(b.item_name));

  return {
    from, to, statuses: list,
    events: perEvent,
    rows,
    summary: {
      events: perEvent.length,
      ingredients: rows.length,
      short: rows.filter((r) => !r.sufficient).length,
      estimated_purchase_cost: round2(rows.reduce((s, r) => s + r.purchase_cost, 0)),
    },
  };
}

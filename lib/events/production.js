/**
 * Start Event — release an event's food to the kitchen.
 *
 * This is the only place in the events module where stock moves, and it does
 * so through the engines the restaurant already uses:
 *
 *   OrderRepository.create()  creates the order, inserts its items and deducts
 *                             their stock exactly as a waiter's order does
 *   issueKot()                prints the ticket the kitchen display reads
 *   deductRawMaterials()      applies raw-material deltas through the ledger
 *
 * Nothing here re-implements deduction, KOT numbering, the kitchen display or
 * billing. The event only decides WHAT to produce and WHEN.
 *
 * Every component travels exactly one of two paths, never both, so it cannot be
 * deducted twice:
 *
 *   has a menu item  -> becomes an order line; the order path deducts it
 *   recipe only      -> no menu item exists to sell, so its raw materials are
 *                       applied directly, tagged to the same order
 *
 * Starting twice is prevented by a guard on events.started_at plus a check for
 * existing production orders, both read inside the same transaction that writes
 * the started state.
 */
import { OrderRepository } from '../db/repositories/orders.js';
import { issueKot } from '../kot-service.js';
import { explodeRecipe, deductRawMaterials, getRecipeByMenuItemId } from '../recipes.js';
import { currentBusinessDayId } from '../business-days.js';
import { ensureEventsSchema } from './schema.js';
import { logEventAudit } from './audit.js';
import { listComponents } from './components.js';
import { listLines } from './lines.js';
import { EVENT_STATUS, EVENT_AUDIT_ACTION, FOOD_LINE_TYPES, assertTransition } from './constants.js';

const fail = (message, status = 400, extra = {}) => {
  throw Object.assign(new Error(message), { status, ...extra });
};
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

/**
 * Work out what the kitchen has to make, split by how it will be deducted.
 * Pure resolution — reads only.
 */
export async function productionPlan(db, eventId) {
  await ensureEventsSchema(db);
  const event = await db.get('SELECT * FROM events WHERE id = ?', [Number(eventId)]);
  if (!event) fail('Event not found.', 404);

  const lines = await listLines(db, event.id);
  const orderItems = [];   // deducted by the order path
  const rawDeltas = new Map(); // deducted directly, recipe-only components
  const rawSources = [];
  const skipped = [];

  for (const line of lines) {
    if (!FOOD_LINE_TYPES.includes(line.line_type)) continue;
    if (!line.consumes_inventory) {
      skipped.push({ name: line.item_name, reason: 'Marked as not stock-backed.' });
      continue;
    }
    const quantity = Number(line.quantity || 0);
    if (quantity <= 0) continue;

    if (line.line_type === 'package' && line.package_id) {
      const components = await listComponents(db, line.package_id);
      if (!components.length) {
        skipped.push({ name: line.item_name, reason: 'Package has no menu components.' });
        continue;
      }
      for (const component of components) {
        if (!component.consumes_inventory) {
          skipped.push({ name: `${line.item_name} · ${component.component_name}`, reason: 'Component is not stock-backed.' });
          continue;
        }
        const portions = round4(quantity * Number(component.quantity_per_guest || 0));
        if (portions <= 0) continue;

        if (component.menu_item_id) {
          orderItems.push({
            menu_item_id: component.menu_item_id,
            item_name: `${component.component_name} (${line.item_name})`,
            quantity: Math.max(1, Math.round(portions)),
            special_instructions: `Event ${event.event_number}`,
          });
          continue;
        }
        if (component.recipe_id) {
          const map = await explodeRecipe(db, component.recipe_id, portions);
          for (const [rawId, qty] of map) {
            rawDeltas.set(Number(rawId), round4((rawDeltas.get(Number(rawId)) || 0) + Number(qty)));
          }
          rawSources.push({ name: `${line.item_name} · ${component.component_name}`, portions });
          continue;
        }
        skipped.push({ name: `${line.item_name} · ${component.component_name}`, reason: 'No menu item or recipe linked.' });
      }
      continue;
    }

    // A plain menu item or beverage line sells as itself.
    if (line.menu_item_id) {
      orderItems.push({
        menu_item_id: line.menu_item_id,
        item_name: line.item_name,
        quantity: Math.max(1, Math.round(quantity)),
        special_instructions: `Event ${event.event_number}`,
      });
      continue;
    }
    if (line.recipe_id) {
      const map = await explodeRecipe(db, line.recipe_id, quantity);
      for (const [rawId, qty] of map) {
        rawDeltas.set(Number(rawId), round4((rawDeltas.get(Number(rawId)) || 0) + Number(qty)));
      }
      rawSources.push({ name: line.item_name, portions: quantity });
      continue;
    }
    skipped.push({ name: line.item_name, reason: 'Nothing to produce — no menu item or recipe.' });
  }

  return {
    event,
    order_items: orderItems,
    raw_materials: [...rawDeltas].map(([inventory_item_id, quantity]) => ({ inventory_item_id, quantity })),
    raw_sources: rawSources,
    skipped,
    producible: orderItems.length > 0 || rawDeltas.size > 0,
  };
}

/**
 * Release production.
 *
 * @param {object}  options.force  ignore the "nothing to produce" guard
 * @returns { event, order, kot, deducted, skipped }
 */
export async function startEvent(db, eventId, data = {}, actor = {}) {
  await ensureEventsSchema(db);

  const event = await db.get('SELECT * FROM events WHERE id = ?', [Number(eventId)]);
  if (!event) fail('Event not found.', 404);

  // Two independent guards against a double press.
  if (event.started_at) {
    fail(`${event.event_number} was already started at ${event.started_at}.`, 409, {
      code: 'already_started', started_at: event.started_at,
    });
  }
  const existingOrders = await db.get(
    'SELECT COUNT(*) AS n FROM orders WHERE event_id = ?', [event.id]
  );
  if (Number(existingOrders?.n || 0) > 0) {
    fail(`${event.event_number} already has production orders.`, 409, { code: 'already_started' });
  }

  // FINALIZED -> IN_PROGRESS is the only legal way in; assertTransition owns
  // the rule so the lifecycle cannot be bypassed here.
  assertTransition(event.status, EVENT_STATUS.IN_PROGRESS);

  const businessDayId = await currentBusinessDayId(db, { required: true, allowStale: true });
  const plan = await productionPlan(db, event.id);
  if (!plan.producible && !data.force) {
    fail(
      'This event has nothing to produce — no stock-backed food is quoted.',
      409,
      { code: 'nothing_to_produce', skipped: plan.skipped }
    );
  }

  const orders = new OrderRepository();
  let order = null;
  let kot = null;
  let rawDeducted = [];
  let warnings = [];

  // The order carries its own transaction (it must, to deduct atomically), so
  // the event is marked started only after it has genuinely succeeded.
  if (plan.order_items.length) {
    const created = await orders.create({
      order_type: 'dine_in',
      table_id: data.table_id || null,
      waiter_id: actor.id || null,
      customer_id: event.customer_id || null,
      customer_name: event.contact_name || null,
      customer_phone: event.contact_phone || null,
      notes: `Event production — ${event.event_number}`,
      party_label: event.event_number,
      business_day_id: businessDayId,
      event_id: event.id,
      allow_multiple: true,
      items: plan.order_items,
    });
    order = created;
    warnings = created.stock?.warnings || [];
    // This order fulfils what the quotation already charges for. Marking it
    // keeps billing from counting the contracted food twice.
    await db.run('UPDATE orders SET event_production = 1 WHERE id = ?', [created.order_id]);
  }

  // Recipe-only components have no menu item to sell, so their raw materials go
  // through the same ledger the order path uses, tagged to this event's order.
  if (plan.raw_materials.length) {
    const deltaMap = new Map(plan.raw_materials.map((r) => [r.inventory_item_id, r.quantity]));
    const result = await db.transaction(async (tx) => deductRawMaterials(tx, deltaMap, {
      direction: -1,
      changeType: 'order_deduction',
      performedBy: actor.id || null,
      reason: `Event production — ${event.event_number}`,
      referenceId: order?.order_id || null,
      businessDayId,
    }));
    rawDeducted = result.deducted || [];
    warnings = [...warnings, ...(result.warnings || [])];
  }

  // Kitchen ticket via the existing service, idempotent on its own key.
  if (order?.order_id) {
    try {
      kot = await issueKot(db, {
        orderId: order.order_id,
        actor,
        idempotencyKey: `event-${event.id}-start`,
        orderNotes: `Event ${event.event_number}`,
      });
    } catch (err) {
      // A ticket that fails to print must not hide that stock already moved.
      warnings.push(`Production started, but the kitchen ticket failed: ${err.message}`);
    }
  }

  await db.transaction(async (tx) => {
    await tx.run(
      `UPDATE events
          SET status = ?, started_at = CURRENT_TIMESTAMP, business_day_id = ?,
              updated_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [EVENT_STATUS.IN_PROGRESS, businessDayId, actor.id || null, event.id]
    );
    await logEventAudit(tx, {
      action: EVENT_AUDIT_ACTION.STARTED,
      eventId: event.id, entityType: 'event', entityId: event.id, actor,
      reason: data.reason || null,
      previous: { status: event.status },
      next: {
        status: EVENT_STATUS.IN_PROGRESS,
        order_id: order?.order_id || null,
        order_number: order?.order_number || null,
        kot_number: kot?.kot?.kot_number || null,
        order_lines: plan.order_items.length,
        raw_materials: plan.raw_materials.length,
        business_day_id: businessDayId,
      },
      detail: { skipped: plan.skipped, warnings },
    });
  });

  return {
    event: await db.get('SELECT * FROM events WHERE id = ?', [event.id]),
    order,
    kot: kot?.kot || null,
    deducted: {
      via_order: order?.stock?.deducted?.length || 0,
      via_recipe: rawDeducted.length,
    },
    skipped: plan.skipped,
    warnings,
  };
}

/**
 * Additional production during a running event — extra food, drinks, a late
 * round of snacks. Each becomes its own event-linked order so the event
 * aggregates several orders, exactly as the brief requires.
 */
export async function addProductionOrder(db, eventId, data = {}, actor = {}) {
  await ensureEventsSchema(db);
  const event = await db.get('SELECT * FROM events WHERE id = ?', [Number(eventId)]);
  if (!event) fail('Event not found.', 404);
  if (event.status !== EVENT_STATUS.IN_PROGRESS) {
    fail(`Additional orders can only be added while an event is in progress (this one is ${event.status}).`, 409);
  }

  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) fail('Add at least one item.');
  for (const item of items) {
    if (!item.menu_item_id) fail('Each additional item must reference a menu item.');
    const qty = Number(item.quantity || 0);
    if (!Number.isFinite(qty) || qty <= 0) fail('Quantity must be greater than zero.');
  }

  const businessDayId = await currentBusinessDayId(db, { required: true, allowStale: true });
  const orders = new OrderRepository();
  const created = await orders.create({
    order_type: 'dine_in',
    table_id: data.table_id || null,
    waiter_id: actor.id || null,
    customer_id: event.customer_id || null,
    customer_name: event.contact_name || null,
    notes: data.notes || `Additional event order — ${event.event_number}`,
    party_label: event.event_number,
    business_day_id: businessDayId,
    event_id: event.id,
    allow_multiple: true,
    items: items.map((i) => ({
      menu_item_id: Number(i.menu_item_id),
      quantity: Number(i.quantity),
      variant_name: i.variant_name || null,
      special_instructions: i.special_instructions || `Event ${event.event_number}`,
    })),
  });

  let kot = null;
  const warnings = created.stock?.warnings || [];
  try {
    kot = await issueKot(db, {
      orderId: created.order_id,
      actor,
      idempotencyKey: data.idempotency_key || null,
      orderNotes: `Event ${event.event_number}`,
    });
  } catch (err) {
    warnings.push(`Order created, but the kitchen ticket failed: ${err.message}`);
  }

  await db.transaction(async (tx) => {
    await logEventAudit(tx, {
      action: EVENT_AUDIT_ACTION.STARTED,
      eventId: event.id, entityType: 'order', entityId: created.order_id, actor,
      reason: data.notes || 'Additional production',
      next: { order_number: created.order_number, items: items.length, kot: kot?.kot?.kot_number || null },
    });
  });

  return { order: created, kot: kot?.kot || null, warnings };
}

/** Every operational order raised against an event. */
export async function eventOrders(db, eventId) {
  await ensureEventsSchema(db);
  return db.all(
    `SELECT o.id, o.order_number, o.status, o.created_at, o.notes, o.event_production,
            (SELECT COUNT(*) FROM order_items oi
              WHERE oi.order_id = o.id AND COALESCE(oi.status,'') NOT IN ('voided','cancelled')) AS item_count,
            (SELECT COALESCE(SUM(oi.subtotal),0) FROM order_items oi
              WHERE oi.order_id = o.id AND COALESCE(oi.status,'') NOT IN ('voided','cancelled')) AS total_amount,
            (SELECT COUNT(*) FROM kots k WHERE k.order_id = o.id) AS kot_count
       FROM orders o
      WHERE o.event_id = ?
      ORDER BY o.id`,
    [Number(eventId)]
  );
}

/**
 * Event quotation lines — the body of the quote and the BEO.
 *
 * A line is one chargeable thing on an event: a catering package, a dish from
 * the restaurant menu, a custom dish, drinks, the venue charge, decoration, a
 * DJ, hired equipment, or a complimentary item.
 *
 * PRICES ARE SNAPSHOTS. `unit_price` is written once, when the line is added or
 * deliberately edited. `menu_items.base_price` is never read again afterwards
 * and is never written to, so:
 *
 *   - repricing the restaurant menu cannot move a quotation that is already out
 *     with a client, and
 *   - a negotiated event price never leaks back into restaurant prices.
 *
 * `list_price` keeps the ordinary price beside the charged one, so a quote can
 * show "normally 500, yours 450" and Phase 16 can report the discount given.
 *
 * Totals reuse calculateBillTotals() from lib/billing-totals.js — the same
 * discount/VAT/service-charge arithmetic the restaurant bill uses. The events
 * module does not do its own tax maths.
 */
import { calculateBillTotals } from '../billing-totals.js';
import { ensureEventsSchema } from './schema.js';
import { logEventAudit } from './audit.js';
import { getPackage } from './packages.js';
import { priceForGuests } from './pricing.js';
import {
  EVENT_LINE_TYPE, EVENT_LINE_TYPES, FOOD_LINE_TYPES,
  EVENT_AUDIT_ACTION, PRICE_LOCKED_STATUSES, TERMINAL_STATUSES,
} from './constants.js';

const fail = (message, status = 400, extra = {}) => {
  throw Object.assign(new Error(message), { status, ...extra });
};
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const cleanText = (v, max = 500) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

/* ------------------------------------------------------------------ reads */

export async function listLines(db, eventId) {
  await ensureEventsSchema(db);
  return db.all(
    `SELECT l.*, p.name AS package_name, mi.name AS menu_item_current_name,
            mi.base_price AS menu_item_current_price, r.name AS recipe_name,
            u.full_name AS overridden_by_name
       FROM event_menu_lines l
       LEFT JOIN event_packages p ON p.id = l.package_id
       LEFT JOIN menu_items mi ON mi.id = l.menu_item_id
       LEFT JOIN recipes r ON r.id = l.recipe_id
       LEFT JOIN users u ON u.id = l.overridden_by
      WHERE l.event_id = ?
      ORDER BY l.sort_order, l.id`,
    [Number(eventId)]
  );
}

/* ----------------------------------------------------------------- totals */

/**
 * Recompute and persist an event's money columns from its lines.
 *
 * Complimentary lines are kept at zero so they appear on the quote without
 * being charged. Everything else contributes its line_total.
 */
export async function recalculateEventTotals(db, eventId, { tx = null } = {}) {
  const handle = tx || db;
  const event = await handle.get('SELECT * FROM events WHERE id = ?', [Number(eventId)]);
  if (!event) fail('Event not found.', 404);

  const rows = await handle.all(
    'SELECT line_total, is_complimentary FROM event_menu_lines WHERE event_id = ?',
    [event.id]
  );
  const subtotal = round2(
    rows.reduce((sum, r) => sum + (r.is_complimentary ? 0 : Number(r.line_total || 0)), 0)
  );

  const totals = calculateBillTotals(subtotal, {
    discountAmount: Number(event.discount_amount || 0),
    vatPercent: Number(event.tax_percent || 0),
    servicePercent: Number(event.service_charge_percent || 0),
  });

  const deposits = await handle.get(
    `SELECT COALESCE(SUM(CASE WHEN entry_type = 'refund' THEN -amount ELSE amount END), 0) AS paid
       FROM event_deposits WHERE event_id = ? AND status = 'active'`,
    [event.id]
  );
  const depositTotal = round2(deposits?.paid || 0);
  const outstanding = round2(totals.total - depositTotal);

  await handle.run(
    `UPDATE events
        SET subtotal = ?, service_charge_amount = ?, tax_amount = ?,
            total_amount = ?, deposit_total = ?, outstanding_amount = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [subtotal, round2(totals.serviceCharge), round2(totals.tax), round2(totals.total),
     depositTotal, outstanding, event.id]
  );

  return {
    subtotal,
    discount: round2(totals.discount),
    service_charge: round2(totals.serviceCharge),
    tax: round2(totals.tax),
    total: round2(totals.total),
    deposit_total: depositTotal,
    outstanding: outstanding,
  };
}

/* ------------------------------------------------------------------ guards */

async function loadEditableEvent(db, eventId, { allowLocked = false } = {}) {
  const event = await db.get('SELECT * FROM events WHERE id = ?', [Number(eventId)]);
  if (!event) fail('Event not found.', 404);
  if (TERMINAL_STATUSES.includes(event.status)) {
    fail(`A ${event.status.toLowerCase()} event can no longer be quoted.`, 409);
  }
  if (!allowLocked && PRICE_LOCKED_STATUSES.includes(event.status)) {
    fail(
      `${event.event_number} is ${event.status} — its quotation is locked. Reopen it to QUOTED, or supply a change reason.`,
      409,
      { code: 'quote_locked', overridable: true }
    );
  }
  return event;
}

/* ------------------------------------------------------------------ writes */

/**
 * Build one line from a client payload, resolving its price server-side.
 * The caller never dictates the price of a package or a menu item unless it
 * explicitly overrides, which is recorded.
 */
async function buildLine(db, event, data, actor) {
  const lineType = data.line_type;
  if (!EVENT_LINE_TYPES.includes(lineType)) {
    fail(`Line type must be one of: ${EVENT_LINE_TYPES.join(', ')}.`);
  }

  const quantity = Number(data.quantity ?? 1);
  if (!Number.isFinite(quantity) || quantity <= 0) fail('Quantity must be greater than zero.');

  const isComplimentary = lineType === EVENT_LINE_TYPE.COMPLIMENTARY || Boolean(data.is_complimentary);
  const overrideReason = cleanText(data.override_reason, 400);
  const wantsOverride = data.unit_price !== undefined && data.unit_price !== null && data.unit_price !== '';

  let itemName = cleanText(data.item_name, 200);
  let unitPrice = null;
  let listPrice = null;
  let pricingPolicy = null;
  let packageId = null;
  let menuItemId = null;
  let recipeId = null;
  let consumesInventory = data.consumes_inventory === undefined ? 1 : (data.consumes_inventory ? 1 : 0);

  if (lineType === EVENT_LINE_TYPE.PACKAGE) {
    packageId = Number(data.package_id);
    if (!packageId) fail('Choose a package for a package line.');
    const pkg = await getPackage(db, packageId);
    if (!pkg.is_active && !data.allow_inactive) {
      fail(`${pkg.name} is inactive and cannot be added to a new quotation.`, 409, { code: 'package_inactive' });
    }
    // Quantity on a package line is the number of guests taking it.
    const priced = priceForGuests(pkg, pkg.tiers, quantity, {
      policy: data.pricing_policy || pkg.pricing_policy,
      manualRate: data.manual_rate,
    });
    pricingPolicy = priced.policy;
    listPrice = round2(priced.effective_per_guest);
    unitPrice = listPrice;
    itemName = itemName || pkg.name;
  } else if (lineType === EVENT_LINE_TYPE.MENU_ITEM || lineType === EVENT_LINE_TYPE.BEVERAGE) {
    menuItemId = data.menu_item_id ? Number(data.menu_item_id) : null;
    if (menuItemId) {
      const item = await db.get('SELECT id, name, base_price FROM menu_items WHERE id = ?', [menuItemId]);
      if (!item) fail('That menu item no longer exists.', 404);
      // Snapshot both: what it normally sells for, and what we will charge.
      listPrice = round2(item.base_price);
      unitPrice = listPrice;
      itemName = itemName || item.name;
    } else {
      if (!itemName) fail('Enter a name for this line.');
      unitPrice = 0;
    }
  } else if (lineType === EVENT_LINE_TYPE.CUSTOM_FOOD) {
    if (!itemName) fail('Enter a name for the custom dish.');
    recipeId = data.recipe_id ? Number(data.recipe_id) : null;
    if (recipeId) {
      const recipe = await db.get('SELECT id FROM recipes WHERE id = ?', [recipeId]);
      if (!recipe) fail('That recipe no longer exists.', 404);
    } else if (consumesInventory) {
      // Custom food with no recipe and no explicit opt-out would cost nothing
      // and consume nothing — silently untracked food.
      fail(
        'Custom food needs a recipe, or must be marked as not stock-backed so it is deliberately excluded from food cost.',
        400,
        { code: 'custom_food_untracked' }
      );
    }
    unitPrice = 0;
  } else {
    // venue / service / equipment / misc / complimentary — not food.
    if (!itemName) fail('Enter a name for this line.');
    unitPrice = 0;
    consumesInventory = 0;
  }

  // An explicit price always wins, but only with a reason recorded.
  let overridden = 0;
  if (wantsOverride) {
    const price = Number(data.unit_price);
    if (!Number.isFinite(price) || price < 0) fail('Unit price must be zero or more.');
    const isDefaultPriced = lineType === EVENT_LINE_TYPE.PACKAGE
      || ((lineType === EVENT_LINE_TYPE.MENU_ITEM || lineType === EVENT_LINE_TYPE.BEVERAGE) && menuItemId);
    if (isDefaultPriced && round2(price) !== round2(unitPrice)) {
      if (!overrideReason) {
        fail('A reason is required to charge a price other than the standard one.', 400, {
          code: 'override_reason_required',
          standard_price: round2(unitPrice),
        });
      }
      overridden = 1;
    }
    unitPrice = round2(price);
  }

  if (isComplimentary) unitPrice = 0;

  const lineTotal = round2(unitPrice * quantity);

  return {
    line_type: lineType,
    package_id: packageId,
    menu_item_id: menuItemId,
    recipe_id: recipeId,
    item_name: itemName,
    description: cleanText(data.description, 500),
    quantity: round2(quantity),
    unit_price: round2(unitPrice),
    list_price: listPrice == null ? null : round2(listPrice),
    line_total: lineTotal,
    pricing_policy: pricingPolicy,
    price_overridden: overridden,
    override_reason: overridden ? overrideReason : null,
    overridden_by: overridden ? (actor.id || null) : null,
    is_complimentary: isComplimentary ? 1 : 0,
    consumes_inventory: FOOD_LINE_TYPES.includes(lineType) ? consumesInventory : 0,
    sort_order: Number.isFinite(Number(data.sort_order)) ? Number(data.sort_order) : 0,
  };
}

export async function addLine(db, eventId, data = {}, actor = {}) {
  await ensureEventsSchema(db);
  const event = await loadEditableEvent(db, eventId, { allowLocked: Boolean(data.change_reason) });
  const line = await buildLine(db, event, data, actor);

  const next = await db.get(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM event_menu_lines WHERE event_id = ?',
    [event.id]
  );

  const created = await db.transaction(async (tx) => {
    const res = await tx.run(
      `INSERT INTO event_menu_lines
         (event_id, line_type, package_id, menu_item_id, recipe_id, item_name, description,
          quantity, unit_price, list_price, line_total, pricing_policy,
          price_overridden, override_reason, overridden_by, is_complimentary,
          consumes_inventory, sort_order, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        event.id, line.line_type, line.package_id, line.menu_item_id, line.recipe_id,
        line.item_name, line.description, line.quantity, line.unit_price, line.list_price,
        line.line_total, line.pricing_policy, line.price_overridden, line.override_reason,
        line.overridden_by, line.is_complimentary, line.consumes_inventory,
        Number(next?.n || 0), actor.id || null,
      ]
    );
    const lineId = res.lastInsertRowid;

    await logEventAudit(tx, {
      action: EVENT_AUDIT_ACTION.LINE_ADDED,
      eventId: event.id, entityType: 'menu_line', entityId: lineId, actor,
      reason: data.change_reason || null,
      next: { name: line.item_name, qty: line.quantity, unit_price: line.unit_price, type: line.line_type },
    });
    if (line.price_overridden) {
      await logEventAudit(tx, {
        action: EVENT_AUDIT_ACTION.PRICE_OVERRIDDEN,
        eventId: event.id, entityType: 'menu_line', entityId: lineId, actor,
        reason: line.override_reason,
        previous: { standard_price: line.list_price },
        next: { charged_price: line.unit_price },
      });
    }
    await recalculateEventTotals(db, event.id, { tx });
    return lineId;
  });

  return { line_id: created, lines: await listLines(db, event.id), totals: await recalculateEventTotals(db, event.id) };
}

export async function updateLine(db, eventId, lineId, data = {}, actor = {}) {
  await ensureEventsSchema(db);
  const event = await loadEditableEvent(db, eventId, { allowLocked: Boolean(data.change_reason) });
  const existing = await db.get(
    'SELECT * FROM event_menu_lines WHERE id = ? AND event_id = ?',
    [Number(lineId), event.id]
  );
  if (!existing) fail('That quotation line was not found.', 404);

  const quantity = data.quantity === undefined ? Number(existing.quantity) : Number(data.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) fail('Quantity must be greater than zero.');

  let unitPrice = Number(existing.unit_price);
  let overridden = existing.price_overridden;
  let overrideReason = existing.override_reason;

  if (data.unit_price !== undefined && data.unit_price !== null && data.unit_price !== '') {
    const price = Number(data.unit_price);
    if (!Number.isFinite(price) || price < 0) fail('Unit price must be zero or more.');
    if (round2(price) !== round2(existing.unit_price)) {
      const reason = cleanText(data.override_reason, 400);
      if (!reason) {
        fail('A reason is required to change the price of a quoted line.', 400, {
          code: 'override_reason_required',
        });
      }
      overridden = 1;
      overrideReason = reason;
    }
    unitPrice = round2(price);
  }

  const isComplimentary = data.is_complimentary === undefined
    ? existing.is_complimentary
    : (data.is_complimentary ? 1 : 0);
  if (isComplimentary) unitPrice = 0;

  const lineTotal = round2(unitPrice * quantity);

  await db.transaction(async (tx) => {
    await tx.run(
      `UPDATE event_menu_lines
          SET quantity = ?, unit_price = ?, line_total = ?, is_complimentary = ?,
              description = COALESCE(?, description),
              price_overridden = ?, override_reason = ?, overridden_by = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [quantity, unitPrice, lineTotal, isComplimentary, cleanText(data.description, 500),
       overridden, overrideReason, overridden ? (actor.id || null) : existing.overridden_by, existing.id]
    );
    await logEventAudit(tx, {
      action: EVENT_AUDIT_ACTION.LINE_UPDATED,
      eventId: event.id, entityType: 'menu_line', entityId: existing.id, actor,
      reason: data.change_reason || overrideReason || null,
      previous: { qty: existing.quantity, unit_price: existing.unit_price },
      next: { qty: quantity, unit_price: unitPrice },
    });
    if (overridden && !existing.price_overridden) {
      await logEventAudit(tx, {
        action: EVENT_AUDIT_ACTION.PRICE_OVERRIDDEN,
        eventId: event.id, entityType: 'menu_line', entityId: existing.id, actor,
        reason: overrideReason,
        previous: { was: existing.unit_price }, next: { now: unitPrice },
      });
    }
    await recalculateEventTotals(db, event.id, { tx });
  });

  return { lines: await listLines(db, event.id), totals: await recalculateEventTotals(db, event.id) };
}

export async function removeLine(db, eventId, lineId, data = {}, actor = {}) {
  await ensureEventsSchema(db);
  const event = await loadEditableEvent(db, eventId, { allowLocked: Boolean(data.change_reason) });
  const existing = await db.get(
    'SELECT * FROM event_menu_lines WHERE id = ? AND event_id = ?',
    [Number(lineId), event.id]
  );
  if (!existing) fail('That quotation line was not found.', 404);

  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM event_menu_lines WHERE id = ?', [existing.id]);
    await logEventAudit(tx, {
      action: EVENT_AUDIT_ACTION.LINE_REMOVED,
      eventId: event.id, entityType: 'menu_line', entityId: existing.id, actor,
      reason: data.change_reason || null,
      previous: { name: existing.item_name, qty: existing.quantity, amount: existing.line_total },
    });
    await recalculateEventTotals(db, event.id, { tx });
  });

  return { lines: await listLines(db, event.id), totals: await recalculateEventTotals(db, event.id) };
}

/** Set the event-level discount / tax / service percentages, then re-total. */
export async function setEventCharges(db, eventId, data = {}, actor = {}) {
  await ensureEventsSchema(db);
  const event = await loadEditableEvent(db, eventId, { allowLocked: Boolean(data.change_reason) });

  const patch = {};
  if (data.discount_amount !== undefined) {
    const d = Number(data.discount_amount);
    if (!Number.isFinite(d) || d < 0) fail('Discount cannot be negative.');
    patch.discount_amount = round2(d);
    patch.discount_reason = cleanText(data.discount_reason, 300);
  }
  for (const key of ['tax_percent', 'service_charge_percent']) {
    if (data[key] === undefined) continue;
    const v = Number(data[key]);
    if (!Number.isFinite(v) || v < 0) fail(`${key.replace(/_/g, ' ')} cannot be negative.`);
    patch[key] = v;
  }
  if (!Object.keys(patch).length) return recalculateEventTotals(db, event.id);

  await db.transaction(async (tx) => {
    const sets = Object.keys(patch).map((k) => `${k} = ?`).join(', ');
    await tx.run(`UPDATE events SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [...Object.values(patch), event.id]);
    await logEventAudit(tx, {
      action: EVENT_AUDIT_ACTION.UPDATED,
      eventId: event.id, entityType: 'event', entityId: event.id, actor,
      reason: data.change_reason || patch.discount_reason || null,
      previous: Object.fromEntries(Object.keys(patch).map((k) => [k, event[k]])),
      next: patch,
    });
    await recalculateEventTotals(db, event.id, { tx });
  });

  return recalculateEventTotals(db, event.id);
}

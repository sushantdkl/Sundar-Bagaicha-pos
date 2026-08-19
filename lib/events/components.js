/**
 * Package food components and their cost.
 *
 * A package's components are the dishes it serves — rice, dal, chicken curry,
 * salad, dessert. Each component points at something the restaurant already
 * knows how to make:
 *
 *   menu_item_id  an existing menu item (its recipe is found the same way the
 *                 POS finds it when an order is placed)
 *   recipe_id     an existing recipe or sub-recipe, including one created
 *                 specifically for events
 *   neither       a named component with no BOM yet, or a deliberately
 *                 non-stock item (consumes_inventory = 0)
 *
 * Recipes are referenced, never copied: a change to the restaurant's chicken
 * curry recipe is immediately reflected in every package that serves it.
 *
 * PRICE AND COST ARE SEPARATE, and deliberately so:
 *
 *   price  comes from event_package_price_tiers (what the guest pays)
 *   cost   is computed here from the recipe BOM at current inventory cost
 *
 * Neither derives from the other. Changing menu_items.base_price cannot move a
 * package's price, because a package is never priced from menu prices.
 *
 * Nothing in this module writes stock. Costing walks the BOM with
 * explodeRecipe(), which is read-only; only deductRawMaterials() moves
 * inventory, and it is not called here or anywhere else in the events module.
 */
import { ensureEventsSchema } from './schema.js';
import { toId } from './ids.js';
import { logEventAudit } from './audit.js';
import { EVENT_AUDIT_ACTION } from './constants.js';
import { getRecipeCost, getRecipeByMenuItemId } from '../recipes.js';

const fail = (message, status = 400, extra = {}) => {
  throw Object.assign(new Error(message), { status, ...extra });
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

const cleanText = (value, max = 500) => {
  const s = String(value ?? '').trim();
  return s ? s.slice(0, max) : null;
};

function validateComponent(raw, index) {
  const label = `Component ${index + 1}`;
  const name = cleanText(raw.component_name, 160);
  if (!name) fail(`${label}: enter a name.`);

  const qty = Number(raw.quantity_per_guest ?? 1);
  if (!Number.isFinite(qty)) fail(`${label}: quantity per guest must be a number.`);
  if (qty <= 0) fail(`${label}: quantity per guest must be greater than zero.`);

  const menuItemId = raw.menu_item_id ? Number(raw.menu_item_id) : null;
  const recipeId = raw.recipe_id ? Number(raw.recipe_id) : null;
  if (menuItemId && recipeId) {
    fail(`${label}: link either a menu item or a recipe, not both.`);
  }

  // A food component with no BOM would silently cost nothing. That is allowed
  // only when someone has explicitly said it is not stock-backed.
  const consumes = raw.consumes_inventory === undefined ? 1 : (raw.consumes_inventory ? 1 : 0);

  return {
    component_name: name,
    menu_item_id: menuItemId,
    recipe_id: recipeId,
    quantity_per_guest: round4(qty),
    unit: cleanText(raw.unit, 40),
    is_optional: raw.is_optional ? 1 : 0,
    consumes_inventory: consumes,
    notes: cleanText(raw.notes, 500),
    sort_order: Number.isFinite(Number(raw.sort_order)) ? Number(raw.sort_order) : index,
  };
}

/* ------------------------------------------------------------------ reads */

export async function listComponents(db, packageId) {
  await ensureEventsSchema(db);
  return db.all(
    `SELECT c.*,
            mi.name AS menu_item_name,
            mi.base_price AS menu_item_price,
            mi.is_available AS menu_item_available,
            r.name AS recipe_name,
            r.yield_quantity AS recipe_yield_quantity,
            r.yield_unit AS recipe_yield_unit
       FROM event_package_components c
       LEFT JOIN menu_items mi ON mi.id = c.menu_item_id
       LEFT JOIN recipes r ON r.id = c.recipe_id
      WHERE c.package_id = ?
      ORDER BY c.sort_order, c.id`,
    [toId(packageId, 'package')]
  );
}

/**
 * Resolve the recipe that actually produces a component.
 *
 * Mirrors how lib/stock.js resolves a sold menu item, so the cost shown here
 * and the stock consumed later come from the same BOM.
 */
export async function resolveComponentRecipe(db, component) {
  if (component.recipe_id) {
    const recipe = await db.get('SELECT * FROM recipes WHERE id = ?', [component.recipe_id]);
    return recipe || null;
  }
  if (component.menu_item_id) {
    return getRecipeByMenuItemId(db, component.menu_item_id);
  }
  return null;
}

/* ------------------------------------------------------------------ costs */

/**
 * Estimated food cost of one package, per guest and for a head count.
 *
 * `quantity_per_guest` is expressed in recipe yields — one yield of the
 * "Chicken Curry (buffet)" recipe per guest is 1, half a yield is 0.5.
 *
 * Components that cannot be costed are reported rather than hidden: a package
 * whose curry has no recipe is not free, it is unknown, and quoting from an
 * unknown cost is how a venue loses money without noticing.
 */
export async function packageFoodCost(db, packageId, { guests = 1 } = {}) {
  await ensureEventsSchema(db);
  const count = Math.max(1, Number(guests) || 1);
  const components = await listComponents(db, packageId);

  const lines = [];
  const uncosted = [];
  let perGuest = 0;

  for (const component of components) {
    const recipe = await resolveComponentRecipe(db, component);
    const qty = Number(component.quantity_per_guest || 0);

    if (!component.consumes_inventory) {
      lines.push({
        component_id: component.id,
        name: component.component_name,
        source: 'non_stock',
        quantity_per_guest: qty,
        cost_per_guest: 0,
        note: 'Marked as not stock-backed — excluded from food cost.',
      });
      continue;
    }

    if (!recipe) {
      uncosted.push({
        component_id: component.id,
        name: component.component_name,
        reason: component.menu_item_id
          ? 'The linked menu item has no recipe yet.'
          : 'No menu item or recipe is linked.',
      });
      lines.push({
        component_id: component.id,
        name: component.component_name,
        source: 'unknown',
        quantity_per_guest: qty,
        cost_per_guest: null,
      });
      continue;
    }

    const cost = await getRecipeCost(db, recipe.id);
    const costPerGuest = round4(Number(cost.total_cost || 0) * qty);
    perGuest += costPerGuest;
    lines.push({
      component_id: component.id,
      name: component.component_name,
      source: component.recipe_id ? 'recipe' : 'menu_item',
      recipe_id: recipe.id,
      recipe_name: recipe.name,
      quantity_per_guest: qty,
      cost_per_yield: round4(cost.total_cost),
      cost_per_guest: costPerGuest,
      ingredients: cost.breakdown.length,
    });
  }

  return {
    package_id: toId(packageId, 'package'),
    guests: count,
    components: lines,
    uncosted,
    complete: uncosted.length === 0,
    food_cost_per_guest: round2(perGuest),
    food_cost_total: round2(perGuest * count),
  };
}

/**
 * Selling price against food cost for a head count.
 *
 * Kept in one place so the quotation screens cannot invent their own margin
 * arithmetic. `priceResult` comes from lib/events/pricing.js — this function
 * never prices anything itself.
 */
export function marginFromPriceAndCost(priceResult, costResult) {
  const revenue = round2(priceResult?.total || 0);
  const cost = round2(costResult?.food_cost_total || 0);
  const guests = Number(priceResult?.guests || costResult?.guests || 0);
  const contribution = round2(revenue - cost);
  return {
    guests,
    revenue,
    food_cost: cost,
    contribution,
    selling_price_per_guest: guests ? round2(revenue / guests) : 0,
    food_cost_per_guest: round2(costResult?.food_cost_per_guest || 0),
    food_cost_percent: revenue > 0 ? round2((cost / revenue) * 100) : null,
    // A partial cost understates food cost, so the margin must not be read as
    // final until every component prices.
    cost_complete: Boolean(costResult?.complete),
  };
}

/* ----------------------------------------------------------------- writes */

/**
 * Replace a package's component list. The editor always submits the full set,
 * matching how lib/menu-variants.js handles variants.
 */
export async function replaceComponents(db, packageId, components = [], actor = {}) {
  await ensureEventsSchema(db);
  const pkg = await db.get('SELECT id, name FROM event_packages WHERE id = ?', [toId(packageId, 'package')]);
  if (!pkg) fail('Event package not found.', 404);

  const clean = (Array.isArray(components) ? components : []).map(validateComponent);

  // Referential checks before writing anything, so a bad id cannot leave a
  // half-updated component list behind.
  for (const c of clean) {
    if (c.menu_item_id) {
      const item = await db.get('SELECT id FROM menu_items WHERE id = ?', [c.menu_item_id]);
      if (!item) fail(`${c.component_name}: that menu item no longer exists.`, 404);
    }
    if (c.recipe_id) {
      const recipe = await db.get('SELECT id FROM recipes WHERE id = ?', [c.recipe_id]);
      if (!recipe) fail(`${c.component_name}: that recipe no longer exists.`, 404);
    }
  }

  const previous = await listComponents(db, pkg.id);

  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM event_package_components WHERE package_id = ?', [pkg.id]);
    for (const [i, c] of clean.entries()) {
      await tx.run(
        `INSERT INTO event_package_components
           (package_id, component_name, menu_item_id, recipe_id, quantity_per_guest,
            unit, is_optional, consumes_inventory, notes, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          pkg.id, c.component_name, c.menu_item_id, c.recipe_id, c.quantity_per_guest,
          c.unit, c.is_optional, c.consumes_inventory, c.notes, i,
        ]
      );
    }
    await logEventAudit(tx, {
      action: EVENT_AUDIT_ACTION.PACKAGE_CONFIG_CHANGED,
      entityType: 'package',
      entityId: pkg.id,
      actor,
      previous: previous.map((p) => ({ name: p.component_name, qty: p.quantity_per_guest })),
      next: clean.map((c) => ({ name: c.component_name, qty: c.quantity_per_guest })),
      detail: 'components replaced',
    });
  });

  return listComponents(db, pkg.id);
}

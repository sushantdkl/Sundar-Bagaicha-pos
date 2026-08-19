/**
 * Decrease inventory when menu/custom items are sold.
 * Matches inventory rows by menu_item_id (if set) or fuzzy name.
 */

function normalize(name = '') {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

import { ensureColumn } from '@/lib/db/schema-helpers.js';
import {
  ensureRecipeTables,
  getRecipeByMenuItemId,
  explodeRecipe,
  deductRawMaterials,
} from '@/lib/recipes.js';
import { ensureStockMovementsTable } from '@/lib/stock-movements.js';
import { applyStockChange, resolveInventoryItem } from '@/lib/inventory-ledger.js';

// A variant with its own inventory_item_id + stock_quantity overrides the
// menu item's recipe/base link entirely — e.g. "60ml" and "120ml" pours of
// the same bottle draw different amounts, so the variant's own numbers win.
async function resolveVariantStockLink(db, menuId, variantName) {
  if (!menuId || !variantName) return null;
  const variant = await db.get(
    `SELECT * FROM menu_item_variants WHERE menu_item_id = ? AND variant_name = ?`,
    [menuId, variantName]
  );
  if (!variant?.inventory_item_id || !variant?.stock_quantity) return null;
  const row = await db.get(
    `SELECT * FROM inventory_items WHERE id = ? AND COALESCE(is_archived, 0) = 0`,
    [variant.inventory_item_id]
  );
  if (!row) return null;
  return { row, perUnit: Number(variant.stock_quantity) };
}

/**
 * Raw-material deltas for one menu item, or null when the item has no usable
 * recipe.
 *
 * "No usable recipe" covers both no recipe row at all and a recipe that
 * explodes to nothing: deploy/production_seed.sql inserts a stub recipe for
 * every menu item (`prep_notes = '__dsp_seed__'`, zero recipe_items), and
 * treating those as real is what stopped bottled drinks and cigarettes from
 * ever being deducted. Returning null hands the item to the direct inventory
 * link instead.
 */
async function explodeRecipeFor(db, menuId, qty) {
  if (!menuId) return null;
  const recipe = await getRecipeByMenuItemId(db, menuId);
  if (!recipe) return null;
  const deltaMap = await explodeRecipe(db, recipe.id, qty);
  return deltaMap && deltaMap.size > 0 ? deltaMap : null;
}

async function ensureInventoryLinkColumn(db) {
  try {
    await ensureColumn(db, 'inventory_items', 'menu_item_id', 'INTEGER');
  } catch {
    /* ignore — already exists */
  }
  try {
    await ensureRecipeTables(db);
  } catch {
    /* ignore — already exists */
  }
  try {
    await ensureStockMovementsTable(db);
  } catch {
    /* ignore — already exists */
  }
}

/**
 * @param {object} db - PosDatabase instance
 * @param {Array<{menu_item_id?:number,name?:string,item_name?:string,quantity:number}>} items
 * @returns {Promise<{deducted: Array, warnings: Array}>}
 */
export async function deductStockForItems(db, items = [], context = {}) {
  await ensureInventoryLinkColumn(db);
  const { orderId, performedBy } = context;
  const deducted = [];
  const warnings = [];

  for (const item of items) {
    const qty = Number(item.quantity || 0);
    if (qty <= 0) continue;

    const menuId = item.menu_item_id || item.item_id || item.id || null;

    const variantLink = await resolveVariantStockLink(db, menuId, item.variant_name);
    if (variantLink) {
      const applied = await applyStockChange(db, {
        inventory_item_id: variantLink.row.id,
        quantity: -(variantLink.perUnit * qty),
        change_type: 'order_deduction',
        performed_by: performedBy,
        reason: item.item_name || item.name,
        reference_id: orderId,
      });
      if (applied) {
        deducted.push({ ...applied, sold: variantLink.perUnit * qty });
        if (applied.warning) warnings.push(applied.warning);
        const min = Number(variantLink.row.min_stock_level ?? variantLink.row.min_stock ?? 0);
        if (applied.to <= 0 && !applied.warning) warnings.push(`${applied.name} is now out of stock.`);
        else if (min > 0 && applied.to > 0 && applied.to <= min) warnings.push(`${applied.name} is running low (${applied.to} ${variantLink.row.unit || 'left'}).`);
      }
      continue;
    }

    // An ingredient-less recipe says nothing about what a sale consumes, and
    // the deployment seed writes exactly one of those for every menu item. It
    // must not swallow the deduction — fall through to the direct inventory
    // link instead, which is how a Coke can or a cigarette pack is stocked.
    const deltaMap = await explodeRecipeFor(db, menuId, qty);

    if (deltaMap) {
      const result = await deductRawMaterials(db, deltaMap, {
        direction: -1,
        changeType: 'order_deduction',
        performedBy,
        reason: item.item_name || item.name || null,
        referenceId: orderId,
      });
      deducted.push(...result.deducted.map((d) => ({ ...d, sold: d.amount })));
      warnings.push(...result.warnings);
      continue;
    }

    const { row, warning } = await resolveInventoryItem(db, item);
    if (warning) warnings.push(warning);
    if (!row) continue;

    const applied = await applyStockChange(db, {
      inventory_item_id: row.id,
      quantity: -qty,
      change_type: 'order_deduction',
      performed_by: performedBy,
      reason: row.item_name || row.name,
      reference_id: orderId,
    });
    if (!applied) continue;

    deducted.push({ ...applied, sold: qty });
    if (applied.warning) warnings.push(applied.warning);

    const min = Number(row.min_stock_level ?? row.min_stock ?? 0);
    if (applied.to <= 0 && !applied.warning) {
      warnings.push(`${applied.name} is now out of stock.`);
    } else if (min > 0 && applied.to > 0 && applied.to <= min) {
      warnings.push(`${applied.name} is running low (${applied.to} ${row.unit || 'left'}).`);
    }
  }

  return { deducted, warnings };
}

/**
 * Restore inventory when items are voided/cancelled.
 */
export async function restoreStockForItems(db, items = [], context = {}) {
  await ensureInventoryLinkColumn(db);
  const { performedBy, reason = 'Order item voided', orderId = null } = context;
  const restored = [];
  const warnings = [];

  for (const item of items) {
    const qty = Number(item.quantity || 0);
    if (qty <= 0) continue;

    const menuId = item.menu_item_id || item.item_id || item.id || null;

    const variantLink = await resolveVariantStockLink(db, menuId, item.variant_name);
    if (variantLink) {
      const applied = await applyStockChange(db, {
        inventory_item_id: variantLink.row.id,
        quantity: variantLink.perUnit * qty,
        change_type: 'order_void',
        performed_by: performedBy,
        reason,
        reference_id: orderId,
      });
      if (applied) restored.push({ ...applied, restored: variantLink.perUnit * qty });
      continue;
    }

    // Mirrors the deduction: an empty recipe is not a recipe, so the direct
    // link gets the stock back rather than the restore silently doing nothing.
    const deltaMap = await explodeRecipeFor(db, menuId, qty);

    if (deltaMap) {
      const result = await deductRawMaterials(db, deltaMap, {
        direction: 1,
        changeType: 'order_void',
        performedBy,
        reason,
        referenceId: orderId,
      });
      restored.push(...result.deducted.map((d) => ({ ...d, restored: d.amount })));
      continue;
    }

    const { row, warning } = await resolveInventoryItem(db, item);
    if (warning) warnings.push(warning);
    if (!row) continue;

    const applied = await applyStockChange(db, {
      inventory_item_id: row.id,
      quantity: qty,
      change_type: 'order_void',
      performed_by: performedBy,
      reason,
      reference_id: orderId,
    });
    if (applied) restored.push({ ...applied, restored: qty });
  }

  return { restored, warnings };
}

/**
 * Build the display snapshot for one inventory row.
 *
 * `perUnit` is the amount a single sale draws down (a variant's
 * stock_quantity — 60ml out of a 750ml bottle). When set, `servings` is how
 * many more of that variant can still be poured; when null the inventory unit
 * IS the sellable unit (a pack of cigarettes, a canned drink) and the raw
 * quantity is the count.
 *
 * `min_stock_level` stays in the inventory unit, so the low check compares
 * against `quantity` in both cases.
 */
function stockSnapshot(row, perUnit = null) {
  const quantity = Number(row.quantity || 0);
  const min = Number(row.min_stock_level ?? row.min_stock ?? 0);
  const per = Number(perUnit);
  const hasPer = Number.isFinite(per) && per > 0;
  const servings = hasPer ? Math.floor(quantity / per) : null;
  const sellable = servings == null ? quantity : servings;
  return {
    inventory_item_id: Number(row.id),
    item_name: row.item_name || row.name || null,
    quantity,
    unit: row.consumption_unit || row.unit || '',
    min_stock_level: min,
    per_unit: hasPer ? per : null,
    servings,
    status: sellable <= 0 ? 'out' : min > 0 && quantity <= min ? 'low' : 'ok',
  };
}

/**
 * Attach live stock counts to menu items that draw inventory down directly —
 * cigarettes, bottled drinks, spirits poured by the peg. Mutates and returns
 * the same array.
 *
 * Recipe-backed dishes are deliberately skipped: their "stock" is a dozen raw
 * materials, not a number a cashier can act on.
 *
 * The precedence mirrors deductStockForItems() so the badge never disagrees
 * with what the sale actually deducts: a variant's own inventory link wins
 * over the menu item's direct link. A card-level badge is only produced when
 * every linked variant pours from the same inventory row (the usual case —
 * one bottle, several pour sizes); when they differ, only the per-variant
 * numbers in the picker are meaningful.
 *
 * @param {object} db - PosDatabase instance
 * @param {Array<object>} products - menu rows carrying `inventory_item_id` and `variants`
 */
export async function attachStockLevels(db, products = []) {
  const ids = new Set();
  for (const product of products) {
    if (product.inventory_item_id) ids.add(Number(product.inventory_item_id));
    for (const variant of product.variants || []) {
      if (variant.inventory_item_id) ids.add(Number(variant.inventory_item_id));
    }
  }

  const byId = new Map();
  if (ids.size) {
    // Archived rows must not be reported as sellable, and the column is
    // ensured-on-demand elsewhere — so make sure it exists before filtering.
    try {
      await ensureColumn(db, 'inventory_items', 'is_archived', 'INTEGER DEFAULT 0');
    } catch {
      /* ignore — already exists */
    }
    const list = [...ids];
    const placeholders = list.map(() => '?').join(',');
    // SELECT * on purpose: consumption_unit/min_stock are ensured-on-demand
    // columns that may not exist yet on an older database.
    const rows = await db.all(
      `SELECT * FROM inventory_items
        WHERE id IN (${placeholders}) AND COALESCE(is_archived, 0) = 0`,
      list
    );
    for (const row of rows) byId.set(Number(row.id), row);
  }

  for (const product of products) {
    const variants = product.variants || [];
    const variantRows = new Set();
    for (const variant of variants) {
      const row = variant.inventory_item_id ? byId.get(Number(variant.inventory_item_id)) : null;
      variant.stock = row ? stockSnapshot(row, variant.stock_quantity) : null;
      if (row) variantRows.add(Number(row.id));
    }
    // The shared bottle only speaks for the card when *every* option pours
    // from it. If some options carry no link of their own they deduct through
    // the menu item's direct link, so that is what the card must report — and
    // what those options fall back to.
    const allLinked = variants.length > 0 && variants.every((v) => v.stock);
    const shared = allLinked && variantRows.size === 1 ? byId.get([...variantRows][0]) : null;
    const direct = product.inventory_item_id ? byId.get(Number(product.inventory_item_id)) : null;
    const row = shared || direct;
    product.stock = row ? stockSnapshot(row) : null;
  }

  return products;
}

/** Ensure common beverage SKUs exist and link to menu items. */
export async function ensureBeverageInventory(db) {
  await ensureInventoryLinkColumn(db);
  const beverages = [
    { menuName: 'Coke', invName: 'Coke Cans', qty: 48, unit: 'pcs', cost: 40 },
    { menuName: 'Masala Tea', invName: 'Masala Tea Cups', qty: 100, unit: 'pcs', cost: 15 },
    { menuName: 'Coffee', invName: 'Coffee Cups', qty: 80, unit: 'pcs', cost: 25 },
    { menuName: 'Cold Coffee', invName: 'Cold Coffee Cups', qty: 60, unit: 'pcs', cost: 35 },
    { menuName: 'Lassi Sweet', invName: 'Lassi Glasses', qty: 40, unit: 'pcs', cost: 30 },
    { menuName: 'Fresh Lemonade', invName: 'Lemonade Glasses', qty: 50, unit: 'pcs', cost: 20 },
  ];

  for (const b of beverages) {
    const menu = await db.get(`SELECT id FROM menu_items WHERE lower(name) = lower(?) LIMIT 1`, [b.menuName]);
    let inv = await db.get(
      `SELECT * FROM inventory_items WHERE lower(item_name) = lower(?) LIMIT 1`,
      [b.invName]
    );
    if (!inv) {
      // also try fuzzy existing (e.g. Coke Cans already seeded)
      const all = await db.all(`SELECT * FROM inventory_items`);
      inv = all.find((r) => normalize(r.item_name).includes(normalize(b.menuName))) || null;
    }
    if (!inv) {
      try {
        // Created empty, then stocked through the ledger so the opening
        // balance lands in stock_movements like every other change.
        const r = await db.run(
          `INSERT INTO inventory_items
            (item_name, quantity, unit, cost_per_unit, selling_price, min_stock_level, supplier, notes, menu_item_id, created_at, updated_at)
           VALUES (?, 0, ?, ?, NULL, ?, ?, 'Auto beverage stock', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [b.invName, b.unit, b.cost, Math.max(6, Math.floor(b.qty / 4)), 'Beverage Co', menu?.id || null]
        );
        inv = { id: r.lastInsertRowid };
        await applyStockChange(db, {
          inventory_item_id: inv.id,
          quantity: b.qty,
          change_type: 'opening_balance',
          unit_cost: b.cost,
          reason: 'Auto beverage stock',
        });
      } catch (e) {
        console.warn('ensureBeverageInventory insert:', e.message);
      }
    } else if (menu?.id) {
      try {
        await db.run(`UPDATE inventory_items SET menu_item_id = ? WHERE id = ?`, [menu.id, inv.id]);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * The container words a stock SKU adds to the drink it holds. This function
 * exists to link bought-in items sold as they are — a can, a bottle, a cup —
 * and ensureBeverageInventory() above creates exactly that shape:
 * "Coke Cans", "Masala Tea Cups", "Lassi Glasses".
 */
const PACKAGING_WORDS = new Set([
  'can', 'cans', 'bottle', 'bottles', 'cup', 'cups', 'glass', 'glasses',
  'pack', 'packs', 'packet', 'packets', 'box', 'boxes', 'tin', 'tins',
  'piece', 'pieces', 'pcs', 'unit', 'units', 'sachet', 'sachets',
]);

/**
 * A menu item and a stock row name the same thing only if their names are
 * equal, or the stock row is the menu name plus container words.
 *
 * A link written here is trusted afterwards with no further check —
 * resolveInventoryItem() returns it immediately and deductStockForItems()
 * deducts one unit of it per unit sold — so this has to be the strictest test
 * in the chain, not the loosest.
 *
 * Two rules were tried and rejected:
 *
 *   `n.includes(h.split(' ')[0])`, the original, matched on the stock item's
 *   FIRST WORD alone. Since the auto-link runs on every order it quietly bound
 *   unrelated pairs: "W18 Paneer" to "W18 Cold Drink" on the shared token
 *   "W18", after which 20 cold drinks deducted 20 kg of paneer. In a real
 *   kitchen the shared token is a word like "Chicken".
 *
 *   Containment plus a length ratio still let dish-versus-ingredient pairs
 *   through: "Mutton" and "Mutton Tas", "Mushroom" and "Mushroom Soup". One is
 *   a raw material, the other a dish made from it, and selling one plate would
 *   have deducted one kilogram.
 */
function namesReferToSameItem(menuName, inventoryName) {
  const menuWords = normalize(menuName).split(' ').filter(Boolean);
  const invWords = normalize(inventoryName).split(' ').filter(Boolean);
  if (!menuWords.length || !invWords.length) return false;
  if (invWords.length < menuWords.length) return false;
  for (let i = 0; i < menuWords.length; i += 1) {
    if (menuWords[i] !== invWords[i]) return false;
  }
  // Whatever the stock row adds must only describe the container.
  return invWords.slice(menuWords.length).every((w) => PACKAGING_WORDS.has(w));
}

/**
 * Best-effort link of beverage menu items to their stock SKU by name.
 *
 * Only an unambiguous match is written. If a menu item near-matches more than
 * one inventory row — or an inventory row near-matches more than one menu item
 * — nothing is linked, because guessing between them is how the wrong item
 * gets drained. An explicit link made in Products is never overwritten.
 */
export async function autoLinkBeverageStock(db) {
  try {
    await ensureBeverageInventory(db);
  } catch (e) {
    console.warn('ensureBeverageInventory:', e?.message || e);
    return;
  }
  try {
    const menu = await db.all(`SELECT id, name FROM menu_items`);
    const inv = await db.all(`SELECT id, item_name, menu_item_id FROM inventory_items`);
    const unlinked = inv.filter((row) => !row.menu_item_id);

    for (const row of unlinked) {
      const candidates = menu.filter((m) => namesReferToSameItem(m.name, row.item_name));
      if (candidates.length !== 1) continue;
      const m = candidates[0];
      // The menu item must resolve back to this row and no other, or the link
      // would be a coin toss between two stock items.
      const reverse = unlinked.filter((r) => namesReferToSameItem(m.name, r.item_name));
      if (reverse.length !== 1) continue;
      await db.run(`UPDATE inventory_items SET menu_item_id = ? WHERE id = ?`, [m.id, row.id]);
      row.menu_item_id = m.id;
    }
  } catch (e) {
    console.warn('autoLinkBeverageStock:', e.message);
  }
}

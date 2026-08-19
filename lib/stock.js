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

    const recipe = await getRecipeByMenuItemId(db, menuId);

    if (recipe) {
      const deltaMap = await explodeRecipe(db, recipe.id, qty);
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

    const recipe = await getRecipeByMenuItemId(db, menuId);

    if (recipe) {
      const deltaMap = await explodeRecipe(db, recipe.id, qty);
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
 * Two names refer to the same thing only if one contains the other and they
 * are close in length — "Coke" and "Coke Cans" do; "Chicken Momo" and
 * "Chicken Breast" do not.
 *
 * This is the same rule resolveInventoryItem() uses for an unlinked sale, and
 * it has to be: a link written here is trusted afterwards without any further
 * check, so a loose rule here defeats the strict one there.
 *
 * The rule this replaced also accepted `n.includes(h.split(' ')[0])` — a match
 * on the inventory item's FIRST WORD alone. Because the auto-link runs on
 * every order, that quietly bound unrelated pairs together: an inventory item
 * "W18 Paneer" was linked to a menu item "W18 Cold Drink" on the shared token
 * "W18", after which selling 20 cold drinks deducted 20 kg of paneer. In a
 * real kitchen the shared token is a word like "Chicken", and the wrong raw
 * material is drained silently, corrupting both stock and food cost.
 */
function namesReferToSameItem(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return false;
  if (!x.includes(y) && !y.includes(x)) return false;
  const short = Math.min(x.length, y.length);
  const long = Math.max(x.length, y.length);
  return short / long >= 0.6;
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

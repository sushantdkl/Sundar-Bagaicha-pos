/**
 * deploy/production_seed.sql writes a stub recipe for every menu item — one
 * row in `recipes` with `prep_notes = '__dsp_seed__'` and no `recipe_items`.
 * deductStockForItems() used to take the recipe branch on sight of that row,
 * explode it to an empty map, and `continue`, so every directly stocked item
 * (a Coke can, a cigarette pack, a beer bottle) sold without its count ever
 * moving. These tests pin the fall-through that fixes it, and pin that a real
 * recipe still wins.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PosDatabase } from '../../lib/db/index.js';
import { deductStockForItems, restoreStockForItems } from '../../lib/stock.js';
import { ensureRecipeTables } from '../../lib/recipes.js';
import { ensureMenuVariantsSchema } from '../../lib/menu-variants.js';

const dbPath = path.join(os.tmpdir(), `stock-deduction-${process.pid}-${Date.now()}.db`);
const db = new PosDatabase(dbPath);

test.after(() => {
  try { db.close(); } catch { /* already closed */ }
  try { fs.rmSync(dbPath, { force: true }); } catch { /* ignore */ }
});

let categoryId = null;
const ensureCategory = async () => {
  if (categoryId) return categoryId;
  const existing = await db.get('SELECT id FROM menu_categories ORDER BY id LIMIT 1');
  categoryId = existing ? existing.id : (await db.run('INSERT INTO menu_categories (name) VALUES (?)', ['Test'])).lastInsertRowid;
  return categoryId;
};

const menuItem = async (name) => {
  const r = await db.run(
    'INSERT INTO menu_items (name, category_id, base_price, is_available) VALUES (?, ?, 100, 1)',
    [name, await ensureCategory()]
  );
  return r.lastInsertRowid;
};

const stockItem = async (name, quantity, unit = 'pcs', menuId = null) => {
  const r = await db.run(
    'INSERT INTO inventory_items (item_name, quantity, unit, cost_per_unit, menu_item_id) VALUES (?, ?, ?, 40, ?)',
    [name, quantity, unit, menuId]
  );
  return r.lastInsertRowid;
};

/** The seed's stub: a recipe row with no lines under it. */
const stubRecipe = async (menuId, name) => {
  await ensureRecipeTables(db);
  const r = await db.run(
    `INSERT INTO recipes (name, type, menu_item_id, yield_quantity, yield_unit, prep_notes)
     VALUES (?, 'menu_item', ?, 1, 'plate', '__dsp_seed__')`,
    [name, menuId]
  );
  return r.lastInsertRowid;
};

const quantityOf = async (id) => Number((await db.get('SELECT quantity FROM inventory_items WHERE id = ?', [id])).quantity);
const movementsFor = async (id) => db.all(
  `SELECT change_type, quantity_changed FROM stock_movements WHERE inventory_item_id = ? ORDER BY id`,
  [id]
);

test('an empty seed recipe does not swallow the deduction of a linked item', async () => {
  const menuId = await menuItem('Coke / Fanta / Sprite');
  const cans = await stockItem('Coke Cans', 48, 'pcs', menuId);
  await stubRecipe(menuId, 'Coke / Fanta / Sprite');

  const { deducted, warnings } = await deductStockForItems(
    db,
    [{ menu_item_id: menuId, item_name: 'Coke / Fanta / Sprite', quantity: 2 }],
    { orderId: 1 }
  );

  assert.equal(await quantityOf(cans), 46, '48 cans less the 2 that were sold');
  assert.equal(deducted.length, 1);
  assert.equal(deducted[0].inventory_item_id, cans);
  assert.deepEqual(warnings, []);
  assert.deepEqual(await movementsFor(cans), [{ change_type: 'order_deduction', quantity_changed: -2 }]);
});

test('the matching restore puts the linked stock back', async () => {
  const menuId = await menuItem('Surya Cigarette');
  const packs = await stockItem('Surya Packs', 10, 'pcs', menuId);
  await stubRecipe(menuId, 'Surya Cigarette');

  await deductStockForItems(db, [{ menu_item_id: menuId, item_name: 'Surya Cigarette', quantity: 3 }], { orderId: 2 });
  assert.equal(await quantityOf(packs), 7);

  await restoreStockForItems(db, [{ menu_item_id: menuId, item_name: 'Surya Cigarette', quantity: 3 }], { orderId: 2 });
  assert.equal(await quantityOf(packs), 10, 'a voided line must not leave the count short');
});

test('a recipe with real ingredients still wins over the direct link', async () => {
  const menuId = await menuItem('Chicken Momo');
  // A same-named row exists, but the recipe is what the dish actually consumes.
  const decoy = await stockItem('Chicken Momo', 100, 'pcs', menuId);
  const flour = await stockItem('Flour', 5000, 'g');
  const chicken = await stockItem('Chicken Mince', 4000, 'g');

  const recipeId = await stubRecipe(menuId, 'Chicken Momo');
  await db.run('INSERT INTO recipe_items (recipe_id, raw_material_id, quantity, unit) VALUES (?, ?, ?, ?)', [recipeId, flour, 100, 'g']);
  await db.run('INSERT INTO recipe_items (recipe_id, raw_material_id, quantity, unit) VALUES (?, ?, ?, ?)', [recipeId, chicken, 80, 'g']);

  await deductStockForItems(db, [{ menu_item_id: menuId, item_name: 'Chicken Momo', quantity: 2 }], { orderId: 3 });

  assert.equal(await quantityOf(flour), 4800);
  assert.equal(await quantityOf(chicken), 3840);
  assert.equal(await quantityOf(decoy), 100, 'the recipe consumed raw materials, so the decoy row is untouched');
});

test('an item with an empty recipe and no inventory link is still a no-op', async () => {
  const menuId = await menuItem('Service Charge Placeholder');
  await stubRecipe(menuId, 'Service Charge Placeholder');

  const { deducted, warnings } = await deductStockForItems(
    db,
    [{ menu_item_id: menuId, item_name: 'Service Charge Placeholder', quantity: 1 }],
    { orderId: 4 }
  );

  assert.deepEqual(deducted, []);
  assert.deepEqual(warnings, []);
});

test('a variant link still outranks both the recipe and the direct link', async () => {
  const menuId = await menuItem('Old Durbar');
  const wrong = await stockItem('Old Durbar Bottles', 20, 'pcs', menuId);
  const bottle = await stockItem('Old Durbar 750ml', 750, 'ml');
  await stubRecipe(menuId, 'Old Durbar');
  await ensureMenuVariantsSchema(db);
  await db.run(
    `INSERT INTO menu_item_variants (menu_item_id, variant_name, price, stock_quantity, inventory_item_id, is_default)
     VALUES (?, '60ml', 400, 60, ?, 1)`,
    [menuId, bottle]
  );

  await deductStockForItems(db, [{ menu_item_id: menuId, item_name: 'Old Durbar (60ml)', variant_name: '60ml', quantity: 2 }], { orderId: 5 });

  assert.equal(await quantityOf(bottle), 630, 'two 60ml pegs out of a 750ml bottle');
  assert.equal(await quantityOf(wrong), 20);
});

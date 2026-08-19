/**
 * The beverage auto-link runs on every order, and a link it writes is trusted
 * afterwards without further checking — deductStockForItems() deducts straight
 * from the linked row. A loose rule here therefore drains the wrong raw
 * material silently, so these tests pin the boundary.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PosDatabase } from '../../lib/db/index.js';
import { autoLinkBeverageStock } from '../../lib/stock.js';

const dbPath = path.join(os.tmpdir(), `stock-auto-link-${process.pid}-${Date.now()}.db`);
const db = new PosDatabase(dbPath);

test.after(() => {
  try { db.close(); } catch { /* already closed */ }
  try { fs.rmSync(dbPath, { force: true }); } catch { /* ignore */ }
});

let categoryId = null;
const ensureCategory = async () => {
  if (categoryId) return categoryId;
  const existing = await db.get('SELECT id FROM menu_categories ORDER BY id LIMIT 1');
  if (existing) { categoryId = existing.id; return categoryId; }
  const r = await db.run('INSERT INTO menu_categories (name) VALUES (?)', ['Test']);
  categoryId = r.lastInsertRowid;
  return categoryId;
};
const menuId = async (name) => {
  const r = await db.run(
    'INSERT INTO menu_items (name, category_id, base_price, is_available) VALUES (?, ?, 100, 1)',
    [name, await ensureCategory()]
  );
  return r.lastInsertRowid;
};
const invId = async (name) => {
  const r = await db.run(
    'INSERT INTO inventory_items (item_name, quantity, unit, cost_per_unit) VALUES (?, 100, ?, 50)',
    [name, 'kg']
  );
  return r.lastInsertRowid;
};
const linkOf = async (id) => (await db.get('SELECT menu_item_id FROM inventory_items WHERE id = ?', [id]))?.menu_item_id ?? null;

test('a menu item is linked to the stock SKU that means the same thing', async () => {
  const drink = await menuId('Zephyr Cola');
  const cans = await invId('Zephyr Cola Cans');
  await autoLinkBeverageStock(db);
  assert.equal(await linkOf(cans), drink, 'Zephyr Cola should link to Zephyr Cola Cans');
});

test('a dish is never linked to the raw material it is made from', async () => {
  // "Mutton" and "Mutton Tas" pass any containment-plus-length test, but one
  // is a raw material and the other a dish. Selling one plate would have
  // deducted one kilogram.
  const dish = await menuId('Sorrel Tas');
  const raw = await invId('Sorrel');
  await autoLinkBeverageStock(db);
  assert.equal(await linkOf(raw), null, 'Sorrel Tas must not be linked to Sorrel');
  assert.notEqual(dish, null);
});

test('a stock row that only adds a container word is a match', async () => {
  const drink = await menuId('Thistle Soda');
  const bottles = await invId('Thistle Soda Bottles');
  await autoLinkBeverageStock(db);
  assert.equal(await linkOf(bottles), drink, 'Thistle Soda should link to Thistle Soda Bottles');
});

test('sharing a first word is not a match', async () => {
  // The rule this replaced accepted a match on the inventory item's first word
  // alone, which linked "Chicken Breast" to every menu item containing
  // "chicken" — selling 20 Chicken Momo then deducted 20 kg of breast.
  const momo = await menuId('Chicken Momo');
  const breast = await invId('Chicken Breast');
  await autoLinkBeverageStock(db);
  assert.equal(await linkOf(breast), null, 'Chicken Momo must not be linked to Chicken Breast');
  assert.notEqual(momo, null);
});

test('an unrelated drink is not linked to a raw material that shares a prefix', async () => {
  const drink = await menuId('W18 Cold Drink');
  const paneer = await invId('W18 Paneer');
  await autoLinkBeverageStock(db);
  assert.equal(await linkOf(paneer), null, 'a shared "W18" prefix is not a match');
  assert.notEqual(drink, null);
});

test('an ambiguous name links nothing rather than guessing', async () => {
  await menuId('Quill Juice');
  const a = await invId('Quill Juice A');
  const b = await invId('Quill Juice B');
  await autoLinkBeverageStock(db);
  assert.equal(await linkOf(a), null, 'two equally good stock rows means no link');
  assert.equal(await linkOf(b), null, 'two equally good stock rows means no link');
});

test('an explicit link made in Products is never overwritten', async () => {
  const tea = await menuId('Yarrow Tea');
  const cups = await invId('Yarrow Tea Cups');
  const other = await menuId('Something Else Entirely');
  await db.run('UPDATE inventory_items SET menu_item_id = ? WHERE id = ?', [other, cups]);
  await autoLinkBeverageStock(db);
  assert.equal(await linkOf(cups), other, 'a deliberate link stands');
  assert.notEqual(tea, null);
});

/**
 * The POS grid shows these numbers to a cashier who is about to promise an
 * item to a guest, so a badge that disagrees with what the sale actually
 * deducts is worse than no badge at all. These tests pin attachStockLevels()
 * to the same resolution order deductStockForItems() uses: a variant's own
 * inventory link first, the menu item's direct link second, and nothing at
 * all for recipe-backed dishes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PosDatabase } from '../../lib/db/index.js';
import { attachStockLevels } from '../../lib/stock.js';

const dbPath = path.join(os.tmpdir(), `stock-levels-${process.pid}-${Date.now()}.db`);
const db = new PosDatabase(dbPath);

test.after(() => {
  try { db.close(); } catch { /* already closed */ }
  try { fs.rmSync(dbPath, { force: true }); } catch { /* ignore */ }
});

const inventory = async ({ name, quantity, unit = 'pcs', min = 0 }) => {
  const r = await db.run(
    `INSERT INTO inventory_items (item_name, quantity, unit, cost_per_unit, min_stock_level)
     VALUES (?, ?, ?, 50, ?)`,
    [name, quantity, unit, min]
  );
  return r.lastInsertRowid;
};

test('a directly linked item reports its inventory count in its own unit', async () => {
  const id = await inventory({ name: 'Surya Cigarette Pack', quantity: 12, unit: 'pcs' });
  const [product] = await attachStockLevels(db, [
    { id: 1, name: 'Surya', inventory_item_id: id, variants: [] },
  ]);

  assert.equal(product.stock.quantity, 12);
  assert.equal(product.stock.unit, 'pcs');
  assert.equal(product.stock.servings, null, 'the inventory unit is already the sellable unit');
  assert.equal(product.stock.per_unit, null);
  assert.equal(product.stock.status, 'ok');
});

test('a peg variant reports pours left, not millilitres left', async () => {
  const bottle = await inventory({ name: 'Old Durbar 750ml', quantity: 750, unit: 'ml' });
  const [product] = await attachStockLevels(db, [
    {
      id: 2,
      name: 'Old Durbar',
      inventory_item_id: null,
      variants: [
        { id: 21, variant_name: '30ml', inventory_item_id: bottle, stock_quantity: 30 },
        { id: 22, variant_name: '60ml', inventory_item_id: bottle, stock_quantity: 60 },
      ],
    },
  ]);

  const [small, large] = product.variants;
  assert.equal(small.stock.servings, 25);
  assert.equal(small.stock.per_unit, 30);
  assert.equal(large.stock.servings, 12, 'a partial pour is not a pour — 750/60 rounds down');
  assert.equal(large.stock.quantity, 750, 'the raw bottle level stays available for the label');

  // Every variant pours from the same bottle, so the card can speak for it.
  assert.equal(product.stock.quantity, 750);
  assert.equal(product.stock.unit, 'ml');
  assert.equal(product.stock.servings, null);
});

test('variants drawing on different rows leave the card badge off', async () => {
  const beer = await inventory({ name: 'Gorkha Bottle', quantity: 40, unit: 'pcs' });
  const can = await inventory({ name: 'Gorkha Can', quantity: 8, unit: 'pcs' });
  const [product] = await attachStockLevels(db, [
    {
      id: 3,
      name: 'Gorkha',
      inventory_item_id: null,
      variants: [
        { id: 31, variant_name: 'Bottle', inventory_item_id: beer, stock_quantity: 1 },
        { id: 32, variant_name: 'Can', inventory_item_id: can, stock_quantity: 1 },
      ],
    },
  ]);

  assert.equal(product.stock, null, 'one number cannot honestly stand for two rows');
  assert.equal(product.variants[0].stock.servings, 40);
  assert.equal(product.variants[1].stock.servings, 8);
});

test('a variant link beats the menu item link, exactly as the deduction does', async () => {
  const direct = await inventory({ name: 'Wrong Row', quantity: 999, unit: 'pcs' });
  const poured = await inventory({ name: 'Right Row', quantity: 100, unit: 'ml' });
  const [product] = await attachStockLevels(db, [
    {
      id: 4,
      name: 'Rum',
      inventory_item_id: direct,
      variants: [{ id: 41, variant_name: '50ml', inventory_item_id: poured, stock_quantity: 50 }],
    },
  ]);

  assert.equal(product.stock.inventory_item_id, poured);
  assert.equal(product.variants[0].stock.servings, 2);
});

test('unlinked options report the menu item’s own shelf, which is what they deduct', async () => {
  // The real shape of "Ice Cream" and "Real Juice": flavour/size options that
  // carry no stock of their own, sitting on one linked tub.
  const tub = await inventory({ name: 'Ice Cream Tub', quantity: 3, unit: 'l' });
  const [product] = await attachStockLevels(db, [
    {
      id: 10,
      name: 'Ice Cream',
      inventory_item_id: tub,
      variants: [
        { id: 101, variant_name: 'Vanilla', inventory_item_id: null, stock_quantity: null },
        { id: 102, variant_name: 'Chocolate', inventory_item_id: null, stock_quantity: null },
      ],
    },
  ]);

  assert.equal(product.stock.inventory_item_id, tub, 'the direct link is what every flavour draws on');
  assert.equal(product.stock.quantity, 3);
  assert.equal(product.variants[0].stock, null, 'the option itself holds no separate stock');
});

test('a half-linked variant set reports the direct link, not the one linked option', async () => {
  const direct = await inventory({ name: 'House Pour', quantity: 12, unit: 'pcs' });
  const special = await inventory({ name: 'Reserve Bottle', quantity: 700, unit: 'ml' });
  const [product] = await attachStockLevels(db, [
    {
      id: 11,
      name: 'Whisky',
      inventory_item_id: direct,
      variants: [
        { id: 111, variant_name: 'Peg', inventory_item_id: special, stock_quantity: 60 },
        { id: 112, variant_name: 'Glass', inventory_item_id: null, stock_quantity: null },
      ],
    },
  ]);

  assert.equal(
    product.stock.inventory_item_id,
    direct,
    'one option pours from its own bottle, so that bottle cannot speak for the card'
  );
  assert.equal(product.variants[0].stock.inventory_item_id, special);
  assert.equal(product.variants[1].stock, null);
});

test('a dish with no inventory link gets no badge at all', async () => {
  const [product] = await attachStockLevels(db, [
    { id: 5, name: 'Chicken Momo', inventory_item_id: null, variants: [] },
  ]);
  assert.equal(product.stock, null);
});

test('low and out are read off the minimum level and the sellable count', async () => {
  const low = await inventory({ name: 'Coke Cans', quantity: 4, unit: 'pcs', min: 5 });
  const empty = await inventory({ name: 'Fanta Cans', quantity: 0, unit: 'pcs' });
  const dregs = await inventory({ name: 'Whisky Dregs', quantity: 20, unit: 'ml' });

  const products = await attachStockLevels(db, [
    { id: 6, name: 'Coke', inventory_item_id: low, variants: [] },
    { id: 7, name: 'Fanta', inventory_item_id: empty, variants: [] },
    {
      id: 8,
      name: 'Whisky',
      inventory_item_id: null,
      variants: [{ id: 81, variant_name: '30ml', inventory_item_id: dregs, stock_quantity: 30 }],
    },
  ]);

  assert.equal(products[0].stock.status, 'low');
  assert.equal(products[1].stock.status, 'out');
  assert.equal(
    products[2].variants[0].stock.status,
    'out',
    '20ml left cannot fill a 30ml peg, so the option is out even though the row is not'
  );
});

test('an archived inventory row reads as no stock link', async () => {
  const id = await inventory({ name: 'Discontinued Soda', quantity: 30, unit: 'pcs' });
  await db.run('UPDATE inventory_items SET is_archived = 1 WHERE id = ?', [id]);

  const [product] = await attachStockLevels(db, [
    { id: 9, name: 'Discontinued Soda', inventory_item_id: id, variants: [] },
  ]);
  assert.equal(product.stock, null);
});

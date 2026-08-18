import { ensureColumn } from '@/lib/db/schema-helpers.js';

let ENSURED = false;

export async function ensureMenuVariantsSchema(db) {
  if (ENSURED) return;
  await ensureColumn(db, 'menu_item_variants', 'price', 'REAL');
  await ensureColumn(db, 'menu_item_variants', 'stock_quantity', 'REAL');
  await ensureColumn(db, 'menu_item_variants', 'stock_unit', 'TEXT');
  await ensureColumn(db, 'menu_item_variants', 'inventory_item_id', 'INTEGER');
  await ensureColumn(db, 'menu_items', 'unit', 'TEXT');
  await ensureColumn(db, 'menu_items', 'cost', 'NUMERIC(14,2)');
  ENSURED = true;
}

export async function getVariantsByMenuItemIds(db, menuItemIds) {
  if (!menuItemIds.length) return new Map();
  const placeholders = menuItemIds.map(() => '?').join(',');
  const rows = await db.all(
    `SELECT * FROM menu_item_variants WHERE menu_item_id IN (${placeholders}) ORDER BY is_default DESC, id`,
    menuItemIds
  );
  const byItem = new Map();
  for (const row of rows) {
    const list = byItem.get(row.menu_item_id) || [];
    list.push(row);
    byItem.set(row.menu_item_id, list);
  }
  return byItem;
}

// Replaces the full variant set for a menu item (delete + reinsert — the form
// always submits the complete list, there's no partial-edit case).
export async function replaceVariants(db, menuItemId, variants) {
  await db.run('DELETE FROM menu_item_variants WHERE menu_item_id = ?', [menuItemId]);
  const clean = (variants || [])
    .map((v) => ({
      variant_name: String(v.variant_name || '').trim(),
      price: Number(v.price),
      stock_quantity: v.stock_quantity === '' || v.stock_quantity == null ? null : Number(v.stock_quantity),
      stock_unit: v.stock_unit || null,
      inventory_item_id: v.inventory_item_id ? Number(v.inventory_item_id) : null,
      is_default: !!v.is_default,
    }))
    .filter((v) => v.variant_name && Number.isFinite(v.price) && v.price >= 0);

  if (!clean.length) return [];

  if (!clean.some((v) => v.is_default)) clean[0].is_default = true;

  for (const v of clean) {
    await db.run(
      `INSERT INTO menu_item_variants (menu_item_id, variant_name, price, stock_quantity, stock_unit, inventory_item_id, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [menuItemId, v.variant_name, v.price, v.stock_quantity, v.stock_unit, v.inventory_item_id, v.is_default ? 1 : 0]
    );
  }
  return clean;
}

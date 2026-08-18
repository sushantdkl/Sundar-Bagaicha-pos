import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureMenuVariantsSchema, getVariantsByMenuItemIds, replaceVariants } from '@/lib/menu-variants.js';

async function syncInventoryLink(db, menuItemId, inventoryItemId) {
  const inventoryId = inventoryItemId === '' || inventoryItemId == null ? null : Number(inventoryItemId);
  if (inventoryId != null && (!Number.isInteger(inventoryId) || inventoryId <= 0)) {
    throw Object.assign(new Error('Choose a valid inventory item to link.'), { status: 400 });
  }
  if (inventoryId != null) {
    const inventory = await db.get('SELECT id, item_name, menu_item_id FROM inventory_items WHERE id = ?', [inventoryId]);
    if (!inventory) throw Object.assign(new Error('The selected inventory item no longer exists.'), { status: 400 });
    if (inventory.menu_item_id && Number(inventory.menu_item_id) !== Number(menuItemId)) {
      throw Object.assign(new Error(`Inventory item "${inventory.item_name}" is already linked to another menu item.`), { status: 409 });
    }
  }
  await db.run('UPDATE inventory_items SET menu_item_id = NULL WHERE menu_item_id = ?', [menuItemId]);
  if (inventoryId != null) await db.run('UPDATE inventory_items SET menu_item_id = ? WHERE id = ?', [menuItemId, inventoryId]);
}

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'] });
    if (auth.error) return auth.error;

    const db = Database.getInstance();
    await ensureMenuVariantsSchema(db);

    const products = await db.all(`
      SELECT
        mi.*,
        mi.base_price as price,
        mc.name as category_name,
        (SELECT i.id FROM inventory_items i WHERE i.menu_item_id = mi.id AND COALESCE(i.is_archived, 0) = 0 LIMIT 1) AS inventory_item_id
      FROM menu_items mi
      LEFT JOIN menu_categories mc ON mi.category_id = mc.id
      ORDER BY mi.name
    `);

    const variantsByItem = await getVariantsByMenuItemIds(db, products.map((p) => p.id));
    for (const product of products) product.variants = variantsByItem.get(product.id) || [];

    return NextResponse.json({ products });
  } catch (error) {
    return handleRouteError(error, 'Could not load the menu. Please try again.');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;

    const data = await request.json();
    const db = Database.getInstance();
    await ensureMenuVariantsSchema(db);

    const hasVariants = Array.isArray(data.variants) && data.variants.length > 0;
    const price = data.price || data.base_price || 0;

    const result = await db.run(`
      INSERT INTO menu_items (
        name, category_id, base_price, description, image_url,
        is_available, is_vegetarian, preparation_time, unit, cost
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      data.name,
      data.category_id || 1,
      price,
      data.description || null,
      data.image_url || null,
      data.is_available ? 1 : 0,
      data.is_vegetarian ? 1 : 0,
      data.preparation_time || 15,
      data.unit || null,
      data.cost === '' || data.cost == null ? null : Number(data.cost),
    ]);

    const menuItemId = result.lastInsertRowid;

    let variants = [];
    if (hasVariants) {
      variants = await replaceVariants(db, menuItemId, data.variants);
      const defaultVariant = variants.find((v) => v.is_default) || variants[0];
      if (defaultVariant) await db.run('UPDATE menu_items SET base_price = ? WHERE id = ?', [defaultVariant.price, menuItemId]);
    }

    const product = await db.get(`
      SELECT *
      FROM menu_items
      WHERE id = ?
    `, [menuItemId]);
    product.variants = variants;

    await syncInventoryLink(db, product.id, hasVariants ? null : data.inventory_item_id);

    return NextResponse.json({
      message: 'Product created successfully',
      product,
    }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to create product');
  }
}

import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureMenuVariantsSchema, replaceVariants } from '@/lib/menu-variants.js';

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

export async function PUT(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;

    const { id } = await context.params;
    const data = await request.json();
    const db = Database.getInstance();
    await ensureMenuVariantsSchema(db);

    const hasVariants = Array.isArray(data.variants) && data.variants.length > 0;
    let variants = hasVariants ? await replaceVariants(db, id, data.variants) : await replaceVariants(db, id, []);
    const defaultVariant = variants.find((v) => v.is_default) || variants[0];
    const price = defaultVariant ? defaultVariant.price : (data.price || data.base_price || 0);

    await db.run(`
      UPDATE menu_items
      SET name = ?, category_id = ?, base_price = ?,
          description = ?, image_url = ?, is_available = ?, is_vegetarian = ?,
          preparation_time = ?, unit = ?, cost = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      data.name,
      data.category_id || null,
      price,
      data.description || null,
      data.image_url ?? null,
      data.is_available ? 1 : 0,
      data.is_vegetarian ? 1 : 0,
      data.preparation_time || 15,
      data.unit || null,
      data.cost === '' || data.cost == null ? null : Number(data.cost),
      id,
    ]);

    await syncInventoryLink(db, id, hasVariants ? null : data.inventory_item_id);

    const product = await db.get(`
      SELECT
        mi.*,
        mi.base_price as price,
        mc.name as category
      FROM menu_items mi
      LEFT JOIN menu_categories mc ON mi.category_id = mc.id
      WHERE mi.id = ?
    `, [id]);
    product.variants = variants;

    return NextResponse.json({
      message: 'Product updated successfully',
      product,
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to update product');
  }
}

export async function DELETE(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;

    const { id } = await context.params;
    const db = Database.getInstance();

    // Deleting a menu item with order history would silently orphan those
    // order_items (menu_item_id is ON DELETE SET NULL) and drop them out of
    // any report that joins on menu_items. Mark it unavailable instead.
    const ordered = await db.get('SELECT 1 AS n FROM order_items WHERE menu_item_id = ? LIMIT 1', [id]);
    if (ordered) {
      return NextResponse.json(
        { error: 'This item has order history and cannot be deleted. Mark it unavailable instead to hide it from the menu.' },
        { status: 409 }
      );
    }

    await db.run('DELETE FROM menu_items WHERE id = ?', [id]);

    return NextResponse.json({
      message: 'Product deleted successfully',
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to delete product');
  }
}

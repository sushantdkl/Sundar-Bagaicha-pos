import { NextResponse } from 'next/server';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import Database from '@/lib/db/index.js';
import { getOrderWorkspace, logPosEvent, ensureKotProSchema } from '@/lib/kot-service.js';
import { OrderRepository } from '@/lib/db/repositories/orders.js';
import { ensureColumn } from '@/lib/db/schema-helpers.js';

/** Full workspace for one order: items (sent/unsent), KOT history, bill state. */
export async function GET(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'waiter', 'cashier'] });
    if (auth.error) return auth.error;
    const { id } = await context.params;
    const orderId = parseInt(id, 10);
    if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'Invalid order.' }, { status: 400 });

    const db = Database.getInstance();
    const workspace = await getOrderWorkspace(db, orderId);
    if (!workspace) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    return NextResponse.json({ success: true, workspace });
  } catch (error) {
    return handleRouteError(error, 'Could not load the order.');
  }
}

/**
 * Change table for an active order (or update party_label).
 * Body: { table_id } and/or { party_label }
 */
export async function PATCH(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'waiter', 'cashier'] });
    if (auth.error) return auth.error;
    const { id } = await context.params;
    const orderId = parseInt(id, 10);
    if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'Invalid order.' }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const db = Database.getInstance();
    await ensureKotProSchema(db);
    await ensureColumn(db, 'orders', 'party_label', 'TEXT').catch(() => {});

    const order = await db.get(
      `SELECT * FROM orders WHERE id = ? AND status NOT IN ('completed','cancelled')`,
      [orderId]
    );
    if (!order) return NextResponse.json({ error: 'Active order not found.' }, { status: 404 });

    const orderRepo = new OrderRepository();
    const oldTableId = order.table_id || null;
    let newTableId = oldTableId;
    let tableNumber = order.table_number;

    if (body.table_id != null) {
      newTableId = parseInt(body.table_id, 10);
      if (!Number.isFinite(newTableId)) {
        return NextResponse.json({ error: 'Invalid table.' }, { status: 400 });
      }
      const table = await db.get('SELECT * FROM tables WHERE id = ?', [newTableId]);
      if (!table) return NextResponse.json({ error: 'Table not found.' }, { status: 404 });
      tableNumber = table.table_number;

      await db.run(
        `UPDATE orders SET table_id = ?, table_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [newTableId, tableNumber, orderId]
      );

      // Point the new table at this order and mark occupied.
      await db.run(
        `UPDATE tables SET status = 'occupied', current_order_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [orderId, newTableId]
      );

      // Free old table only if no other parties remain.
      if (oldTableId && oldTableId !== newTableId) {
        await orderRepo.releaseTableIfEmpty(oldTableId, orderId);
      }

      await logPosEvent(db, {
        action: 'order_changed_table',
        actor_id: auth.user.id,
        actor_name: auth.user.full_name,
        order_id: orderId,
        table_id: newTableId,
        previous_value: oldTableId,
        new_value: newTableId,
      });
    }

    if (body.party_label != null) {
      await db.run(
        `UPDATE orders SET party_label = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [String(body.party_label).trim() || null, orderId]
      );
    }

    const workspace = await getOrderWorkspace(db, orderId);
    return NextResponse.json({ success: true, workspace });
  } catch (error) {
    return handleRouteError(error, 'Could not update the order.');
  }
}

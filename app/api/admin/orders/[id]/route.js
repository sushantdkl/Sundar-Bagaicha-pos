import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureOrderColumns } from '@/lib/online-orders.js';
import { ensureColumn } from '@/lib/db/schema-helpers.js';
import { OrderRepository } from '@/lib/db/repositories/orders.js';
import { voidBillAdmin } from '@/lib/bills-admin.js';

export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'] });
    if (auth.error) return auth.error;

    const { id } = await params;
    const db = Database.getInstance();
    await ensureOrderColumns(db);
    await ensureColumn(db, 'orders', 'party_label', 'TEXT').catch(() => {});
    await ensureColumn(db, 'bills', 'payment_status', "TEXT DEFAULT 'unpaid'").catch(() => {});
    await ensureColumn(db, 'bills', 'outstanding_amount', 'REAL DEFAULT 0').catch(() => {});

    const order = await db.get(
      `
      SELECT o.*,
             o.id as order_id,
             (
               SELECT COALESCE(SUM(oi.subtotal), 0)
               FROM order_items oi
               WHERE oi.order_id = o.id
                 AND COALESCE(oi.status, '') NOT IN ('voided', 'cancelled')
             ) + COALESCE(o.delivery_fee, 0) AS total_amount,
             b.id AS bill_id,
             b.bill_number,
             b.subtotal AS bill_subtotal,
             b.tax AS bill_tax,
             b.service_charge AS bill_service_charge,
             COALESCE(b.delivery_fee, o.delivery_fee, 0) AS bill_delivery_fee,
             b.discount_amount AS bill_discount,
             b.grand_total AS bill_grand_total,
             b.status AS bill_status,
             COALESCE((SELECT SUM(bc.amount) FROM bill_corrections bc WHERE bc.bill_id=b.id AND bc.type='refund'), b.refunded_amount, 0) AS refunded_amount,
             COALESCE((SELECT SUM(bc.amount) FROM bill_corrections bc WHERE bc.bill_id=b.id AND bc.type='void'), 0) AS voided_amount,
             COALESCE(b.payment_status, o.payment_status, 'unpaid') AS payment_status,
             COALESCE(b.outstanding_amount, 0) AS outstanding_amount,
             COALESCE(b.grand_total, 0) - COALESCE(b.outstanding_amount, 0) AS amount_paid,
             b.paid_at
      FROM orders o
      LEFT JOIN bills b ON b.order_id = o.id AND b.id = (
        SELECT MAX(b2.id) FROM bills b2 WHERE b2.order_id = o.id
      )
      WHERE o.id = ?
    `,
      [id]
    );

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const items = await db.all(
      `SELECT * FROM order_items WHERE order_id = ? ORDER BY id`,
      [id]
    );

    const payments = order.bill_id
      ? await db.all(
          `SELECT * FROM bill_payments WHERE bill_id = ? ORDER BY id`,
          [order.bill_id]
        ).catch(() => [])
      : [];

    // Reopen / change history for this order's bill (added/removed items + how it settled).
    const activity = order.bill_id
      ? await db.all(
          `SELECT a.id, a.event, a.reason, a.new_value, a.created_at, u.full_name AS actor_name
           FROM bill_audit a LEFT JOIN users u ON a.actor_id = u.id
           WHERE a.bill_id = ? ORDER BY a.id DESC`,
          [order.bill_id]
        ).then((rows) => rows.map((r) => ({
          id: r.id, event: r.event, reason: r.reason || null, actor: r.actor_name || null,
          createdAt: r.created_at,
          newValue: (() => { try { return r.new_value ? JSON.parse(r.new_value) : null; } catch { return null; } })(),
        }))).catch(() => [])
      : [];

    const customer = order.customer_id
      ? await db.get(
          'SELECT id, name, phone, credit_limit, current_credit, is_blacklisted FROM customers WHERE id=?',
          [order.customer_id]
        )
      : await db
          .get(
            `SELECT id, name, phone, credit_limit, current_credit, is_blacklisted
             FROM customers WHERE phone=? OR phone_digits=? LIMIT 1`,
            [order.customer_phone, String(order.customer_phone || '').replace(/\D/g, '')]
          )
          .catch(() => null);

    return NextResponse.json({ order, items, customer, payments, activity });
  } catch (error) {
    return handleRouteError(error, 'Failed to fetch order details');
  }
}

/**
 * Cancel / void an active order (and its unpaid bill if any).
 * Body: { action: 'cancel'|'void', reason }
 */
export async function POST(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'waiter', 'cashier', 'kitchen'], permission: 'orders.cancel' });
    if (auth.error) return auth.error;

    const { id } = await params;
    const orderId = parseInt(id, 10);
    if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'Invalid order.' }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const action = body.action || 'cancel';
    const reason = String(body.reason || '').trim();
    if (!reason) return NextResponse.json({ error: 'A reason is required.' }, { status: 400 });

    const db = Database.getInstance();
    await ensureOrderColumns(db);
    const orderRepo = new OrderRepository();

    const order = await db.get('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });

    // Waiters may only release empty orders — anything with active (unvoided) lines
    // needs a cashier/admin, same rule as the legacy /api/restaurant/orders path.
    if (auth.user.role === 'waiter') {
      const activeCount = await db.get(
        `SELECT COUNT(*) AS c FROM order_items WHERE order_id = ? AND COALESCE(status, '') NOT IN ('voided', 'cancelled')`,
        [orderId]
      );
      if (Number(activeCount?.c || 0) > 0) {
        return NextResponse.json({ error: 'This order has items — ask a cashier or admin to cancel it.' }, { status: 403 });
      }
    }

    if (action === 'void' || action === 'cancel') {
      // Void any linked unpaid/pending bill first.
      const bill = await db.get(
        `SELECT id, status, payment_status FROM bills WHERE order_id = ? ORDER BY id DESC LIMIT 1`,
        [orderId]
      );
      if (bill && !['void', 'voided', 'cancelled'].includes(String(bill.status || '').toLowerCase())) {
        const paid = String(bill.payment_status || '').toLowerCase() === 'paid';
        if (paid) {
          await voidBillAdmin(db, {
            billId: bill.id,
            reason,
            restock: body.restock !== false,
            actorId: auth.user?.id,
          });
        } else {
          await db.run(
            `UPDATE bills SET status = 'voided', payment_status = 'voided',
               void_reason = ?, voided_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [reason, bill.id]
          ).catch(async () => {
            await db.run(`UPDATE bills SET status = 'voided' WHERE id = ?`, [bill.id]);
          });
        }
      }

      if (!['cancelled', 'completed'].includes(String(order.status || ''))) {
        await orderRepo.cancelOrder(orderId, reason);
      } else if (order.status === 'completed') {
        // Already completed — voidBillAdmin above handles the bill; mark order cancelled for clarity.
        await db.run(
          `UPDATE orders SET status = 'cancelled',
             notes = COALESCE(notes, '') || ?,
             cancel_reason = ?,
             cancelled_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [`\nVoided: ${reason}`, reason, orderId]
        );
        if (order.table_id) await orderRepo.releaseTableIfEmpty(order.table_id, orderId);
      }

      return NextResponse.json({ success: true, message: 'Order voided / cancelled.', action });
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (error) {
    if (error?.status) return NextResponse.json({ error: error.message }, { status: error.status });
    return handleRouteError(error, 'Could not update the order.');
  }
}

/**
 * Permanently delete a cancelled/voided order (and orphaned voided bills).
 * Active or paid-completed orders must be voided first.
 */
export async function DELETE(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;

    const { id } = await params;
    const orderId = parseInt(id, 10);
    if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'Invalid order.' }, { status: 400 });

    const db = Database.getInstance();
    const order = await db.get('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });

    const status = String(order.status || '').toLowerCase();
    if (!['cancelled', 'canceled'].includes(status)) {
      return NextResponse.json({
        error: 'Only cancelled / voided orders can be permanently deleted. Void the order first.',
      }, { status: 409 });
    }

    await db.transaction(async () => {
      const bills = await db.all('SELECT id FROM bills WHERE order_id = ?', [orderId]);
      for (const b of bills) {
        await db.run('DELETE FROM bill_payment_allocations WHERE bill_id = ?', [b.id]).catch(() => {});
        await db.run('DELETE FROM bill_payments WHERE bill_id = ?', [b.id]).catch(() => {});
        await db.run('DELETE FROM bill_revisions WHERE bill_id = ?', [b.id]).catch(() => {});
        await db.run('DELETE FROM bill_audit WHERE bill_id = ?', [b.id]).catch(() => {});
        await db.run('DELETE FROM bills WHERE id = ?', [b.id]);
      }
      const kots = await db.all('SELECT id FROM kots WHERE order_id = ?', [orderId]).catch(() => []);
      for (const k of kots) {
        await db.run('DELETE FROM kot_items WHERE kot_id = ?', [k.id]).catch(() => {});
      }
      await db.run('DELETE FROM kots WHERE order_id = ?', [orderId]).catch(() => {});
      await db.run('DELETE FROM order_items WHERE order_id = ?', [orderId]);
      await db.run('DELETE FROM orders WHERE id = ?', [orderId]);
      if (order.table_id) {
        await db.run(
          `UPDATE tables SET current_order_id = NULL, status = 'available', updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND current_order_id = ?`,
          [order.table_id, orderId]
        ).catch(() => {});
      }
    });

    return NextResponse.json({ success: true, message: 'Order permanently deleted.' });
  } catch (error) {
    return handleRouteError(error, 'Could not delete the order.');
  }
}

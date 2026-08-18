import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { OrderRepository } from '@/lib/db/repositories/orders.js';
import { getPublicMenuCategories } from '@/lib/public-menu.js';
import { resolveTableByToken } from '@/lib/table-qr.js';
import { checkRateLimit, clientIp } from '@/lib/rate-limit.js';

const OPEN_ADDABLE = (status) => !['completed', 'cancelled', 'awaiting_payment'].includes(String(status || ''));

/** QR self-ordering is on unless the admin explicitly disabled it in Settings. */
async function qrOrderingEnabled(db) {
  try {
    const row = await db.get(`SELECT setting_value FROM system_settings WHERE setting_key = 'qr_ordering_enabled'`);
    return String(row?.setting_value ?? 'true') !== 'false';
  } catch {
    return true;
  }
}

function statusLabel(status) {
  const s = String(status || 'pending');
  if (s === 'pending') return 'Order received';
  if (s === 'preparing' || s === 'dining') return 'Being prepared';
  if (s === 'ready' || s === 'served') return 'Ready / served';
  if (s === 'completed') return 'Completed';
  if (s === 'cancelled') return 'Cancelled';
  return s;
}

async function activeOrderPayload(orderRepo, table) {
  if (!table.current_order_id) return null;
  const order = await orderRepo.getById(table.current_order_id);
  if (!order || !OPEN_ADDABLE(order.status)) return null;
  const items = await orderRepo.getOrderItems(order.id, { includeVoided: false });
  return {
    order_id: order.id,
    order_number: order.order_number,
    status: order.status,
    status_label: statusLabel(order.status),
    total: Number(order.total_amount ?? order.current_amount ?? 0),
    items: (items || []).map((i) => ({ name: i.item_name, quantity: i.quantity, status: i.status })),
  };
}

/** Customer view: table + live menu + any open order on that table. */
export async function GET(request, { params }) {
  try {
    const { token } = await params;
    const db = Database.getInstance();
    const table = await resolveTableByToken(db, token);
    if (!table || Number(table.is_active) === 0) {
      return NextResponse.json({ error: 'This QR code is not active.' }, { status: 404 });
    }

    const orderRepo = new OrderRepository();
    const orderId = new URL(request.url).searchParams.get('order_id');
    if (orderId) {
      // Status polling for one order — must belong to this table.
      const order = await orderRepo.getById(orderId);
      if (!order || Number(order.table_id) !== Number(table.id)) {
        return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
      }
      const items = await orderRepo.getOrderItems(order.id, { includeVoided: false });
      return NextResponse.json({
        order: {
          order_id: order.id,
          order_number: order.order_number,
          status: order.status,
          status_label: statusLabel(order.status),
          items: (items || []).map((i) => ({ name: i.item_name, quantity: i.quantity, status: i.status })),
        },
      });
    }

    const [categories, activeOrder] = await Promise.all([
      getPublicMenuCategories(),
      activeOrderPayload(orderRepo, table),
    ]);
    return NextResponse.json({
      table: { number: table.table_number, floor: table.floor },
      categories,
      active_order: activeOrder,
      ordering_enabled: await qrOrderingEnabled(db),
    });
  } catch (error) {
    console.error('public order GET:', error);
    return NextResponse.json({ error: 'Could not load the menu.' }, { status: 500 });
  }
}

/** Customer places an order — reuses the exact waiter workflow (OrderRepository). */
export async function POST(request, { params }) {
  try {
    const { token } = await params;
    const ip = clientIp(request);
    const rl = await checkRateLimit({ key: `order:${token}:${ip}`, limit: 8, windowSeconds: 60 });
    if (!rl.ok) return NextResponse.json({ error: 'Too many orders too fast. Please wait a moment.' }, { status: 429 });

    const db = Database.getInstance();
    if (!(await qrOrderingEnabled(db))) {
      return NextResponse.json({ error: 'QR ordering is currently disabled. Please ask a member of staff.' }, { status: 403 });
    }
    const table = await resolveTableByToken(db, token);
    if (!table || Number(table.is_active) === 0) {
      return NextResponse.json({ error: 'This QR code is not active.' }, { status: 404 });
    }

    const body = await request.json();
    const rawItems = Array.isArray(body.items) ? body.items : [];

    // Only currently-available menu items may be ordered. Price is taken from
    // the menu server-side (OrderRepository), never from the client.
    const categories = await getPublicMenuCategories();
    const validIds = new Set(categories.flatMap((c) => c.items.map((i) => String(i.id))));
    const items = [];
    for (const it of rawItems) {
      const id = String(it.menu_item_id ?? it.id ?? '');
      const qty = Math.floor(Number(it.quantity || 0));
      if (!validIds.has(id) || !(qty > 0)) continue;
      items.push({
        menu_item_id: Number(id),
        variant_name: it.variant_name ? String(it.variant_name).slice(0, 60) : null,
        quantity: Math.min(qty, 50),
        special_instructions: String(it.special_instructions || '').slice(0, 200) || null,
      });
    }
    if (!items.length) return NextResponse.json({ error: 'Your cart is empty or has unavailable items.' }, { status: 400 });
    if (items.length > 40) return NextResponse.json({ error: 'Too many lines in one order.' }, { status: 400 });

    const orderRepo = new OrderRepository();
    const customerName = String(body.customer_name || '').slice(0, 80).trim() || null;

    // Append to the table's open order if there is one; otherwise start a new
    // order. Both are the identical path a waiter uses — kitchen, table state
    // and billing all behave the same.
    const current = table.current_order_id ? await orderRepo.getById(table.current_order_id) : null;
    if (current && OPEN_ADDABLE(current.status)) {
      await orderRepo.addItems(current.id, items);
      if (['dining', 'served', 'ready'].includes(current.status)) {
        await orderRepo.updateStatus(current.id, 'preparing');
      }
      return NextResponse.json({ order_id: current.id, order_number: current.order_number, appended: true }, { status: 201 });
    }

    const result = await orderRepo.create({
      table_id: table.id,
      table_number: table.table_number,
      order_type: 'dine_in',
      waiter_id: null,
      customer_name: customerName,
      notes: 'Placed by customer via QR',
      items,
    });
    return NextResponse.json({ order_id: result.order_id, order_number: result.order_number, appended: false }, { status: 201 });
  } catch (error) {
    console.error('public order POST:', error);
    return NextResponse.json({ error: 'We could not send your order. Please try again.' }, { status: 500 });
  }
}

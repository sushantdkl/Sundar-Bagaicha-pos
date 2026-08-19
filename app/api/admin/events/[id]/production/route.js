import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { productionPlan, startEvent, addProductionOrder, eventOrders } from '@/lib/events/production.js';

export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { permission: 'events.view' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    const [plan, orders] = await Promise.all([productionPlan(db, id), eventOrders(db, id)]);
    return NextResponse.json({
      plan: {
        order_items: plan.order_items,
        raw_materials: plan.raw_materials,
        raw_sources: plan.raw_sources,
        skipped: plan.skipped,
        producible: plan.producible,
      },
      started_at: plan.event.started_at,
      orders,
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to load the production plan.');
  }
}

/** action: start (default) | add_order */
export async function POST(request, { params }) {
  try {
    const auth = await requireAuth(request, { permission: 'events.production' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    if (body.action === 'add_order') {
      const result = await addProductionOrder(db, id, body, auth.user);
      return NextResponse.json({ message: 'Additional order sent to the kitchen.', ...result }, { status: 201 });
    }
    const result = await startEvent(db, id, body, auth.user);
    return NextResponse.json({ message: 'Event started. Production released to the kitchen.', ...result }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to start the event.');
  }
}

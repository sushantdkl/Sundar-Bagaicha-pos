import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import {
  getExecutive, updateExecutive, executiveDeliveries, executiveSummary,
} from '@/lib/delivery-executives.js';

export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { permission: 'delivery_executives.view' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    const q = new URL(request.url).searchParams;
    const range = { from: q.get('from'), to: q.get('to') };

    const [executive, deliveries, summary] = await Promise.all([
      getExecutive(db, id),
      executiveDeliveries(db, id, { ...range, status: q.get('status') }),
      executiveSummary(db, id, range),
    ]);
    return NextResponse.json({ executive, deliveries, summary });
  } catch (error) {
    return handleRouteError(error, 'Failed to load the delivery executive.');
  }
}

export async function PATCH(request, { params }) {
  try {
    const auth = await requireAuth(request, { permission: 'delivery_executives.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    const executive = await updateExecutive(db, id, await request.json());
    return NextResponse.json({ message: 'Delivery executive updated.', executive });
  } catch (error) {
    return handleRouteError(error, 'Failed to update the delivery executive.');
  }
}

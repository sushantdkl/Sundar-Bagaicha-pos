import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { listExecutives, createExecutive } from '@/lib/delivery-executives.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { permission: 'delivery_executives.view' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const q = new URL(request.url).searchParams;
    return NextResponse.json({
      executives: await listExecutives(db, {
        includeInactive: q.get('all') === '1',
        from: q.get('from'),
        to: q.get('to'),
      }),
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to load delivery executives.');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { permission: 'delivery_executives.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const executive = await createExecutive(db, await request.json(), auth.user);
    return NextResponse.json({ message: 'Delivery executive added.', executive }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to add the delivery executive.');
  }
}

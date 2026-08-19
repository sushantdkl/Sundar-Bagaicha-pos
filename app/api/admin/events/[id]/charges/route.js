import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { setEventCharges } from '@/lib/events/lines.js';

/** Event-level discount, VAT and service charge. */
export async function PATCH(request, { params }) {
  try {
    const auth = await requireAuth(request, { permission: 'events.discount' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    const totals = await setEventCharges(db, id, await request.json(), auth.user);
    return NextResponse.json({ message: 'Charges updated.', totals });
  } catch (error) {
    return handleRouteError(error, 'Failed to update the charges.');
  }
}

import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { getEvent } from '@/lib/events/service.js';
import {
  updateGuestCounts, guestHistory, packageAllocation,
  getBillablePolicy, explainBillable,
} from '@/lib/events/guests.js';

export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { permission: 'events.view' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    const event = await getEvent(db, id);
    const policy = await getBillablePolicy(db);
    const [allocation, history] = await Promise.all([
      packageAllocation(db, event.id),
      guestHistory(db, event.id),
    ]);
    return NextResponse.json({
      billable: explainBillable(event, policy),
      allocation,
      history,
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to load guest counts.');
  }
}

export async function PATCH(request, { params }) {
  try {
    const auth = await requireAuth(request, { permission: 'events.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    const result = await updateGuestCounts(db, id, await request.json(), auth.user);
    return NextResponse.json({ message: 'Guest counts updated.', ...result });
  } catch (error) {
    return handleRouteError(error, 'Failed to update guest counts.');
  }
}

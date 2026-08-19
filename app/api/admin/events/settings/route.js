import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import {
  getBillablePolicy, setBillablePolicy,
  BILLABLE_POLICIES, BILLABLE_POLICY_LABEL,
} from '@/lib/events/guests.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { permission: 'events.view' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    return NextResponse.json({
      billable_guest_policy: await getBillablePolicy(db),
      options: BILLABLE_POLICIES.map((v) => ({ value: v, label: BILLABLE_POLICY_LABEL[v] })),
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to load event settings.');
  }
}

export async function PATCH(request) {
  try {
    const auth = await requireAuth(request, { permission: 'events.setup' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const body = await request.json();
    const policy = await setBillablePolicy(db, body.billable_guest_policy, auth.user);
    return NextResponse.json({ message: 'Event settings updated.', billable_guest_policy: policy });
  } catch (error) {
    return handleRouteError(error, 'Failed to update event settings.');
  }
}

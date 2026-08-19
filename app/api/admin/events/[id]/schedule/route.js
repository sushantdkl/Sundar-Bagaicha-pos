import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { listSchedule, setSchedule } from '@/lib/events/deposits.js';

export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { permission: 'events.view' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    return NextResponse.json({ schedule: await listSchedule(db, id) });
  } catch (error) {
    return handleRouteError(error, 'Failed to load the payment plan.');
  }
}

export async function PUT(request, { params }) {
  try {
    const auth = await requireAuth(request, { permission: 'events.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    const body = await request.json();
    const result = await setSchedule(db, id, body.schedule, auth.user);
    return NextResponse.json({ message: 'Payment plan saved.', ...result });
  } catch (error) {
    return handleRouteError(error, 'Failed to save the payment plan.');
  }
}

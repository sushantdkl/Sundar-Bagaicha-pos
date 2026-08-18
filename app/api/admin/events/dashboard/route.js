import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { eventsDashboard } from '@/lib/events/service.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    return NextResponse.json(await eventsDashboard(db));
  } catch (error) {
    return handleRouteError(error, 'Failed to load the events dashboard.');
  }
}

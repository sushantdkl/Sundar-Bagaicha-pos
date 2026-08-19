import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { eventExpenses } from '@/lib/events/expenses.js';

/**
 * Costs booked directly against this event. Creating one goes through the
 * ordinary expenses endpoint with event_id set — there is no separate
 * event-expense engine and no separate accounting path.
 */
export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    return NextResponse.json(await eventExpenses(db, id));
  } catch (error) {
    return handleRouteError(error, 'Failed to load event expenses.');
  }
}

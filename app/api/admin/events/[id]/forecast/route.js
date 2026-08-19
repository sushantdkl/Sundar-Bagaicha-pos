import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { eventForecast } from '@/lib/events/forecast.js';

/** Read-only: forecasting never reserves or deducts stock. */
export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    const q = new URL(request.url).searchParams;
    const guests = q.get('guests');
    return NextResponse.json(
      await eventForecast(db, id, { guestsOverride: guests === null || guests === '' ? null : Number(guests) })
    );
  } catch (error) {
    return handleRouteError(error, 'Failed to build the inventory forecast.');
  }
}

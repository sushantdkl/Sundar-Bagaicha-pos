import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { forecastRange } from '@/lib/events/forecast.js';

/** Combined requirement across upcoming events, for one purchasing run. */
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const q = new URL(request.url).searchParams;
    return NextResponse.json(await forecastRange(db, {
      from: q.get('from'),
      to: q.get('to'),
      statuses: q.get('statuses') ? q.get('statuses').split(',') : null,
    }));
  } catch (error) {
    return handleRouteError(error, 'Failed to build the forecast.');
  }
}

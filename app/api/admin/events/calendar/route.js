import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { calendarEvents, listSpaces } from '@/lib/events/service.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const q = new URL(request.url).searchParams;
    const [events, spaces] = await Promise.all([
      calendarEvents(db, {
        from: q.get('from'),
        to: q.get('to'),
        includeCancelled: q.get('include_cancelled') === '1',
      }),
      listSpaces(db),
    ]);
    return NextResponse.json({ events, spaces });
  } catch (error) {
    return handleRouteError(error, 'Failed to load the events calendar.');
  }
}

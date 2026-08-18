import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { createEvent, listEvents } from '@/lib/events/service.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const q = new URL(request.url).searchParams;

    const result = await listEvents(db, {
      status: q.get('status') || 'all',
      exclude_cancelled: q.get('exclude_cancelled') === '1',
      space_id: q.get('space_id') || null,
      customer_id: q.get('customer_id') || null,
      from: q.get('from') || null,
      to: q.get('to') || null,
      search: (q.get('search') || '').trim() || null,
      page: q.get('page'),
      pageSize: q.get('page_size'),
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, 'Failed to load events.');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { event, warnings } = await createEvent(db, await request.json(), auth.user);
    return NextResponse.json({ message: 'Event created.', event, warnings }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to create the event.');
  }
}

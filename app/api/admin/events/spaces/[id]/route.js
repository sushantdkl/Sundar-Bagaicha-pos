import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { getSpace, updateSpace, deactivateSpace, spaceBookings } from '@/lib/events/spaces.js';

export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    const q = new URL(request.url).searchParams;
    const space = await getSpace(db, id);
    const bookings = await spaceBookings(db, space.id, {
      from: q.get('from') || null,
      to: q.get('to') || null,
    });
    return NextResponse.json({ space, bookings });
  } catch (error) {
    return handleRouteError(error, 'Failed to load the event space.');
  }
}

export async function PATCH(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    const space = await updateSpace(db, id, await request.json(), auth.user);
    return NextResponse.json({ message: `${space.name} updated.`, space });
  } catch (error) {
    return handleRouteError(error, 'Failed to update the event space.');
  }
}

/** Spaces are retired, never deleted — historical bookings still reference them. */
export async function DELETE(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    const space = await deactivateSpace(db, id, auth.user);
    return NextResponse.json({ message: `${space.name} deactivated.`, space });
  } catch (error) {
    return handleRouteError(error, 'Failed to deactivate the event space.');
  }
}

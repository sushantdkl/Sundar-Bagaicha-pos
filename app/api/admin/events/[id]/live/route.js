import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { liveSnapshot } from '@/lib/events/live.js';

export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { permission: 'events.view' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    return NextResponse.json(await liveSnapshot(db, id));
  } catch (error) {
    return handleRouteError(error, 'Failed to load the live event.');
  }
}

import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { listSpaces, createSpace } from '@/lib/events/spaces.js';
import { findSpaceConflicts, checkCapacity } from '@/lib/events/conflicts.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const q = new URL(request.url).searchParams;

    // With a date supplied this doubles as the live availability check the
    // booking form calls before saving.
    if (q.get('check') === '1') {
      const result = await findSpaceConflicts(db, {
        spaceId: Number(q.get('space_id')),
        eventDate: q.get('event_date'),
        endDate: q.get('end_date') || null,
        startTime: q.get('start_time') || null,
        endTime: q.get('end_time') || null,
        excludeEventId: q.get('exclude_event_id') ? Number(q.get('exclude_event_id')) : null,
      });
      const capacity = checkCapacity(result.space, q.get('guests'));
      return NextResponse.json({
        ok: result.ok && capacity.ok,
        blocking: result.blocking,
        breaches: capacity.breaches,
        warnings: [...result.warnings, ...capacity.warnings],
        space_inactive: result.space ? !result.space.is_active : false,
      });
    }

    return NextResponse.json({
      spaces: await listSpaces(db, {
        activeOnly: q.get('active') === '1',
        withUsage: q.get('usage') === '1',
      }),
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to load event spaces.');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const space = await createSpace(db, await request.json(), auth.user);
    return NextResponse.json({ message: `${space.name} created.`, space }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to create the event space.');
  }
}

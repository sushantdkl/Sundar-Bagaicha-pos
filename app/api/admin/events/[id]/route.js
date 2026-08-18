import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { getEvent, updateEvent, changeEventStatus, cancelEvent } from '@/lib/events/service.js';
import { eventAuditHistory } from '@/lib/events/audit.js';
import { listLines } from '@/lib/events/lines.js';

export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    const event = await getEvent(db, id);
    const [audit, lines] = await Promise.all([
      eventAuditHistory(db, event.id, { limit: 50 }),
      listLines(db, event.id),
    ]);
    return NextResponse.json({ event, audit, lines });
  } catch (error) {
    return handleRouteError(error, 'Failed to load the event.');
  }
}

/**
 * PATCH handles three distinct intents, kept on one route so the client has a
 * single endpoint per event: field edits, a status transition, or a cancel.
 */
export async function PATCH(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    const body = await request.json();

    if (body.action === 'cancel') {
      const event = await cancelEvent(db, id, body.reason, auth.user);
      return NextResponse.json({ message: 'Event cancelled.', event });
    }
    if (body.action === 'status') {
      // Forward the whole body: a status change can carry a manager override
      // (conflict_override / capacity_override + override_reason).
      const event = await changeEventStatus(db, id, body.status, auth.user, body);
      return NextResponse.json({ message: `Event moved to ${event.status}.`, event });
    }

    const { event, warnings } = await updateEvent(db, id, body, auth.user);
    return NextResponse.json({ message: 'Event updated.', event, warnings });
  } catch (error) {
    return handleRouteError(error, 'Failed to update the event.');
  }
}

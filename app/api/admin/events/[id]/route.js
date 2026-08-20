import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, requirePermission, handleRouteError } from '@/lib/api-guard.js';
import { getEvent, updateEvent, changeEventStatus, cancelEvent, completeWithoutCharge } from '@/lib/events/service.js';
import { eventAuditHistory } from '@/lib/events/audit.js';
import { listLines } from '@/lib/events/lines.js';

export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { permission: 'events.view' });
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
 * PATCH handles four distinct intents, kept on one route so the client has a
 * single endpoint per event: field edits, a status transition, a cancel, or a
 * no-charge completion.
 */
export async function PATCH(request, { params }) {
  try {
    const auth = await requireAuth(request, { permission: 'events.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    const body = await request.json();

    // The route is gated on events.manage because that is the common case;
    // the two riskier intents are checked once the body says which one it is.
    if (body.action === 'cancel') {
      requirePermission(auth.user, 'events.cancel');
      const event = await cancelEvent(db, id, body.reason, auth.user);
      return NextResponse.json({ message: 'Event cancelled.', event });
    }
    // Completing normally means settling (POST .../billing). This is the
    // documented exception for a genuinely free event, and it carries the
    // cancel-grade permission because it closes a booking without revenue.
    if (body.action === 'complete_no_charge') {
      requirePermission(auth.user, 'events.cancel');
      const event = await completeWithoutCharge(db, id, body.reason, auth.user);
      return NextResponse.json({ message: 'Event completed without a charge.', event });
    }
    if (body.action === 'status') {
      requirePermission(auth.user, 'events.confirm');
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

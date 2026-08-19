import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, requirePermission, handleRouteError } from '@/lib/api-guard.js';
import { updateLine, removeLine } from '@/lib/events/lines.js';

/**
 * Departing from a standard price is a pricing decision, so it needs
 * events.discount on top of events.manage. Setting the price of a bespoke
 * line is not — a decoration or a sound system has no standard price to
 * depart from, and requiring the discount permission for it would mean
 * events.manage could only ever add such a line at zero.
 *
 * The line types listed here are the ones addLine() itself treats as
 * default-priced and flags as price_overridden (see lib/events/lines.js), so
 * the permission boundary and the audit trail agree on what an override is.
 */
const DEFAULT_PRICED_LINE_TYPES = ['package', 'menu_item', 'beverage'];

function pricingOverrideRequested(body, lineType) {
  if (body?.is_complimentary) return true;
  const priced = body?.unit_price !== undefined && body?.unit_price !== null && body?.unit_price !== '';
  return priced && DEFAULT_PRICED_LINE_TYPES.includes(String(lineType || ''));
}


export async function PATCH(request, { params }) {
  try {
    const auth = await requireAuth(request, { permission: 'events.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id, lineId } = await params;
    const body = await request.json();
    // An update carries no line_type, so it comes from the stored line.
    const existing = await db.get(
      'SELECT line_type FROM event_menu_lines WHERE id = ? AND event_id = ?',
      [Number(lineId), Number(id)]
    );
    if (pricingOverrideRequested(body, existing?.line_type)) requirePermission(auth.user, 'events.discount');
    const result = await updateLine(db, id, lineId, body, auth.user);
    return NextResponse.json({ message: 'Line updated.', ...result });
  } catch (error) {
    return handleRouteError(error, 'Failed to update the line.');
  }
}

export async function DELETE(request, { params }) {
  try {
    const auth = await requireAuth(request, { permission: 'events.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id, lineId } = await params;
    const body = await request.json().catch(() => ({}));
    const result = await removeLine(db, id, lineId, body, auth.user);
    return NextResponse.json({ message: 'Line removed.', ...result });
  } catch (error) {
    return handleRouteError(error, 'Failed to remove the line.');
  }
}

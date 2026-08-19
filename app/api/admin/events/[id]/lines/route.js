import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, requirePermission, handleRouteError } from '@/lib/api-guard.js';
import { listLines, addLine } from '@/lib/events/lines.js';

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


export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { permission: 'events.view' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    return NextResponse.json({ lines: await listLines(db, id) });
  } catch (error) {
    return handleRouteError(error, 'Failed to load the quotation.');
  }
}

export async function POST(request, { params }) {
  try {
    const auth = await requireAuth(request, { permission: 'events.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    const body = await request.json();
    if (pricingOverrideRequested(body, body?.line_type)) requirePermission(auth.user, 'events.discount');
    const result = await addLine(db, id, body, auth.user);
    return NextResponse.json({ message: 'Line added.', ...result }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to add the line.');
  }
}

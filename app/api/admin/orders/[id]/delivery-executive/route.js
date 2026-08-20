import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { assignDelivery } from '@/lib/delivery-executives.js';

/**
 * Attach a delivery order to an executive, or clear it.
 *
 * Attribution only: the order, its bill, its stock and its revenue are
 * untouched, so this can never affect sales totals.
 */
export async function PATCH(request, { params }) {
  try {
    const auth = await requireAuth(request, { permission: 'delivery_executives.assign' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    const body = await request.json();

    const result = await assignDelivery(db, id, body.delivery_executive_id || null, {
      actor: auth.user,
      reassign: Boolean(body.reassign),
      allowOffDuty: Boolean(body.allow_off_duty),
    });
    return NextResponse.json({
      message: result.delivery_executive_id ? 'Delivery assigned.' : 'Assignment cleared.',
      ...result,
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to assign the delivery.');
  }
}

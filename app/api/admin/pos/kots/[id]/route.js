import { NextResponse } from 'next/server';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import Database from '@/lib/db/index.js';
import { cancelKot } from '@/lib/kot-service.js';

/** Cancel a KOT snapshot with a mandatory custom reason. */
async function cancelKotRequest(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'waiter', 'cashier', 'kitchen'], permission: 'kots.cancel' });
    if (auth.error) return auth.error;

    const { id } = await context.params;
    const kotId = parseInt(id, 10);
    if (!Number.isFinite(kotId)) return NextResponse.json({ error: 'Invalid KOT.' }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const db = Database.getInstance();
    const { kot } = await cancelKot(db, {
      kotId,
      reason: body.reason,
      actor: auth.user,
    });

    return NextResponse.json({ success: true, kot, message: 'KOT cancelled.' });
  } catch (error) {
    if (error?.status && error.status < 500) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return handleRouteError(error, 'Could not cancel the kitchen ticket.');
  }
}

export async function PATCH(request, context) {
  return cancelKotRequest(request, context);
}

export async function DELETE(request, context) {
  return cancelKotRequest(request, context);
}

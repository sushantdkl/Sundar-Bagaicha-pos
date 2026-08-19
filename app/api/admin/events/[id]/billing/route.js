import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { finalStatement, finaliseBilling } from '@/lib/events/billing.js';

export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    return NextResponse.json(await finalStatement(db, id));
  } catch (error) {
    return handleRouteError(error, 'Failed to build the final statement.');
  }
}

/** Settle and complete. Split payment is simply more than one entry. */
export async function POST(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    const result = await finaliseBilling(db, id, await request.json(), auth.user);
    return NextResponse.json({ message: 'Event settled and completed.', ...result }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to settle the event.');
  }
}

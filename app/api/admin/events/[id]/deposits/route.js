import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { depositSummary, collectDeposit, refundDeposit, voidDeposit } from '@/lib/events/deposits.js';

export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { permission: 'events.view' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    return NextResponse.json(await depositSummary(db, id));
  } catch (error) {
    return handleRouteError(error, 'Failed to load deposits.');
  }
}

/** action: collect (default) | refund | void */
export async function POST(request, { params }) {
  try {
    const auth = await requireAuth(request, { permission: 'events.deposits' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    const body = await request.json();

    if (body.action === 'refund') {
      const result = await refundDeposit(db, id, body, auth.user);
      return NextResponse.json({ message: 'Refund recorded.', ...result }, { status: 201 });
    }
    if (body.action === 'void') {
      const deposit = await voidDeposit(db, body.deposit_id, body.reason, auth.user);
      return NextResponse.json({ message: 'Entry voided.', deposit });
    }
    const result = await collectDeposit(db, id, body, auth.user);
    return NextResponse.json(
      { message: result.idempotent ? 'Already recorded.' : 'Deposit recorded.', ...result },
      { status: result.idempotent ? 200 : 201 }
    );
  } catch (error) {
    return handleRouteError(error, 'Failed to record the payment.');
  }
}

import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureAccountingSchema, pendingSettlements } from '@/lib/accounting.js';
import { listBankAccounts, listSettlements, settlePayments } from '@/lib/accounting-cash.js';
import { currentBusinessDayId } from '@/lib/business-days.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    const [pending, history, banks] = await Promise.all([
      pendingSettlements(db),
      listSettlements(db),
      listBankAccounts(db),
    ]);
    return NextResponse.json({ pending, history, banks });
  } catch (error) {
    return handleRouteError(error, 'Failed to load settlements');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    await currentBusinessDayId(db, { required: true });
    const settlement = await settlePayments(db, { ...(await request.json()), settled_by: auth.user?.id || null });
    return NextResponse.json({ message: 'Settlement recorded.', settlement }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to record settlement');
  }
}

import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureAccountingSchema } from '@/lib/accounting.js';
import { listBankAccounts, createBankAccount, recordBankMovement } from '@/lib/accounting-cash.js';
import { currentBusinessDayId } from '@/lib/business-days.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    return NextResponse.json({ banks: await listBankAccounts(db) });
  } catch (error) {
    return handleRouteError(error, 'Failed to load bank accounts');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    const data = await request.json();
    // action: 'add_account' | 'deposit' | 'withdrawal' | 'transfer'
    if (data.action === 'add_account') {
      return NextResponse.json({ bank: await createBankAccount(db, data) }, { status: 201 });
    }
    await currentBusinessDayId(db, { required: true });
    const result = await recordBankMovement(db, { ...data, kind: data.action, created_by: auth.user?.id || null });
    return NextResponse.json({ message: 'Recorded.', ...result }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to record bank movement');
  }
}

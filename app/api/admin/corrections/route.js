import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureAccountingSchema } from '@/lib/accounting.js';
import { reverseJournal, listCorrections } from '@/lib/accounting-corrections.js';
import { voidPaidBill, refundBill, listBillCorrections } from '@/lib/bill-corrections.js';

export async function GET(request) {
  try {
    // Void/refund is a manager action — admin only.
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    const [corrections, billCorrections] = await Promise.all([listCorrections(db), listBillCorrections(db)]);
    return NextResponse.json({ corrections, bill_corrections: billCorrections });
  } catch (error) {
    return handleRouteError(error, 'Failed to load corrections');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    const data = await request.json();
    const by = auth.user?.id || null;

    if (data.action === 'reverse') {
      const journal_id = await db.transaction((tx) => reverseJournal(tx, { journal_id: data.journal_id, reason: data.reason, created_by: by }));
      return NextResponse.json({ message: 'Journal reversed.', journal_id }, { status: 201 });
    }
    if (data.action === 'void_bill') {
      const result = await voidPaidBill(db, {
        bill_id: data.bill_id,
        bill_number: data.bill_number,
        reason: data.reason,
        restock: data.restock !== false,
        created_by: by,
      });
      return NextResponse.json({ message: 'Bill voided.', ...result }, { status: 201 });
    }
    if (data.action === 'refund') {
      const result = await refundBill(db, {
        bill_id: data.bill_id,
        bill_number: data.bill_number,
        amount: data.amount,
        full: !!data.full,
        method: data.method || 'cash',
        reason: data.reason,
        created_by: by,
      });
      return NextResponse.json({ message: 'Refund posted.', ...result }, { status: 201 });
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (error) {
    return handleRouteError(error, 'Failed to post correction');
  }
}

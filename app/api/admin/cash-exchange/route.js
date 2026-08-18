import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureAccountingSchema } from '@/lib/accounting.js';
import { recordCashExchange } from '@/lib/accounting-cash.js';
import { currentBusinessDayId } from '@/lib/business-days.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    const rows = await db.all(
      `SELECT je.id, je.entry_date, je.memo, je.created_at, u.full_name AS by_name
       FROM journal_entries je LEFT JOIN users u ON je.created_by = u.id
       WHERE je.source_type = 'exchange' ORDER BY je.id DESC LIMIT 30`
    );
    return NextResponse.json({ exchanges: rows });
  } catch (error) {
    return handleRouteError(error, 'Failed to load exchanges');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    await currentBusinessDayId(db, { required: true });
    const result = await recordCashExchange(db, { ...(await request.json()), created_by: auth.user?.id || null });
    return NextResponse.json({ message: 'Exchange recorded.', ...result }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to record exchange');
  }
}

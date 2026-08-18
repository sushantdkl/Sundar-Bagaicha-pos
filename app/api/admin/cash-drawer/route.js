import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureAccountingSchema, accountBalance } from '@/lib/accounting.js';
import {
  listDrawers,
  listSessions,
  openSession,
  closeSession,
  createDrawer,
  recordCashMovement,
  listCashMovements,
  listBankAccounts,
  CASH_IN_TYPES,
  CASH_OUT_TYPES,
} from '@/lib/accounting-cash.js';
import { currentBusinessDayId } from '@/lib/business-days.js';

const DRAWER_ROLES = ['admin', 'cashier'];

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: DRAWER_ROLES });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    const q = new URL(request.url).searchParams;
    const [drawers, sessions, movements, banks] = await Promise.all([
      listDrawers(db),
      listSessions(db, { drawerId: q.get('drawer_id') }),
      listCashMovements(db, { drawerId: q.get('drawer_id') || null, limit: 50 }),
      listBankAccounts(db),
    ]);
    const open = sessions.find((s) => s.status === 'open') || null;
    let expected_cash = null;
    if (open?.drawer_id) {
      expected_cash = await accountBalance(db, '1010', { drawerId: open.drawer_id });
    }
    return NextResponse.json({
      drawers,
      sessions,
      open,
      expected_cash,
      movements,
      banks,
      cash_in_types: Object.entries(CASH_IN_TYPES).map(([value, meta]) => ({
        value,
        label: meta.label,
        needs_bank: Boolean(meta.needsBank),
      })),
      cash_out_types: Object.entries(CASH_OUT_TYPES).map(([value, meta]) => ({
        value,
        label: meta.label,
        needs_bank: Boolean(meta.needsBank),
      })),
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to load cash drawer');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: DRAWER_ROLES });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    const data = await request.json();

    if (data.action === 'add_drawer') {
      if (auth.user?.role !== 'admin') {
        return NextResponse.json({ error: 'Only admin can add drawers.' }, { status: 403 });
      }
      return NextResponse.json({ drawer: await createDrawer(db, data.name) }, { status: 201 });
    }

    if (data.action === 'cash_in' || data.action === 'cash_out') {
      const businessDayId = await currentBusinessDayId(db, { required: true });
      const result = await recordCashMovement(db, {
        direction: data.action === 'cash_in' ? 'in' : 'out',
        movement_type: data.movement_type,
        amount: data.amount,
        reason: data.reason || data.note,
        created_by: auth.user?.id || null,
        drawer_id: data.drawer_id || null,
        bank_account_id: data.bank_account_id || null,
        external_ref: data.external_ref || null,
        business_day_id: businessDayId,
      });
      const expected_cash = await accountBalance(db, '1010', { drawerId: result.drawer_id });
      return NextResponse.json({
        message: data.action === 'cash_in' ? 'Cash in recorded.' : 'Cash out recorded.',
        ...result,
        expected_cash,
      }, { status: 201 });
    }

    const businessDayId = await currentBusinessDayId(db, { required: true });
    const session = await openSession(db, { ...data, opened_by: auth.user?.id || null, business_day_id: businessDayId });
    return NextResponse.json({ message: 'Drawer opened.', session }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to update cash drawer');
  }
}

export async function PUT(request) {
  try {
    const auth = await requireAuth(request, { roles: DRAWER_ROLES });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    await currentBusinessDayId(db, { required: true });
    const data = await request.json();
    const session = await closeSession(db, { ...data, closed_by: auth.user?.id || null });
    return NextResponse.json({ message: 'Drawer closed.', session });
  } catch (error) {
    return handleRouteError(error, 'Failed to close drawer');
  }
}

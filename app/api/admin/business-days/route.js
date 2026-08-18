import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import {
  businessDayContext,
  businessDaySummary,
  closeBusinessDay,
  listBusinessDays,
  openBusinessDay,
} from '@/lib/business-days.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { permission: 'business_days.view' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const query = new URL(request.url).searchParams;
    const view = query.get('view') || 'context';
    if (view === 'history') {
      return NextResponse.json(await listBusinessDays(db, {
        page: query.get('page'), pageSize: query.get('pageSize'),
      }));
    }
    const context = await businessDayContext(db);
    if (view === 'closing' && context.current) {
      return NextResponse.json({ ...context, summary: await businessDaySummary(db, context.current) });
    }
    return NextResponse.json(context);
  } catch (error) {
    return handleRouteError(error, 'Could not load business day status.');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { permission: 'business_days.open' });
    if (auth.error) return auth.error;
    const body = await request.json();
    const day = await openBusinessDay(Database.getInstance(), body, auth.user);
    const message = body.action === 'reopen_same_day' ? 'Store reopened.'
      : body.action === 'start_next' ? 'Next business day started.'
      : body.action === 'continue_stale' ? 'Business day continued.'
      : 'Business day opened.';
    return NextResponse.json({ message, day }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Could not open the business day.');
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const force = body.force === true;
    const auth = await requireAuth(request, {
      permission: force ? 'business_days.force_close' : 'business_days.close',
    });
    if (auth.error) return auth.error;
    const result = await closeBusinessDay(Database.getInstance(), body, auth.user, { force });
    return NextResponse.json({ message: force ? 'Store session force closed.' : 'Store session closed.', result });
  } catch (error) {
    return handleRouteError(error, 'Could not close the business day.');
  }
}

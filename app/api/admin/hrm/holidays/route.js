import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { listHolidays, createHoliday, updateHoliday } from '@/lib/hrm.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { permission: 'hrm.holidays.view' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const q = new URL(request.url).searchParams;
    return NextResponse.json({
      holidays: await listHolidays(db, {
        year: q.get('year'),
        includeInactive: q.get('all') === '1',
      }),
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to load holidays.');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { permission: 'hrm.holidays.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const holiday = await createHoliday(db, await request.json(), auth.user);
    return NextResponse.json({ message: 'Holiday added.', holiday }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to add the holiday.');
  }
}

export async function PATCH(request) {
  try {
    const auth = await requireAuth(request, { permission: 'hrm.holidays.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const body = await request.json();
    const holiday = await updateHoliday(db, body.id, body);
    return NextResponse.json({ message: 'Holiday updated.', holiday });
  } catch (error) {
    return handleRouteError(error, 'Failed to update the holiday.');
  }
}

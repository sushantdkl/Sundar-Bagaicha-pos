import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { listAttendance, markAttendance, attendanceSummary } from '@/lib/hrm.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { permission: 'hrm.attendance.view' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const q = new URL(request.url).searchParams;

    // view=summary returns per-person totals for a month rather than rows.
    if (q.get('view') === 'summary') {
      return NextResponse.json({
        summary: await attendanceSummary(db, {
          from: q.get('from'),
          to: q.get('to'),
          departmentId: q.get('department_id'),
        }),
      });
    }
    return NextResponse.json({
      attendance: await listAttendance(db, {
        date: q.get('date'),
        from: q.get('from'),
        to: q.get('to'),
        userId: q.get('user_id'),
        departmentId: q.get('department_id'),
      }),
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to load attendance.');
  }
}

/** Marking the same person and day twice corrects the record, never duplicates it. */
export async function POST(request) {
  try {
    const auth = await requireAuth(request, { permission: 'hrm.attendance.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const record = await markAttendance(db, await request.json(), auth.user);
    return NextResponse.json({ message: 'Attendance saved.', attendance: record }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to save attendance.');
  }
}

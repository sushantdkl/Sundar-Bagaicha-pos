import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { listStaff, updateStaffHrProfile } from '@/lib/hrm.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { permission: 'hrm.staff.view' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const q = new URL(request.url).searchParams;
    return NextResponse.json({
      staff: await listStaff(db, {
        departmentId: q.get('department_id'),
        search: q.get('search'),
        includeInactive: q.get('active_only') !== '1',
      }),
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to load staff.');
  }
}

/**
 * HR facts only. Creating a person, their login and their system role stays
 * with /api/admin/employees — this endpoint deliberately cannot grant access.
 */
export async function PATCH(request) {
  try {
    const auth = await requireAuth(request, { permission: 'hrm.staff.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const body = await request.json();
    const member = await updateStaffHrProfile(db, body.id, body);
    return NextResponse.json({ message: 'Staff record updated.', staff: member });
  } catch (error) {
    return handleRouteError(error, 'Failed to update the staff record.');
  }
}

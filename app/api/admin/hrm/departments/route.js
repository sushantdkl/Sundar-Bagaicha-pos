import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { listDepartments, createDepartment, updateDepartment } from '@/lib/hrm.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { permission: 'hrm.departments.view' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const q = new URL(request.url).searchParams;
    return NextResponse.json({
      departments: await listDepartments(db, { includeInactive: q.get('all') === '1' }),
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to load departments.');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { permission: 'hrm.departments.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const department = await createDepartment(db, await request.json(), auth.user);
    return NextResponse.json({ message: 'Department created.', department }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to create the department.');
  }
}

export async function PATCH(request) {
  try {
    const auth = await requireAuth(request, { permission: 'hrm.departments.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const body = await request.json();
    const department = await updateDepartment(db, body.id, body);
    return NextResponse.json({ message: 'Department updated.', department });
  } catch (error) {
    return handleRouteError(error, 'Failed to update the department.');
  }
}

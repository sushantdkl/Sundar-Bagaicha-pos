import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { listDesignations, createDesignation, updateDesignation } from '@/lib/hrm.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { permission: 'hrm.designations.view' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const q = new URL(request.url).searchParams;
    return NextResponse.json({
      designations: await listDesignations(db, {
        includeInactive: q.get('all') === '1',
        departmentId: q.get('department_id'),
      }),
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to load designations.');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { permission: 'hrm.designations.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const designation = await createDesignation(db, await request.json(), auth.user);
    return NextResponse.json({ message: 'Designation created.', designation }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to create the designation.');
  }
}

export async function PATCH(request) {
  try {
    const auth = await requireAuth(request, { permission: 'hrm.designations.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const body = await request.json();
    const designation = await updateDesignation(db, body.id, body);
    return NextResponse.json({ message: 'Designation updated.', designation });
  } catch (error) {
    return handleRouteError(error, 'Failed to update the designation.');
  }
}

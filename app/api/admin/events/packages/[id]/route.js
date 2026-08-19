import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { getPackage, updatePackage, deactivatePackage } from '@/lib/events/packages.js';

export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { permission: 'events.view' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    return NextResponse.json({ package: await getPackage(db, id) });
  } catch (error) {
    return handleRouteError(error, 'Failed to load the package.');
  }
}

export async function PATCH(request, { params }) {
  try {
    const auth = await requireAuth(request, { permission: 'events.setup' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    const pkg = await updatePackage(db, id, await request.json(), auth.user);
    return NextResponse.json({ message: `${pkg.name} updated.`, package: pkg });
  } catch (error) {
    return handleRouteError(error, 'Failed to update the package.');
  }
}

/** Deactivated, never deleted — quoted events still reference it. */
export async function DELETE(request, { params }) {
  try {
    const auth = await requireAuth(request, { permission: 'events.setup' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    const pkg = await deactivatePackage(db, id, auth.user);
    return NextResponse.json({ message: `${pkg.name} deactivated.`, package: pkg });
  } catch (error) {
    return handleRouteError(error, 'Failed to deactivate the package.');
  }
}

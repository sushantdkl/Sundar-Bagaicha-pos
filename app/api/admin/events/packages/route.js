import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { listPackages, createPackage } from '@/lib/events/packages.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const q = new URL(request.url).searchParams;
    return NextResponse.json({
      packages: await listPackages(db, { activeOnly: q.get('active') === '1' }),
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to load event packages.');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const pkg = await createPackage(db, await request.json(), auth.user);
    return NextResponse.json({ message: `${pkg.name} created.`, package: pkg }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to create the package.');
  }
}

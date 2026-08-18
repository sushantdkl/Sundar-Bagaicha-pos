import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import {
  PERMISSION_CATALOG,
  ensurePermissionCache,
  isPermissionAllowedSync,
} from '@/lib/permissions.js';

/** Current user's dynamic capabilities for navigation and action visibility. */
export async function GET(request) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    await ensurePermissionCache(Database.getInstance());
    return NextResponse.json({
      role: auth.user.role,
      capabilities: Object.fromEntries(
        PERMISSION_CATALOG.map(({ key }) => [key, isPermissionAllowedSync(auth.user.role, key)])
      ),
    });
  } catch (error) {
    return handleRouteError(error, 'Could not load staff permissions.');
  }
}

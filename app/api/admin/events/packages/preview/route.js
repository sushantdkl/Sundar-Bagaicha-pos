import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { previewPackagePrice } from '@/lib/events/packages.js';

/**
 * Price calculator. POST so an unsaved draft (with its tiers) can be priced
 * before it exists in the database.
 */
export async function POST(request) {
  try {
    const auth = await requireAuth(request, { permission: 'events.view' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const body = await request.json();
    const preview = await previewPackagePrice(db, {
      packageId: body.package_id ?? null,
      draft: body.draft ?? null,
      guests: body.guests,
      manualRate: body.manual_rate ?? null,
      policy: body.policy ?? null,
    });
    return NextResponse.json(preview);
  } catch (error) {
    return handleRouteError(error, 'Failed to calculate the price.');
  }
}

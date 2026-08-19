import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { packageFoodCost, marginFromPriceAndCost } from '@/lib/events/components.js';
import { getPackage } from '@/lib/events/packages.js';
import { priceForGuests } from '@/lib/events/pricing.js';

/**
 * Food cost for a package, and — when it can be priced — the margin beside it.
 * Read-only: walking a BOM never moves stock.
 */
export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { permission: 'events.view' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    const q = new URL(request.url).searchParams;
    const guests = Number(q.get('guests') || 1);

    const cost = await packageFoodCost(db, id, { guests });

    let price = null;
    let margin = null;
    try {
      const pkg = await getPackage(db, id);
      const manualRate = q.get('manual_rate');
      price = priceForGuests(pkg, pkg.tiers, guests, {
        policy: q.get('policy') || pkg.pricing_policy,
        manualRate: manualRate === null || manualRate === '' ? undefined : Number(manualRate),
      });
      margin = marginFromPriceAndCost(price, cost);
    } catch (err) {
      // A package that cannot be priced yet (manual policy with no rate) still
      // has a meaningful food cost — report the reason instead of failing.
      margin = { unavailable: err.message };
    }

    return NextResponse.json({ cost, price, margin });
  } catch (error) {
    return handleRouteError(error, 'Failed to calculate the package cost.');
  }
}

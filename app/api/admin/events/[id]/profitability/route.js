import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { estimatedProfitability, actualProfitability, getThresholds, setThresholds } from '@/lib/events/profitability.js';

/** basis=estimate (pre-event) | actual (post-event) | both */
export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { permission: 'events.reports' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    const basis = new URL(request.url).searchParams.get('basis') || 'both';

    const out = { thresholds: await getThresholds(db) };
    if (basis === 'estimate' || basis === 'both') out.estimate = await estimatedProfitability(db, id);
    if (basis === 'actual' || basis === 'both') out.actual = await actualProfitability(db, id);
    return NextResponse.json(out);
  } catch (error) {
    return handleRouteError(error, 'Failed to calculate profitability.');
  }
}

/** Warning thresholds are configuration, not code. */
export async function PATCH(request) {
  try {
    const auth = await requireAuth(request, { permission: 'events.setup' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const thresholds = await setThresholds(db, await request.json());
    return NextResponse.json({ message: 'Thresholds updated.', thresholds });
  } catch (error) {
    return handleRouteError(error, 'Failed to update thresholds.');
  }
}

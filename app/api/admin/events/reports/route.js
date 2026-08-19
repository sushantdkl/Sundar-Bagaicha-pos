import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { salesByChannel, eventsReport, profitabilityReport } from '@/lib/events/reports.js';

/** report=channels | events | profitability (default: all three) */
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const q = new URL(request.url).searchParams;
    const from = q.get('from');
    const to = q.get('to');
    const report = q.get('report') || 'all';

    const out = {};
    if (report === 'channels' || report === 'all') out.channels = await salesByChannel(db, { from, to });
    if (report === 'events' || report === 'all') out.events = await eventsReport(db, { from, to });
    if (report === 'profitability' || report === 'all') out.profitability = await profitabilityReport(db, { from, to });
    return NextResponse.json(out);
  } catch (error) {
    return handleRouteError(error, 'Failed to build the events report.');
  }
}

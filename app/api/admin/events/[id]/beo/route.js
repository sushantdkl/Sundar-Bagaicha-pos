import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { buildBeo, issueRevision, revisionHistory, BEO_AUDIENCE } from '@/lib/events/beo.js';

export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    const q = new URL(request.url).searchParams;
    const audience = q.get('audience') || BEO_AUDIENCE.CUSTOMER;
    const [document, revisions] = await Promise.all([
      buildBeo(db, id, { audience }),
      revisionHistory(db, id),
    ]);
    return NextResponse.json({ document, revisions });
  } catch (error) {
    return handleRouteError(error, 'Failed to build the event document.');
  }
}

/** Issue a new revision — append-only; earlier snapshots stay readable. */
export async function POST(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const document = await issueRevision(db, id, {
      audience: body.audience || BEO_AUDIENCE.CUSTOMER,
      reason: body.reason || null,
      final: Boolean(body.final),
    }, auth.user);
    return NextResponse.json({ message: `Revision ${document.revision} issued.`, document }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to issue the revision.');
  }
}

import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { listComponents, replaceComponents } from '@/lib/events/components.js';

export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    return NextResponse.json({ components: await listComponents(db, id) });
  } catch (error) {
    return handleRouteError(error, 'Failed to load package components.');
  }
}

/** The editor submits the complete component list; PUT replaces it wholesale. */
export async function PUT(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    const body = await request.json();
    const components = await replaceComponents(db, id, body.components, auth.user);
    return NextResponse.json({ message: 'Package menu saved.', components });
  } catch (error) {
    return handleRouteError(error, 'Failed to save package components.');
  }
}

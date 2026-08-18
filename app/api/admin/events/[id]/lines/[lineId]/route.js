import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { updateLine, removeLine } from '@/lib/events/lines.js';

export async function PATCH(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id, lineId } = await params;
    const result = await updateLine(db, id, lineId, await request.json(), auth.user);
    return NextResponse.json({ message: 'Line updated.', ...result });
  } catch (error) {
    return handleRouteError(error, 'Failed to update the line.');
  }
}

export async function DELETE(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id, lineId } = await params;
    const body = await request.json().catch(() => ({}));
    const result = await removeLine(db, id, lineId, body, auth.user);
    return NextResponse.json({ message: 'Line removed.', ...result });
  } catch (error) {
    return handleRouteError(error, 'Failed to remove the line.');
  }
}

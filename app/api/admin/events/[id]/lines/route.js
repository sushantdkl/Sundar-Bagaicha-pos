import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { listLines, addLine } from '@/lib/events/lines.js';

export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    return NextResponse.json({ lines: await listLines(db, id) });
  } catch (error) {
    return handleRouteError(error, 'Failed to load the quotation.');
  }
}

export async function POST(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const { id } = await params;
    const result = await addLine(db, id, await request.json(), auth.user);
    return NextResponse.json({ message: 'Line added.', ...result }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to add the line.');
  }
}

import { NextResponse } from 'next/server';
import { AuthService } from '@/lib/auth/auth.js';
import { changeReservationTable } from '@/lib/leads.js';

const authService = new AuthService();

async function requireAdmin(request) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const user = await authService.verifySession(token);
  if (!user || user.role !== 'admin') return null;
  return user;
}

export async function POST(request, { params }) {
  try {
    const user = await requireAdmin(request);
    if (!user) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    if (!body.table_id) {
      return NextResponse.json({ error: 'Please choose a table.' }, { status: 400 });
    }

    const reservation = await changeReservationTable(Number(id), Number(body.table_id), {
      force: !!body.force,
    });

    return NextResponse.json({ success: true, reservation });
  } catch (error) {
    console.error('Change table error:', error);
    const status = error.code === 'table_conflict' ? 409 : 400;
    return NextResponse.json(
      {
        error: error.message || 'Could not change table',
        code: error.code,
        conflicts: error.conflicts,
        alternatives: error.alternatives,
      },
      { status }
    );
  }
}

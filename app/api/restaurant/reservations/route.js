import { NextResponse } from 'next/server';
import { AuthService } from '@/lib/auth/auth.js';
import { listReservations, processAutoNoShows } from '@/lib/leads.js';

const authService = new AuthService();

async function requireFloorStaff(request) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const user = await authService.verifySession(token);
  if (!user || !['admin', 'waiter', 'cashier'].includes(user.role)) return null;
  return user;
}

/** Floor list: today / upcoming active reservations (no cancel/edit tooling). */
export async function GET(request) {
  try {
    const user = await requireFloorStaff(request);
    if (!user) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    try {
      await processAutoNoShows();
    } catch {
      /* ignore */
    }

    const { searchParams } = new URL(request.url);
    const boardParam = searchParams.get('board') || 'ops';
    const board =
      boardParam === 'upcoming'
        ? 'upcoming'
        : boardParam === 'today'
          ? 'today'
          : boardParam === 'history'
            ? 'history'
            : 'ops';

    const reservations = await listReservations({ board });

    // Show all statuses for floor ops (new / confirmed / seated / cancelled / etc.)
    return NextResponse.json({ reservations: reservations || [] });
  } catch (error) {
    console.error('Restaurant reservations GET:', error);
    return NextResponse.json({ error: 'Failed to load reservations' }, { status: 500 });
  }
}

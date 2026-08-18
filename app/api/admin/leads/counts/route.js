import { NextResponse } from 'next/server';
import { AuthService } from '@/lib/auth/auth.js';
import { getLeadsCounts } from '@/lib/leads.js';

const authService = new AuthService();

export async function GET(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const user = await authService.verifySession(token);
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const counts = await getLeadsCounts();
    return NextResponse.json({ counts });
  } catch (error) {
    console.error('Leads counts error:', error);
    return NextResponse.json({ error: 'Failed to load counts' }, { status: 500 });
  }
}

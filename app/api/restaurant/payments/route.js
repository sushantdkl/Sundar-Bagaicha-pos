import { NextResponse } from 'next/server';
import { OrderRepository } from '@/lib/db/repositories/orders';
import { AuthService } from '@/lib/auth/auth';

const orderRepo = new OrderRepository();
const authService = new AuthService();

// Get payment history
export async function GET(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await authService.verifySession(token);
    if (!user || (user.role !== 'cashier' && user.role !== 'admin')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const payments = await orderRepo.getAllPayments(startDate, endDate);

    // Parse notes field for each payment
    const enrichedPayments = payments.map(payment => {
      try {
        const notes = payment.notes ? JSON.parse(payment.notes) : {};
        return {
          ...payment,
          ...notes,
          notes: undefined // Remove raw notes field
        };
      } catch (e) {
        return payment;
      }
    });

    return NextResponse.json({
      success: true,
      payments: enrichedPayments
    });

  } catch (error) {
    console.error('Error fetching payment history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch payment history', details: error.message },
      { status: 500 }
    );
  }
}

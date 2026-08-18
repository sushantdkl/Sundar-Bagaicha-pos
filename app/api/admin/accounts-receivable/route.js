import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureAccountingSchema } from '@/lib/accounting.js';
import { listBankAccounts } from '@/lib/accounting-cash.js';
import {
  customerReceivables,
  receivableAgeing,
  customerArStatement,
  collectCustomerCredit,
  writeOffCustomerCredit,
  arAccountBalance,
  outstandingCreditBills,
} from '@/lib/accounting-receivables.js';
import { collectCreditBalance, writeOffCreditBalance } from '@/lib/split-payments.js';

function newKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`;
}

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    const q = new URL(request.url).searchParams;

    const customerId = q.get('customer_id');
    if (customerId) {
      const [statement, bills] = await Promise.all([
        customerArStatement(db, customerId, { from: q.get('from'), to: q.get('to') }),
        outstandingCreditBills(db, customerId),
      ]);
      return NextResponse.json({ statement, bills });
    }

    const [receivables, ageing, ar_balance, banks] = await Promise.all([
      customerReceivables(db),
      receivableAgeing(db),
      arAccountBalance(db),
      listBankAccounts(db),
    ]);
    return NextResponse.json({ receivables, ageing, ar_balance, banks });
  } catch (error) {
    return handleRouteError(error, 'Failed to load accounts receivable');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    const body = await request.json();
    const actorId = auth.user?.id || null;
    const actorRole = auth.user?.role || 'admin';

    // A bill_id scopes the action to exactly that invoice (the order-detail
    // popup's "Pay"/"Discount") instead of FIFO-applying across every open
    // bill for the customer (the customer-level popup's action).
    if (body.bill_id) {
      if (body.action === 'writeoff') {
        const result = await writeOffCreditBalance(db, {
          billId: body.bill_id, amount: body.amount, reason: body.note, actorId, actorRole,
          requestKey: body.external_ref || newKey(),
        });
        return NextResponse.json({ message: 'Discount / write-off recorded.', ...result }, { status: 201 });
      }
      const method = body.method || 'cash';
      const result = await collectCreditBalance(db, {
        billId: body.bill_id,
        allocations: [{
          method,
          amount: body.amount,
          cash_tendered: method === 'cash' ? body.amount : undefined,
          reference: body.reference || body.note || undefined,
          bank_account_id: body.bank_account_id || undefined,
          provider: body.provider || undefined,
        }],
        actorId, actorRole,
        requestKey: body.external_ref || newKey(),
      });
      return NextResponse.json({ message: 'Customer payment recorded.', ...result }, { status: 201 });
    }

    if (body.action === 'writeoff') {
      const result = await writeOffCustomerCredit(db, { ...body, actorId, actorRole });
      return NextResponse.json({ message: 'Discount / write-off recorded.', ...result }, { status: 201 });
    }
    const result = await collectCustomerCredit(db, { ...body, actorId, actorRole });
    return NextResponse.json({ message: 'Customer payment recorded.', ...result }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to record customer payment');
  }
}

import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureRecipeTables } from '@/lib/recipes.js';
import { getPurchase, updatePurchase, voidPurchase, deletePurchase } from '@/lib/purchases.js';
import { isPermissionAllowedSync } from '@/lib/permissions.js';

export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'purchases.view' });
    if (auth.error) return auth.error;

    const { id } = await params;
    const db = Database.getInstance();
    await ensureRecipeTables(db);

    const purchase = await getPurchase(db, id);
    if (!purchase) return NextResponse.json({ error: 'Purchase not found.' }, { status: 404 });
    return NextResponse.json({ purchase });
  } catch (error) {
    return handleRouteError(error, 'Failed to load purchase');
  }
}

export async function PUT(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'purchases.edit' });
    if (auth.error) return auth.error;

    const { id } = await params;
    const data = await request.json();
    const db = Database.getInstance();
    await ensureRecipeTables(db);
    const supplierName = data.supplier || data.supplier_name;
    if (auth.user?.role === 'cashier' && String(supplierName || '').trim()) {
      const existingSupplier = await db.get(
        `SELECT id FROM suppliers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1`,
        [String(supplierName).trim()]
      );
      if (!existingSupplier && !isPermissionAllowedSync(auth.user.role, 'suppliers.manage')) {
        return NextResponse.json(
          { error: 'Ask an admin to add this supplier or grant supplier-management permission.' },
          { status: 403 }
        );
      }
    }

    const purchase = await updatePurchase(db, id, {
      ...data,
      // Cashiers cannot re-attribute a historical delivery to another user.
      received_by: auth.user?.role === 'cashier' ? undefined : data.received_by ?? auth.user?.id ?? null,
    });
    return NextResponse.json({ message: 'Purchase updated and stock re-applied.', purchase });
  } catch (error) {
    return handleRouteError(error, 'Failed to update purchase');
  }
}

/**
 * DELETE voids by default — the stock is reversed, the linked expense is
 * removed and the record is kept for audit. ?hard=1 only succeeds on a draft
 * or already-voided purchase.
 */
export async function DELETE(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'purchases.void' });
    if (auth.error) return auth.error;

    const { id } = await params;
    const q = new URL(request.url).searchParams;
    const db = Database.getInstance();
    await ensureRecipeTables(db);

    if (q.get('hard') === '1') {
      if (auth.user.role !== 'admin') {
        return NextResponse.json({ error: 'Only an admin can permanently delete a purchase record.' }, { status: 403 });
      }
      return NextResponse.json(await deletePurchase(db, id));
    }

    const purchase = await voidPurchase(db, id, {
      reason: q.get('reason'),
      performedBy: auth.user?.id || null,
    });
    return NextResponse.json({ message: 'Purchase voided and stock reversed.', purchase });
  } catch (error) {
    return handleRouteError(error, 'Failed to void purchase');
  }
}

import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureRecipeTables } from '@/lib/recipes.js';
import { listStockMovements } from '@/lib/stock-movements.js';
import { readListParams } from '@/lib/paginate.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;

    const db = Database.getInstance();
    await ensureRecipeTables(db);

    const { searchParams } = new URL(request.url);
    const { rows, pagination } = await listStockMovements(db, {
      ...readListParams(searchParams),
      inventoryItemId: searchParams.get('item_id') || undefined,
      changeType: searchParams.get('change_type'),
      varianceOnly: searchParams.get('variance_only') === '1',
      pricedOnly: searchParams.get('priced_only') === '1',
      from: searchParams.get('from'),
      to: searchParams.get('to'),
    });

    return NextResponse.json({ movements: rows, pagination });
  } catch (error) {
    return handleRouteError(error, 'Failed to load stock movement history');
  }
}

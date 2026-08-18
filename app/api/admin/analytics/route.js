import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { resolvePeriodRange } from '@/lib/report-dates.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureColumn } from '@/lib/db/schema-helpers.js';
import { DEFAULT_FOOD_GROUP } from '@/lib/food-groups.js';
import { composeAnalytics, transactionReport } from '@/lib/analytics.js';
import { currentBusinessDay, businessDaySummary } from '@/lib/business-days.js';

/**
 * GET /api/admin/analytics
 * Restaurant Analytics dashboard data. Server-derived, void-excluded,
 * reconciles with the ledger. Read-only.
 *
 * Query: period=today|yesterday|last3|last7|last30|this_week|this_month|
 *        last_month|custom, startDate, endDate.
 */
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const range = resolvePeriodRange(
      searchParams.get('period') || 'today',
      searchParams.get('startDate'),
      searchParams.get('endDate')
    );

    const filters = {
      categoryId: Number(searchParams.get('categoryId')) || null,
      paymentMethod: searchParams.get('paymentMethod') || null,
      orderType: searchParams.get('orderType') || null,
    };

    const db = Database.getInstance();
    const activeDay = range.period === 'today' ? await currentBusinessDay(db) : null;
    const businessDayId = activeDay?.id || null;
    const activeDaySummary = activeDay ? await businessDaySummary(db, activeDay) : null;
    if (activeDay) {
      range.label = `Current Business Day · ${activeDay.business_date}`;
      range.businessDayId = activeDay.id;
    }
    await ensureColumn(db, 'menu_categories', 'food_group', `TEXT DEFAULT '${DEFAULT_FOOD_GROUP}'`);
    if (searchParams.get('export') === 'transactions') {
      const transactions = await transactionReport(db, range, { exportAll: true, businessDayId });
      return NextResponse.json({ range, businessDay: activeDay, transactions });
    }
    const data = await composeAnalytics(db, range, filters, {
      transactions: {
        page: Number(searchParams.get('transactionPage')) || 1,
        pageSize: Number(searchParams.get('transactionPageSize')) || 25,
      },
      businessDayId,
    });
    return NextResponse.json({ ...data, businessDay: activeDay, businessDayMetrics: activeDaySummary ? {
      openingCash: activeDaySummary.store_session?.opening_cash ?? activeDay.opening_cash,
      expectedCash: activeDaySummary.cash.expected_cash,
      sales: activeDaySummary.sales.billed_total,
      collections: activeDaySummary.collections.total_collected,
      sessionNumber: activeDaySummary.store_session?.session_number || null,
    } : null });
  } catch (error) {
    return handleRouteError(error, 'Failed to build analytics.');
  }
}

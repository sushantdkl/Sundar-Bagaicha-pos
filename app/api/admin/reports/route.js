import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { resolvePeriodRange } from '@/lib/report-dates.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureColumn } from '@/lib/db/schema-helpers.js';
import { DEFAULT_FOOD_GROUP } from '@/lib/food-groups.js';
import { buildReport, getFilterOptions, REPORT_TABS } from '@/lib/reports.js';
import { ensureBusinessDaySchema } from '@/lib/business-days.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const requested = (searchParams.get('tab') || 'overview').toLowerCase();
    const tab = REPORT_TABS.includes(requested) ? requested : 'overview';

    const range = resolvePeriodRange(
      searchParams.get('period') || 'week',
      searchParams.get('startDate'),
      searchParams.get('endDate')
    );

    const filters = {
      businessDayId: Number(searchParams.get('businessDayId')) || null,
      employeeId: Number(searchParams.get('employeeId')) || null,
      categoryId: Number(searchParams.get('categoryId')) || null,
      foodGroup: searchParams.get('foodGroup') || null,
      paymentMethod: searchParams.get('paymentMethod') || null,
      orderType: searchParams.get('orderType') || null,
      search: (searchParams.get('search') || '').trim() || null,
      // export=1 lifts the detail-table cap so a download is the complete set,
      // not the first 500 rows the screen happened to show.
      exportAll: searchParams.get('export') === '1',
      detailLimit: Number(searchParams.get('detail_limit')) || null,
    };

    const db = Database.getInstance();
    await ensureBusinessDaySchema(db);
    if (filters.businessDayId) {
      const day = await db.get('SELECT id,business_date,status,opened_at,closed_at FROM business_days WHERE id=?', [filters.businessDayId]);
      if (!day) return NextResponse.json({ error: 'Business day not found.' }, { status: 404 });
      range.start = String(day.business_date).slice(0, 10);
      range.end = range.start;
      range.period = 'business_day';
      range.label = `Business Day · ${range.start}${day.status === 'open' ? ' · Open' : ''}`;
      range.businessDayId = day.id;
    }
    // The master-category column is created on demand so older databases keep working.
    await ensureColumn(db, 'menu_categories', 'food_group', `TEXT DEFAULT '${DEFAULT_FOOD_GROUP}'`);
    await ensureColumn(db, 'orders', 'party_label', 'TEXT').catch(() => {});
    await ensureColumn(db, 'orders', 'cancel_reason', 'TEXT').catch(() => {});
    await ensureColumn(db, 'orders', 'cancelled_at', db.driver === 'postgres' ? 'TIMESTAMP' : 'DATETIME').catch(() => {});
    await ensureColumn(db, 'bills', 'void_reason', 'TEXT').catch(() => {});
    await ensureColumn(db, 'bills', 'voided_at', db.driver === 'postgres' ? 'TIMESTAMP' : 'DATETIME').catch(() => {});
    await ensureColumn(db, 'kots', 'void_reason', 'TEXT').catch(() => {});
    await ensureColumn(db, 'kots', 'voided_at', db.driver === 'postgres' ? 'TIMESTAMP' : 'DATETIME').catch(() => {});
    await ensureColumn(db, 'kots', 'cancel_reason', 'TEXT').catch(() => {});
    await ensureColumn(db, 'kots', 'cancelled_at', db.driver === 'postgres' ? 'TIMESTAMP' : 'DATETIME').catch(() => {});
    await ensureColumn(db, 'kots', 'cancelled_by', 'INTEGER').catch(() => {});
    await ensureColumn(db, 'kots', 'previous_status', 'TEXT').catch(() => {});
    await ensureColumn(db, 'expenses', 'payment_method', "TEXT DEFAULT 'cash'").catch(() => {});
    await ensureColumn(db, 'expenses', 'logged_by', 'INTEGER').catch(() => {});
    const [data, options] = await Promise.all([
      buildReport(db, tab, range, filters),
      searchParams.get('withOptions') === '1' ? getFilterOptions(db) : Promise.resolve(null),
    ]);

    return NextResponse.json({ tab, range, filters, ...data, ...(options ? { options } : {}) });
  } catch (error) {
    return handleRouteError(error, 'Failed to build the report.');
  }
}

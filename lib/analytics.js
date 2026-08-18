/**
 * Aggregated restaurant management overview.
 *
 * Sales come from settled, non-voided bills; collections come from payment
 * rows; refunds come from the correction audit; finance comes from the ledger.
 * Live operational state is deliberately separated from period reporting.
 */

import { profitAndLoss, cashFlowStatement } from '@/lib/accounting-reports.js';
import { accountBalance } from '@/lib/accounting.js';
import { supplierPayables } from '@/lib/accounting-suppliers.js';
import { customerReceivables } from '@/lib/accounting-receivables.js';
import { nepalDateSql, nepalRangeUtcBounds, nepalDateString } from '@/lib/report-dates.js';
import { foodGroupLabel, foodGroupSql, normalizeFoodGroup } from '@/lib/food-groups.js';

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const round2 = (value) => Math.round((num(value) + Number.EPSILON) * 100) / 100;
const LIVE_ORDER = `COALESCE(status,'') NOT IN ('completed','cancelled')`;
const LIVE_ITEM = `COALESCE(oi.status,'') NOT IN ('voided','cancelled')`;
const SETTLED_BILL = `LOWER(COALESCE(b.status,'')) IN ('paid','partially_paid','reopened','refunded')`;
const FOOD_GROUP_EXPR = foodGroupSql('mc');
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function safe(promise, fallback) {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

function bounds(range, column) {
  const { startUtc, endUtcExclusive } = nepalRangeUtcBounds(range.start, range.end);
  return { sql: `${column} >= ? AND ${column} < ?`, params: [startUtc, endUtcExclusive] };
}

function businessScope(range, column, businessDayId, businessDayColumn) {
  return businessDayId
    ? { sql: `${businessDayColumn} = ?`, params: [businessDayId] }
    : bounds(range, column);
}

function shiftDate(date, days) {
  const cursor = new Date(`${date}T12:00:00+05:45`);
  cursor.setDate(cursor.getDate() + days);
  return nepalDateString(cursor);
}

function previousRange(range) {
  const start = new Date(`${range.start}T12:00:00+05:45`);
  const end = new Date(`${range.end}T12:00:00+05:45`);
  const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
  return {
    start: shiftDate(range.start, -days),
    end: shiftDate(range.start, -1),
    label: 'Previous equivalent period',
  };
}

function comparison(current, previous) {
  const absolute = round2(current - previous);
  const percent = previous === 0 ? null : round2((absolute / Math.abs(previous)) * 100);
  return { previous: round2(previous), absolute, percent };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function labelize(value) {
  return String(value || 'other').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

async function salesAggregate(db, range, businessDayId = null) {
  const period = businessScope(range, 'COALESCE(b.paid_at,b.created_at)', businessDayId, 'b.business_day_id');
  const correctionPeriod = businessScope(range, 'bc.created_at', businessDayId, 'bc.business_day_id');
  const [bill, refund] = await Promise.all([
    safe(db.get(
      `SELECT COUNT(DISTINCT b.id) AS bills,
              COALESCE(SUM(b.subtotal),0) AS item_sales,
              COALESCE(SUM(b.grand_total+COALESCE(b.discount_amount,0)),0) AS gross_sales,
              COALESCE(SUM(b.discount_amount),0) AS discounts,
              COALESCE(SUM(CASE WHEN COALESCE(b.vat_amount,0)<>0 THEN b.vat_amount ELSE COALESCE(b.tax,0) END),0) AS tax,
              COALESCE(SUM(b.service_charge),0) AS service_charge,
              COALESCE(SUM(b.grand_total),0) AS billed_total
       FROM bills b
       WHERE ${SETTLED_BILL} AND ${period.sql}`,
      period.params
    ), {}),
    safe(db.get(
      `SELECT COALESCE(SUM(bc.amount),0) AS amount, COUNT(*) AS count
       FROM bill_corrections bc
       WHERE bc.type = 'refund' AND ${correctionPeriod.sql}`,
      correctionPeriod.params
    ), {}),
  ]);
  const grossSales = num(bill.gross_sales);
  const itemSales = num(bill.item_sales);
  const discounts = num(bill.discounts);
  const refunds = num(refund.amount);
  return {
    bills: num(bill.bills), grossSales, itemSales, discounts, refunds,
    netSales: round2(num(bill.billed_total) - refunds),
    tax: num(bill.tax), serviceCharge: num(bill.service_charge),
    billedTotal: num(bill.billed_total), refundCount: num(refund.count),
  };
}

function makeKpi(key, label, value, format, previous, tone, note) {
  return {
    key, label, value: round2(value), format,
    ...(previous == null ? {} : { comparison: comparison(value, previous) }),
    ...(tone ? { tone } : {}),
    ...(note ? { note } : {}),
  };
}

function paymentLabel(row) {
  const cash = num(row.cash_amount);
  const qr = num(row.qr_amount);
  const credit = num(row.credit_amount);
  const active = [cash > 0 && 'Cash', qr > 0 && 'Online / QR', credit > 0 && 'Credit'].filter(Boolean);
  return active.length > 1 ? `Split (${active.join(' + ')})` : active[0] || labelize(row.payment_methods || 'Not recorded');
}

function transactionPaymentSql(field) {
  return `SELECT ${field}
    FROM (
      SELECT bpa.method, bpa.amount, bpa.provider, bpa.reference_number
      FROM bill_payment_allocations bpa
      WHERE bpa.bill_id = b.id
      UNION ALL
      SELECT bp.payment_method AS method, bp.amount, bp.provider, bp.reference_number
      FROM bill_payments bp
      WHERE bp.bill_id = b.id
        AND NOT EXISTS (SELECT 1 FROM bill_payment_allocations ba2 WHERE ba2.bill_id = b.id)
    ) pay`;
}

function transactionCategorySql(groupId) {
  return `SELECT COALESCE(SUM(amount),0)
    FROM (
      SELECT ${FOOD_GROUP_EXPR} AS food_group,
             COALESCE(oi.subtotal, oi.quantity * COALESCE(oi.price,0)) AS amount
      FROM order_items oi
      LEFT JOIN menu_items mi ON mi.id = COALESCE(oi.menu_item_id, oi.item_id)
      LEFT JOIN menu_categories mc ON mc.id = mi.category_id
      WHERE oi.order_id = o.id AND ${LIVE_ITEM}
    ) item_groups
    WHERE food_group = '${groupId}'`;
}

function normalizeTransactionRow(row) {
  return {
    ...row,
    subtotal: round2(row.subtotal),
    discount_amount: round2(row.discount_amount),
    tax: round2(row.tax),
    service_charge: round2(row.service_charge),
    cash_amount: round2(row.cash_amount),
    qr_amount: round2(row.qr_amount),
    credit_amount: round2(row.credit_amount),
    food_amount: round2(row.food_amount),
    beverage_amount: round2(row.beverage_amount),
    tobacco_amount: round2(row.tobacco_amount),
    other_amount: round2(row.other_amount),
    grand_total: round2(row.grand_total),
    final_total: round2(row.grand_total),
    payment: paymentLabel(row),
    qr_type: row.qr_type || 'Not recorded',
  };
}

export async function transactionReport(db, range, { page = 1, pageSize = 25, exportAll = false, businessDayId = null } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(200, Math.max(10, Number(pageSize) || 25));
  const offset = (safePage - 1) * safePageSize;
  const billPeriod = businessScope(range, 'COALESCE(b.paid_at,b.created_at)', businessDayId, 'b.business_day_id');
  const limitSql = exportAll ? '' : `LIMIT ${safePageSize} OFFSET ${offset}`;

  const [countRow, rows] = await Promise.all([
    safe(db.get(
      `SELECT COUNT(DISTINCT b.id) AS total
       FROM bills b JOIN orders o ON o.id=b.order_id
       WHERE ${SETTLED_BILL} AND ${billPeriod.sql}`,
      billPeriod.params
    ), { total: 0 }),
    safe(db.all(
      `SELECT b.id,b.bill_number,b.created_at,b.paid_at,b.subtotal,b.discount_amount,
              CASE WHEN COALESCE(b.vat_amount,0)<>0 THEN b.vat_amount ELSE COALESCE(b.tax,0) END AS tax,
              b.service_charge,b.grand_total,o.order_number,o.table_number,o.order_type,o.customer_name,
              COALESCE(u.full_name,'Unassigned') AS cashier,
              COALESCE((${transactionPaymentSql("GROUP_CONCAT(method, ', ')")}), 'Not recorded') AS payment_methods,
              COALESCE((${transactionPaymentSql("SUM(CASE WHEN method='cash' THEN amount ELSE 0 END)")}),0) AS cash_amount,
              COALESCE((${transactionPaymentSql("SUM(CASE WHEN method='qr' THEN amount ELSE 0 END)")}),0) AS qr_amount,
              COALESCE((${transactionPaymentSql("SUM(CASE WHEN method='credit' THEN amount ELSE 0 END)")}),0) AS credit_amount,
              COALESCE((${transactionPaymentSql("GROUP_CONCAT(CASE WHEN method='qr' THEN provider END, ' / ')")}), 'Not recorded') AS qr_type,
              COALESCE((${transactionCategorySql('food')}),0) AS food_amount,
              COALESCE((${transactionCategorySql('beverage')}),0) AS beverage_amount,
              COALESCE((${transactionCategorySql('tobacco')}),0) AS tobacco_amount,
              COALESCE((${transactionCategorySql('other')}),0) AS other_amount
       FROM bills b JOIN orders o ON o.id=b.order_id LEFT JOIN users u ON u.id=b.cashier_id
       WHERE ${SETTLED_BILL} AND ${billPeriod.sql}
       ORDER BY COALESCE(b.paid_at,b.created_at) DESC,b.id DESC
       ${limitSql}`,
      billPeriod.params
    ), []),
  ]);

  const total = num(countRow.total);
  return {
    rows: rows.map(normalizeTransactionRow),
    pagination: exportAll ? null : {
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / safePageSize)),
    },
  };
}

export async function composeAnalytics(db, range, _filters = {}, options = {}) {
  const businessDayId = options.businessDayId || null;
  const previous = previousRange(range);
  const billPeriod = businessScope(range, 'COALESCE(b.paid_at,b.created_at)', businessDayId, 'b.business_day_id');
  const orderPeriod = businessScope(range, 'o.created_at', businessDayId, 'o.business_day_id');
  const kotPeriod = businessScope(range, 'k.printed_at', businessDayId, 'k.business_day_id');
  const paymentPeriod = businessScope(range, 'bp.created_at', businessDayId, 'bp.business_day_id');
  const movementPeriod = businessScope(range, 'sm.created_at', businessDayId, 'sm.business_day_id');
  const wastagePeriod = businessScope(range, 'w.created_at', businessDayId, 'w.business_day_id');
  const liveOrderWhere = businessDayId ? `${LIVE_ORDER} AND business_day_id = ?` : LIVE_ORDER;
  const liveOrderParams = businessDayId ? [businessDayId] : [];
  const liveKotWhere = businessDayId ? `COALESCE(k.status,'') IN ('pending','preparing','ready') AND k.business_day_id = ?` : `COALESCE(k.status,'') IN ('pending','preparing','ready')`;
  const liveKotParams = businessDayId ? [businessDayId] : [];
  const liveBillWhere = businessDayId
    ? `LOWER(COALESCE(b.status,'')) IN ('unpaid','open','pending','in_progress','reopened') AND b.business_day_id = ?`
    : `LOWER(COALESCE(b.status,'')) IN ('unpaid','open','pending','in_progress','reopened')`;
  const liveBillParams = businessDayId ? [businessDayId] : [];
  const dayExpr = nepalDateSql('COALESCE(b.paid_at,b.created_at)');
  const paymentHour = db.driver === 'postgres'
    ? `CAST(EXTRACT(HOUR FROM (bp.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kathmandu')) AS INTEGER)`
    : `CAST(strftime('%H', datetime(bp.created_at, '+5 hours', '+45 minutes')) AS INTEGER)`;
  const billHour = db.driver === 'postgres'
    ? `CAST(EXTRACT(HOUR FROM (COALESCE(b.paid_at,b.created_at) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kathmandu')) AS INTEGER)`
    : `CAST(strftime('%H', datetime(COALESCE(b.paid_at,b.created_at), '+5 hours', '+45 minutes')) AS INTEGER)`;
  const billDow = db.driver === 'postgres'
    ? `CAST(EXTRACT(DOW FROM (COALESCE(b.paid_at,b.created_at) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kathmandu')) AS INTEGER)`
    : `CAST(strftime('%w', datetime(COALESCE(b.paid_at,b.created_at), '+5 hours', '+45 minutes')) AS INTEGER)`;
  const prepMinutes = db.driver === 'postgres'
    ? `EXTRACT(EPOCH FROM (k.completed_at - k.printed_at)) / 60.0`
    : `(julianday(k.completed_at) - julianday(k.printed_at)) * 1440.0`;

  const [sales, previousSales] = await Promise.all([
    salesAggregate(db, range, businessDayId),
    salesAggregate(db, previous),
  ]);

  const [
    paymentRows, salesTrendRows, refundTrendRows, hourlyRows, salesHourlyRows,
    salesDowRows, groupRows, orderStatuses, kotStatuses, billControl,
    cancelledOrderValue, channelRows, itemRows, categoryRows, pairRows,
    itemTotals, kitchenRows, cancelledKotReasons, liveOrders, liveKots, liveBills,
    tableState, tableRows, inventorySummary, stockMovements, wastageSummary,
    purchaseSummary, supplierSpend, reservationStatuses, upcomingReservations,
    customerSummary, topCustomers, waiterRows, cashierRows, _recentTransactionsLegacy, recentKots,
    orderCancelReasons, voidReasons, recipeCoverage, openOrdersValueRow,
  ] = await Promise.all([
    safe(db.all(
      `SELECT method, COALESCE(SUM(amount),0) AS amount, COUNT(*) AS transactions
       FROM (
         SELECT LOWER(COALESCE(bpa.method,'other')) AS method, bpa.amount, bpa.created_at, bpa.business_day_id, COALESCE(bpa.settlement_status,'received') AS settlement_status
         FROM bill_payment_allocations bpa
         UNION ALL
         SELECT LOWER(COALESCE(bp.payment_method,'other')) AS method, bp.amount, bp.created_at, bp.business_day_id, COALESCE(bp.settlement_status,'received') AS settlement_status
         FROM bill_payments bp
         WHERE NOT EXISTS (SELECT 1 FROM bill_payment_allocations ba2 WHERE ba2.bill_id = bp.bill_id)
       ) payments
       WHERE ${businessScope(range, 'created_at', businessDayId, 'business_day_id').sql}
         AND LOWER(COALESCE(settlement_status,'received')) NOT IN ('cancelled','voided','failed')
       GROUP BY method ORDER BY amount DESC`,
      businessScope(range, 'created_at', businessDayId, 'business_day_id').params
    ), []),
    safe(db.all(
      `SELECT ${dayExpr} AS day, COALESCE(SUM(b.subtotal-b.discount_amount),0) AS net_sales,
              COALESCE(SUM(b.grand_total),0) AS billed, COUNT(DISTINCT b.id) AS bills
       FROM bills b WHERE ${SETTLED_BILL} AND ${billPeriod.sql}
       GROUP BY ${dayExpr} ORDER BY day`,
      billPeriod.params
    ), []),
    safe(db.all(
      `SELECT ${nepalDateSql('bc.created_at')} AS day, COALESCE(SUM(bc.amount),0) AS refunds
       FROM bill_corrections bc WHERE bc.type='refund'
         AND ${businessScope(range, 'bc.created_at', businessDayId, 'bc.business_day_id').sql}
       GROUP BY ${nepalDateSql('bc.created_at')}`,
      businessScope(range, 'bc.created_at', businessDayId, 'bc.business_day_id').params
    ), []),
    safe(db.all(
      `SELECT ${paymentHour} AS hour, COALESCE(SUM(bp.amount),0) AS sales, COUNT(*) AS payments
       FROM bill_payments bp WHERE ${paymentPeriod.sql}
       GROUP BY ${paymentHour} ORDER BY hour`,
      paymentPeriod.params
    ), []),
    safe(db.all(
      `SELECT ${billHour} AS hour, COALESCE(SUM(b.grand_total),0) AS sales, COUNT(DISTINCT b.id) AS bills
       FROM bills b WHERE ${SETTLED_BILL} AND ${billPeriod.sql}
       GROUP BY ${billHour} ORDER BY hour`,
      billPeriod.params
    ), []),
    safe(db.all(
      `SELECT ${billDow} AS dow, COALESCE(SUM(b.grand_total),0) AS sales
       FROM bills b WHERE ${SETTLED_BILL} AND ${billPeriod.sql}
       GROUP BY ${billDow} ORDER BY dow`,
      billPeriod.params
    ), []),
    safe(db.all(
      `SELECT ${FOOD_GROUP_EXPR} AS food_group,
              COALESCE(SUM(oi.subtotal),0) AS revenue,
              COALESCE(SUM(oi.quantity),0) AS quantity
       FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN bills b ON b.order_id=o.id
       LEFT JOIN menu_items mi ON mi.id=COALESCE(oi.menu_item_id,oi.item_id)
       LEFT JOIN menu_categories mc ON mc.id=mi.category_id
       WHERE ${SETTLED_BILL} AND ${billPeriod.sql} AND ${LIVE_ITEM}
       GROUP BY ${FOOD_GROUP_EXPR} ORDER BY revenue DESC`,
      billPeriod.params
    ), []),
    safe(db.all(
      `SELECT COALESCE(o.status,'pending') AS status, COUNT(*) AS count
       FROM orders o WHERE ${orderPeriod.sql} GROUP BY COALESCE(o.status,'pending')`,
      orderPeriod.params
    ), []),
    safe(db.all(
      `SELECT COALESCE(k.status,'pending') AS status, COUNT(*) AS count
       FROM kots k WHERE ${kotPeriod.sql} GROUP BY COALESCE(k.status,'pending')`,
      kotPeriod.params
    ), []),
    safe(db.get(
      `SELECT SUM(CASE WHEN LOWER(COALESCE(b.status,'')) IN ('void','voided','cancelled','canceled') THEN 1 ELSE 0 END) AS voided,
              COALESCE(SUM(CASE WHEN LOWER(COALESCE(b.status,'')) IN ('void','voided','cancelled','canceled') THEN b.grand_total ELSE 0 END),0) AS voided_value,
              SUM(CASE WHEN COALESCE(b.discount_amount,0)>0 THEN 1 ELSE 0 END) AS discounted_bills
       FROM bills b WHERE ${businessScope(range, 'b.created_at', businessDayId, 'b.business_day_id').sql}`,
      businessScope(range, 'b.created_at', businessDayId, 'b.business_day_id').params
    ), {}),
    safe(db.get(
      `SELECT COUNT(DISTINCT o.id) AS orders,
              COALESCE(SUM(COALESCE(oi.subtotal, oi.quantity * COALESCE(oi.price,0))),0) AS value
       FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id
       WHERE ${orderPeriod.sql} AND o.status='cancelled'`,
      orderPeriod.params
    ), {}),
    safe(db.all(
      `SELECT CASE
          WHEN COALESCE(o.order_number,'') LIKE 'WEB-%' THEN 'online ordering'
          WHEN COALESCE(o.order_type,'')='delivery' THEN 'delivery'
          WHEN o.table_id IS NULL AND NULLIF(TRIM(COALESCE(o.table_number,'')),'') IS NULL THEN 'takeaway'
          ELSE 'dine in' END AS channel,
        COUNT(DISTINCT b.id) AS orders, COALESCE(SUM(b.grand_total),0) AS sales
       FROM bills b JOIN orders o ON o.id=b.order_id
       WHERE ${SETTLED_BILL} AND ${billPeriod.sql}
       GROUP BY CASE
          WHEN COALESCE(o.order_number,'') LIKE 'WEB-%' THEN 'online ordering'
          WHEN COALESCE(o.order_type,'')='delivery' THEN 'delivery'
          WHEN o.table_id IS NULL AND NULLIF(TRIM(COALESCE(o.table_number,'')),'') IS NULL THEN 'takeaway'
          ELSE 'dine in' END ORDER BY sales DESC`,
      billPeriod.params
    ), []),
    safe(db.all(
      `SELECT COALESCE(oi.item_name,mi.name,'Item') AS item, COALESCE(mc.name,'Uncategorised') AS category,
              COALESCE(SUM(oi.quantity),0) AS quantity, COALESCE(SUM(oi.subtotal),0) AS revenue,
              COUNT(DISTINCT o.id) AS orders
       FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN bills b ON b.order_id=o.id
       LEFT JOIN menu_items mi ON mi.id=COALESCE(oi.menu_item_id,oi.item_id)
       LEFT JOIN menu_categories mc ON mc.id=mi.category_id
       WHERE ${SETTLED_BILL} AND ${billPeriod.sql} AND ${LIVE_ITEM}
       GROUP BY COALESCE(oi.item_name,mi.name,'Item'),COALESCE(mc.name,'Uncategorised')
       ORDER BY revenue DESC`,
      billPeriod.params
    ), []),
    safe(db.all(
      `SELECT COALESCE(mc.name,'Uncategorised') AS category,
              COALESCE(SUM(oi.quantity),0) AS quantity, COALESCE(SUM(oi.subtotal),0) AS revenue,
              COUNT(DISTINCT o.id) AS orders
       FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN bills b ON b.order_id=o.id
       LEFT JOIN menu_items mi ON mi.id=COALESCE(oi.menu_item_id,oi.item_id)
       LEFT JOIN menu_categories mc ON mc.id=mi.category_id
       WHERE ${SETTLED_BILL} AND ${billPeriod.sql} AND ${LIVE_ITEM}
       GROUP BY COALESCE(mc.name,'Uncategorised') ORDER BY revenue DESC`,
      billPeriod.params
    ), []),
    safe(db.all(
      `SELECT CASE WHEN a.item_name < z.item_name THEN a.item_name ELSE z.item_name END AS item_a,
              CASE WHEN a.item_name < z.item_name THEN z.item_name ELSE a.item_name END AS item_b,
              COUNT(DISTINCT a.order_id) AS orders
       FROM order_items a JOIN order_items z ON z.order_id=a.order_id AND z.id>a.id
       JOIN bills b ON b.order_id=a.order_id
       WHERE ${SETTLED_BILL} AND ${billPeriod.sql}
         AND COALESCE(a.status,'') NOT IN ('voided','cancelled')
         AND COALESCE(z.status,'') NOT IN ('voided','cancelled')
         AND COALESCE(a.item_name,'')<>COALESCE(z.item_name,'')
       GROUP BY CASE WHEN a.item_name < z.item_name THEN a.item_name ELSE z.item_name END,
                CASE WHEN a.item_name < z.item_name THEN z.item_name ELSE a.item_name END
       ORDER BY orders DESC LIMIT 8`,
      billPeriod.params
    ), []),
    safe(db.get(
      `SELECT COALESCE(SUM(oi.quantity),0) AS items, COUNT(DISTINCT oi.order_id) AS orders
       FROM order_items oi JOIN bills b ON b.order_id=oi.order_id
       WHERE ${SETTLED_BILL} AND ${billPeriod.sql} AND ${LIVE_ITEM}`,
      billPeriod.params
    ), {}),
    safe(db.all(
      `SELECT k.id,k.kot_number,k.status,k.printed_at,k.completed_at,k.cancelled_at,
              k.table_number,o.order_number,COUNT(ki.id) AS item_count,${prepMinutes} AS prep_minutes
       FROM kots k JOIN orders o ON o.id=k.order_id LEFT JOIN kot_items ki ON ki.kot_id=k.id
       WHERE ${kotPeriod.sql}
       GROUP BY k.id,k.kot_number,k.status,k.printed_at,k.completed_at,k.cancelled_at,k.table_number,o.order_number
       ORDER BY k.printed_at DESC`,
      kotPeriod.params
    ), []),
    safe(db.all(
      `SELECT COALESCE(NULLIF(k.cancel_reason,''),NULLIF(k.void_reason,''),'No reason recorded') AS reason,
              COUNT(*) AS count
       FROM kots k WHERE ${businessScope(range, 'COALESCE(k.cancelled_at,k.voided_at,k.printed_at)', businessDayId, 'k.business_day_id').sql}
         AND (COALESCE(k.status,'')='cancelled' OR COALESCE(k.voided,0)=1 OR COALESCE(k.kot_type,'')='cancellation')
       GROUP BY COALESCE(NULLIF(k.cancel_reason,''),NULLIF(k.void_reason,''),'No reason recorded')
       ORDER BY count DESC`,
      businessScope(range, 'COALESCE(k.cancelled_at,k.voided_at,k.printed_at)', businessDayId, 'k.business_day_id').params
    ), []),
    safe(db.all(`SELECT id,order_number,status,table_number,order_type,created_at,updated_at FROM orders WHERE ${liveOrderWhere} ORDER BY updated_at DESC LIMIT 30`, liveOrderParams), []),
    safe(db.all(`SELECT k.id,k.kot_number,k.status,k.printed_at,k.started_at,k.table_number,o.order_number FROM kots k JOIN orders o ON o.id=k.order_id WHERE ${liveKotWhere} ORDER BY k.printed_at LIMIT 30`, liveKotParams), []),
    safe(db.all(`SELECT b.id,b.bill_number,b.grand_total,b.created_at,o.order_number,o.table_number FROM bills b JOIN orders o ON o.id=b.order_id WHERE ${liveBillWhere} ORDER BY b.created_at LIMIT 30`, liveBillParams), []),
    safe(db.all(`SELECT id,table_number,status,capacity FROM tables WHERE COALESCE(is_active,1)=1 ORDER BY table_number`), []),
    safe(db.all(
      `SELECT COALESCE(o.table_number,'—') AS table_number,COUNT(DISTINCT b.id) AS orders,
              COALESCE(SUM(b.grand_total),0) AS revenue,COALESCE(AVG(b.grand_total),0) AS average_bill,
              AVG(CASE WHEN b.paid_at IS NOT NULL THEN ${db.driver === 'postgres' ? `EXTRACT(EPOCH FROM (b.paid_at-o.created_at))/60.0` : `(julianday(b.paid_at)-julianday(o.created_at))*1440.0`} END) AS dining_minutes
       FROM bills b JOIN orders o ON o.id=b.order_id
       WHERE ${SETTLED_BILL} AND ${billPeriod.sql} AND o.table_id IS NOT NULL
       GROUP BY COALESCE(o.table_number,'—') ORDER BY revenue DESC`,
      billPeriod.params
    ), []),
    safe(db.get(
      `SELECT COALESCE(SUM(quantity*cost_per_unit),0) AS value,
              SUM(CASE WHEN quantity<=0 THEN 1 ELSE 0 END) AS out_count,
              SUM(CASE WHEN quantity>0 AND quantity<=COALESCE(min_stock_level,min_stock,0) THEN 1 ELSE 0 END) AS low_count
       FROM inventory_items WHERE COALESCE(is_archived,0)=0`,
    ), {}),
    safe(db.all(
      `SELECT sm.change_type,COUNT(*) AS entries,COALESCE(SUM(ABS(sm.quantity_changed)*COALESCE(sm.unit_cost,ii.cost_per_unit,0)),0) AS value
       FROM stock_movements sm LEFT JOIN inventory_items ii ON ii.id=sm.inventory_item_id
       WHERE ${movementPeriod.sql} GROUP BY sm.change_type`,
      movementPeriod.params
    ), []),
    safe(db.get(
      `SELECT COUNT(*) AS entries,COALESCE(SUM(COALESCE(w.total_cost,w.quantity*ii.cost_per_unit,0)),0) AS value
       FROM wastage_log w LEFT JOIN inventory_items ii ON ii.id=w.raw_material_id
       WHERE ${wastagePeriod.sql}`,
      wastagePeriod.params
    ), {}),
    safe(db.get(`SELECT COUNT(*) AS count,COALESCE(SUM(total),0) AS value FROM purchases WHERE COALESCE(status,'received')<>'voided' AND invoice_date BETWEEN ? AND ?`, [range.start, range.end]), {}),
    safe(db.all(`SELECT COALESCE(s.name,p.supplier,'Unattributed') AS supplier,COUNT(*) AS purchases,COALESCE(SUM(p.total),0) AS spend FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE COALESCE(p.status,'received')<>'voided' AND p.invoice_date BETWEEN ? AND ? GROUP BY COALESCE(s.name,p.supplier,'Unattributed') ORDER BY spend DESC LIMIT 6`, [range.start, range.end]), []),
    safe(db.all(`SELECT COALESCE(status,'new') AS status,COUNT(*) AS count,COALESCE(SUM(party_size),0) AS guests FROM reservations WHERE date BETWEEN ? AND ? GROUP BY COALESCE(status,'new')`, [range.start, range.end]), []),
    safe(db.all(`SELECT r.id,r.name,r.date,r.time,r.party_size,r.status,t.table_number FROM reservations r LEFT JOIN tables t ON t.id=r.table_id WHERE r.date>=? AND r.status IN ('new','confirmed','arrived') ORDER BY r.date,r.time LIMIT 6`, [nepalDateString()]), []),
    safe(db.get(
      `SELECT COUNT(DISTINCT CASE WHEN o.customer_id IS NOT NULL THEN o.customer_id END) AS identified,
              SUM(CASE WHEN o.customer_id IS NULL THEN 1 ELSE 0 END) AS anonymous_bills,
              COALESCE(AVG(CASE WHEN o.customer_id IS NOT NULL THEN b.grand_total END),0) AS avg_spend
       FROM bills b JOIN orders o ON o.id=b.order_id WHERE ${SETTLED_BILL} AND ${billPeriod.sql}`,
      billPeriod.params
    ), {}),
    safe(db.all(
      `SELECT c.id,c.name,COUNT(DISTINCT b.id) AS bills,COALESCE(SUM(b.grand_total),0) AS spend
       FROM customers c JOIN orders o ON o.customer_id=c.id JOIN bills b ON b.order_id=o.id
       WHERE ${SETTLED_BILL} AND ${billPeriod.sql}
       GROUP BY c.id,c.name ORDER BY spend DESC LIMIT 6`,
      billPeriod.params
    ), []),
    safe(db.all(
      `SELECT u.full_name AS name,COUNT(DISTINCT b.id) AS orders,COALESCE(SUM(b.grand_total),0) AS sales,
              COALESCE(AVG(b.grand_total),0) AS average_order
       FROM bills b JOIN orders o ON o.id=b.order_id JOIN users u ON u.id=o.waiter_id
       WHERE ${SETTLED_BILL} AND ${billPeriod.sql} GROUP BY u.id,u.full_name ORDER BY sales DESC LIMIT 8`,
      billPeriod.params
    ), []),
    safe(db.all(
      `SELECT u.full_name AS name,COUNT(DISTINCT b.id) AS bills,COALESCE(SUM(b.grand_total),0) AS collections
       FROM bills b JOIN users u ON u.id=b.cashier_id
       WHERE ${SETTLED_BILL} AND ${billPeriod.sql} GROUP BY u.id,u.full_name ORDER BY collections DESC LIMIT 8`,
      billPeriod.params
    ), []),
    safe(db.all(
      `SELECT b.id,b.bill_number,b.created_at,b.paid_at,b.subtotal,b.discount_amount,b.tax,b.service_charge,b.grand_total,
              o.order_number,o.table_number,o.order_type,o.customer_name,
              COALESCE(u.full_name,'Unassigned') AS cashier,
              CASE WHEN (SELECT COUNT(*) FROM bill_payments bp2 WHERE bp2.bill_id=b.id)>1 THEN 'split'
                   ELSE COALESCE((SELECT bp3.payment_method FROM bill_payments bp3 WHERE bp3.bill_id=b.id ORDER BY bp3.id DESC LIMIT 1),'—') END AS payment
       FROM bills b JOIN orders o ON o.id=b.order_id LEFT JOIN users u ON u.id=b.cashier_id
       WHERE ${SETTLED_BILL} AND ${billPeriod.sql} ORDER BY COALESCE(b.paid_at,b.created_at) DESC LIMIT 10`,
      billPeriod.params
    ), []),
    safe(db.all(
      `SELECT k.kot_number,k.status,k.printed_at,k.completed_at,k.cancelled_at,k.cancel_reason,k.table_number,
              o.order_number,COUNT(ki.id) AS item_count,${prepMinutes} AS prep_minutes
       FROM kots k JOIN orders o ON o.id=k.order_id LEFT JOIN kot_items ki ON ki.kot_id=k.id
       WHERE ${kotPeriod.sql} GROUP BY k.id,k.kot_number,k.status,k.printed_at,k.completed_at,k.cancelled_at,k.cancel_reason,k.table_number,o.order_number
       ORDER BY k.printed_at DESC LIMIT 10`,
      kotPeriod.params
    ), []),
    safe(db.all(`SELECT COALESCE(NULLIF(cancel_reason,''),'No reason recorded') AS reason,COUNT(*) AS count FROM orders o WHERE ${orderPeriod.sql} AND o.status='cancelled' GROUP BY COALESCE(NULLIF(cancel_reason,''),'No reason recorded') ORDER BY count DESC`, orderPeriod.params), []),
    safe(db.all(`SELECT COALESCE(NULLIF(void_reason,''),'No reason recorded') AS reason,COUNT(*) AS count FROM bills b WHERE ${businessScope(range, 'COALESCE(b.voided_at,b.created_at)', businessDayId, 'b.business_day_id').sql} AND LOWER(COALESCE(status,'')) IN ('void','voided','cancelled','canceled') GROUP BY COALESCE(NULLIF(void_reason,''),'No reason recorded') ORDER BY count DESC`, businessScope(range, 'COALESCE(b.voided_at,b.created_at)', businessDayId, 'b.business_day_id').params), []),
    safe(db.get(`SELECT (SELECT COUNT(*) FROM menu_items WHERE COALESCE(is_available,1)=1) AS menu_items,(SELECT COUNT(*) FROM recipes WHERE menu_item_id IS NOT NULL) AS recipes`), {}),
    // Value still sitting on open tables/orders — not yet billed or paid, so it's
    // excluded from every settled-sales figure above by design. Surfaced
    // separately so "Total Sales" stays real, realized money.
    safe(db.get(
      `SELECT COUNT(DISTINCT o.id) AS orders, COALESCE(SUM(oi.subtotal),0) AS value
       FROM orders o JOIN order_items oi ON oi.order_id=o.id
       WHERE COALESCE(o.status,'') NOT IN ('completed','cancelled') AND ${businessDayId ? 'o.business_day_id = ?' : '1=1'}
         AND COALESCE(oi.status,'') NOT IN ('voided','cancelled')`,
      businessDayId ? [businessDayId] : []
    ), { orders: 0, value: 0 }),
  ]);

  const [pnl, previousPnl, cashFlow, cashBalance, bankBalance, arBalance, payables, receivables] = await Promise.all([
    safe(profitAndLoss(db, { from: range.start, to: range.end, businessDayId }), { income: [], expense: [], totalIncome: 0, totalExpense: 0, netProfit: 0 }),
    safe(profitAndLoss(db, { from: previous.start, to: previous.end }), { income: [], expense: [], totalIncome: 0, totalExpense: 0, netProfit: 0 }),
    safe(cashFlowStatement(db, { from: range.start, to: range.end, businessDayId }), { operating: { net: 0 }, investing: { net: 0 }, financing: { net: 0 }, netChange: 0 }),
    safe(accountBalance(db, '1010'), 0),
    safe(accountBalance(db, '1020'), 0),
    safe(accountBalance(db, '1300'), 0),
    safe(supplierPayables(db), []),
    safe(customerReceivables(db), []),
  ]);

  const [voidCorrection, creditCollectionsRow, openingBalanceRow, savingsDepositRow] = await Promise.all([
    safe(db.get(
      `SELECT COALESCE(SUM(bc.amount),0) AS amount,COUNT(*) AS count
       FROM bill_corrections bc WHERE bc.type='void'
         AND ${businessScope(range, 'bc.created_at', businessDayId, 'bc.business_day_id').sql}`,
      businessScope(range, 'bc.created_at', businessDayId, 'bc.business_day_id').params
    ), {}),
    safe(db.get(
      `SELECT COALESCE(SUM(credit),0) AS amount
       FROM customer_ledger
       WHERE ${businessScope(range, 'created_at', businessDayId, 'business_day_id').sql} AND entry_type='credit_payment'`,
      businessScope(range, 'created_at', businessDayId, 'business_day_id').params
    ), {}),
    businessDayId
      ? safe(db.get(
        `SELECT COALESCE(opening_cash,0) AS amount
         FROM business_day_sessions
         WHERE business_day_id=? ORDER BY session_number DESC,id DESC LIMIT 1`,
        [businessDayId]
      ), {})
      : safe(db.get(
        `SELECT COALESCE(SUM(jl.debit-jl.credit),0) AS amount
         FROM journal_lines jl
         JOIN journal_entries je ON je.id=jl.journal_id
         JOIN accounts a ON a.id=jl.account_id
         WHERE a.code='1010' AND je.entry_date < ?`,
        [range.start]
      ), {}),
    safe(db.get(
      `SELECT COALESCE(SUM(amount),0) AS amount,COUNT(*) AS count
       FROM savings_deposits
       WHERE status='active' AND deposit_date BETWEEN ? AND ?`,
      [range.start, range.end]
    ), {}),
  ]);

  const paymentMethods = paymentRows.map((row) => ({
    method: row.method, label: labelize(row.method), amount: round2(row.amount), transactions: num(row.transactions),
  }));
  const grossCollected = round2(paymentMethods.reduce((sum, row) => sum + row.amount, 0));
  const cashCollected = round2(paymentMethods.filter((row) => row.method === 'cash').reduce((sum, row) => sum + row.amount, 0));
  const onlineCollected = round2(paymentMethods.filter((row) => row.method !== 'cash' && !['credit','due','unpaid'].includes(row.method)).reduce((sum, row) => sum + row.amount, 0));
  const voidReversals = round2(voidCorrection.amount);
  const netCollections = round2(grossCollected - sales.refunds - voidReversals);

  const refundsByDay = new Map(refundTrendRows.map((row) => [String(row.day), num(row.refunds)]));
  const salesTrend = salesTrendRows.map((row) => ({
    label: String(row.day), value: round2(num(row.net_sales) - (refundsByDay.get(String(row.day)) || 0)),
    gross: round2(row.billed), bills: num(row.bills),
  }));
  const lifecycle = Object.fromEntries(orderStatuses.map((row) => [String(row.status), num(row.count)]));
  const kotLifecycle = Object.fromEntries(kotStatuses.map((row) => [String(row.status), num(row.count)]));
  const createdOrders = Object.values(lifecycle).reduce((sum, value) => sum + value, 0);
  const cancelledOrders = lifecycle.cancelled || 0;
  const completedOrders = lifecycle.completed || 0;
  const completedKots = kotLifecycle.completed || 0;
  const cancelledKots = kotLifecycle.cancelled || 0;

  const prepValues = kitchenRows.map((row) => num(row.prep_minutes)).filter((value) => value > 0 && value < 600);
  const slowKots = kitchenRows.filter((row) => num(row.prep_minutes) > 25);
  const activeKots = liveKots.filter((row) => ['pending','preparing'].includes(String(row.status)));
  const now = Date.now();
  const agedKots = activeKots.map((row) => ({ ...row, ageMinutes: Math.max(0, Math.round((now - new Date(String(row.printed_at).replace(' ', 'T') + 'Z')) / 60000)) }));

  const occupiedTables = tableState.filter((row) => ['occupied','dining'].includes(String(row.status))).length;
  const reservedTables = tableState.filter((row) => row.status === 'reserved').length;
  const availableTables = Math.max(0, tableState.length - occupiedTables - reservedTables);
  const diningRows = tableRows.filter((row) => num(row.dining_minutes) > 0);
  const avgDining = diningRows.length ? diningRows.reduce((sum, row) => sum + num(row.dining_minutes), 0) / diningRows.length : 0;

  const movementMap = Object.fromEntries(stockMovements.map((row) => [row.change_type, { entries: num(row.entries), value: round2(row.value) }]));
  const stockAlerts = await safe(db.all(
    `SELECT id,item_name AS name,quantity,unit,COALESCE(min_stock_level,min_stock,0) AS minimum
     FROM inventory_items WHERE COALESCE(is_archived,0)=0 AND quantity<=COALESCE(min_stock_level,min_stock,0)
     ORDER BY CASE WHEN quantity<=0 THEN 0 ELSE 1 END,quantity ASC LIMIT 8`
  ), []);

  const reservationMap = Object.fromEntries(reservationStatuses.map((row) => [row.status, { count: num(row.count), guests: num(row.guests) }]));
  const reservationTotal = reservationStatuses.reduce((sum, row) => sum + num(row.count), 0);
  const reservationGuests = reservationStatuses.reduce((sum, row) => sum + num(row.guests), 0);
  const repeatCustomers = topCustomers.filter((row) => num(row.bills) > 1).length;
  const apOutstanding = round2(payables.reduce((sum, row) => sum + Math.max(0, num(row.outstanding)), 0));
  const arOutstanding = round2(receivables.reduce((sum, row) => sum + Math.max(0, num(row.outstanding)), 0));
  const cogs = round2((pnl.expense || []).find((row) => row.code === '5010')?.amount || 0);
  const previousCogs = round2((previousPnl.expense || []).find((row) => row.code === '5010')?.amount || 0);
  const operatingExpenses = round2(num(pnl.totalExpense) - cogs);
  const grossProfit = round2(num(pnl.totalIncome) - cogs);
  const foodCostPercent = sales.netSales > 0 ? round2((cogs / sales.netSales) * 100) : 0;

  const attention = [];
  for (const item of stockAlerts) attention.push({
    severity: num(item.quantity) <= 0 ? 'critical' : 'warning', type: 'inventory',
    title: num(item.quantity) <= 0 ? `${item.name} is out of stock` : `${item.name} is below reorder level`,
    detail: `${num(item.quantity)} ${item.unit || ''} available; minimum ${num(item.minimum)}`,
    href: '/admin/inventory',
  });
  for (const kot of agedKots.filter((row) => row.ageMinutes >= 25).slice(0, 3)) attention.push({
    severity: kot.ageMinutes >= 40 ? 'critical' : 'warning', type: 'kitchen',
    title: `KOT ${kot.kot_number || kot.id} has waited ${kot.ageMinutes} min`,
    detail: kot.table_number ? `Table ${kot.table_number}` : kot.order_number,
    href: '/admin/kot',
  });
  if (num(billControl.voided) >= 2) attention.push({ severity: 'warning', type: 'control', title: `${num(billControl.voided)} bills voided`, detail: `Rs ${round2(billControl.voided_value).toLocaleString()} voided in this period`, href: '/admin/bills?tab=cancelled' });
  if (sales.itemSales > 0 && sales.discounts / sales.itemSales > 0.15) attention.push({ severity: 'warning', type: 'control', title: 'Discount rate is above 15%', detail: `${round2((sales.discounts / sales.itemSales) * 100)}% of gross item sales`, href: '/admin/reports?tab=sales' });
  if (num(cashBalance) < 0) attention.push({ severity: 'critical', type: 'finance', title: 'Cash balance is negative', detail: `Ledger cash balance Rs ${round2(cashBalance).toLocaleString()}`, href: '/admin/finance-dashboard' });
  if (apOutstanding > 0) attention.push({ severity: 'info', type: 'supplier', title: 'Supplier payments outstanding', detail: `Rs ${apOutstanding.toLocaleString()} payable`, href: '/admin/accounts-payable' });
  if (!attention.length) attention.push({ severity: 'clear', type: 'health', title: 'All clear', detail: 'No attention items for this period.' });
  const severityOrder = { critical: 0, warning: 1, info: 2, clear: 3 };
  attention.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const channels = channelRows.map((row) => ({
    channel: labelize(row.channel), orders: num(row.orders), sales: round2(row.sales),
    averageOrder: num(row.orders) ? round2(num(row.sales) / num(row.orders)) : 0,
    share: sales.billedTotal ? round2((num(row.sales) / sales.billedTotal) * 100) : 0,
  }));
  const salesGroups = (() => {
    const merged = new Map();
    for (const row of groupRows || []) {
      const id = row.food_group === 'uncategorised' ? 'uncategorised' : normalizeFoodGroup(row.food_group);
      const prev = merged.get(id) || { revenue: 0, quantity: 0 };
      prev.revenue += num(row.revenue);
      prev.quantity += num(row.quantity);
      merged.set(id, prev);
    }
    return Array.from(merged.entries())
      .map(([id, value]) => ({ label: foodGroupLabel(id), value: round2(value.revenue), quantity: round2(value.quantity) }))
      .sort((a, b) => b.value - a.value);
  })();
  const menuItems = itemRows.map((row) => ({ item: row.item, category: row.category, quantity: num(row.quantity), revenue: round2(row.revenue), orders: num(row.orders) }));
  const categories = categoryRows.map((row) => ({ category: row.category, quantity: num(row.quantity), revenue: round2(row.revenue), orders: num(row.orders), share: sales.itemSales ? round2(num(row.revenue) / sales.itemSales * 100) : 0 }));

  const primaryKpis = [
    makeKpi('net_sales', 'Net Sales', sales.netSales, 'currency', previousSales.netSales),
    makeKpi('collections', 'Net Collections', netCollections, 'currency', null, null, 'Payments received less period refunds'),
    makeKpi('operating_profit', 'Operating Profit', pnl.netProfit, 'currency', previousPnl.netProfit),
    makeKpi('bills', 'Bills Completed', sales.bills, 'number', previousSales.bills),
    makeKpi('aov', 'Average Bill', sales.bills ? sales.billedTotal / sales.bills : 0, 'currency', previousSales.bills ? previousSales.billedTotal / previousSales.bills : 0),
    makeKpi('items', 'Items Sold', num(itemTotals.items), 'number'),
  ];
  const secondaryKpis = [
    makeKpi('gross_sales', 'Gross Item Sales', sales.itemSales, 'currency', previousSales.itemSales),
    makeKpi('discounts', 'Discounts', sales.discounts, 'currency', previousSales.discounts),
    makeKpi('refunds', 'Refunds', sales.refunds, 'currency', previousSales.refunds, sales.refunds > 0 ? 'negative' : null),
    makeKpi('cogs', 'Ledger COGS', cogs, 'currency', previousCogs),
    makeKpi('food_cost', 'Food Cost', foodCostPercent, 'percent'),
    makeKpi('gross_margin', 'Gross Margin', sales.netSales ? grossProfit / sales.netSales * 100 : 0, 'percent'),
  ];
  const transactions = await transactionReport(db, range, { ...(options.transactions || {}), businessDayId });

  return {
    range,
    previousRange: previous,
    generatedAt: new Date().toISOString(),
    primaryKpis,
    secondaryKpis,
    totals: { ...sales, grossCollected, cashCollected, onlineCollected, netCollections, cogs, operatingExpenses, grossProfit, operatingProfit: round2(pnl.netProfit), foodCostPercent, itemsSold: num(itemTotals.items), createdOrders },
    comparisons: {
      netSales: comparison(sales.netSales, previousSales.netSales),
      orders: comparison(createdOrders, 0),
      averageBill: comparison(sales.bills ? sales.billedTotal / sales.bills : 0, previousSales.bills ? previousSales.billedTotal / previousSales.bills : 0),
      profit: comparison(pnl.netProfit, previousPnl.netProfit),
    },
    live: {
      label: 'LIVE RESTAURANT STATUS', occupiedTables, availableTables, reservedTables,
      openOrders: liveOrders.length, preparingKots: liveKots.filter((row) => row.status === 'preparing').length,
      readyKots: liveKots.filter((row) => row.status === 'ready').length,
      pendingKots: liveKots.filter((row) => row.status === 'pending').length,
      pendingPayments: liveBills.length, upcomingReservations: upcomingReservations.length,
      openOrdersValue: round2(openOrdersValueRow.value), openOrdersWithValue: num(openOrdersValueRow.orders),
    },
    sales: {
      trend: salesTrend,
      hourly: salesHourlyRows.map((row) => ({ label: `${String(num(row.hour)).padStart(2, '0')}:00`, value: round2(row.sales), bills: num(row.bills) })),
      collectionsHourly: hourlyRows.map((row) => ({ label: `${String(num(row.hour)).padStart(2, '0')}:00`, value: round2(row.sales), payments: num(row.payments) })),
      byDay: salesDowRows.map((row) => ({ label: DAY_NAMES[num(row.dow)] || '-', value: round2(row.sales) })),
      byGroup: salesGroups,
      byCategory: categories.map((row) => ({ label: row.category, value: row.revenue, meta: `${row.quantity} sold` })),
      byPayment: paymentMethods.map((row) => ({ label: row.label, value: row.amount, meta: `${row.transactions} txns` })),
      reportKpis: [
        makeKpi('gross', 'Gross Sales', sales.grossSales, 'currency'),
        makeKpi('net', 'Net Sales', sales.netSales, 'currency'),
        makeKpi('tax', 'Tax Collected', sales.tax, 'currency'),
        makeKpi('discounts', 'Discounts', sales.discounts, 'currency'),
        makeKpi('cancelled', 'Cancelled Value', cancelledOrderValue.value, 'currency'),
        makeKpi('aov', 'Average Order', sales.bills ? sales.billedTotal / sales.bills : 0, 'currency'),
        makeKpi('cash_received', 'Cash Received', cashCollected, 'currency'),
        makeKpi('qr_received', 'QR Received', paymentMethods.filter((row) => row.method === 'qr').reduce((sum, row) => sum + row.amount, 0), 'currency'),
        makeKpi('credit_sales', 'Credit Sales', paymentMethods.filter((row) => row.method === 'credit').reduce((sum, row) => sum + row.amount, 0), 'currency'),
        makeKpi('credit_collections', 'Credit Collections', creditCollectionsRow.amount, 'currency'),
        makeKpi('receivables', 'Outstanding Receivables', arOutstanding, 'currency'),
        makeKpi('refunds', 'Refunds', sales.refunds, 'currency'),
        makeKpi('open_orders_value', 'Open Orders (Unbilled)', round2(openOrdersValueRow.value), 'currency'),
      ],
    },
    lifecycle: {
      ordersCreated: createdOrders, completedOrders, cancelledOrders,
      kotsSent: kotStatuses.reduce((sum, row) => sum + num(row.count), 0), completedKots, cancelledKots,
      preparing: lifecycle.preparing || 0, ready: lifecycle.ready || 0,
      pendingPayment: liveBills.length, completedBills: sales.bills, voidedBills: num(billControl.voided),
      completionRate: createdOrders ? round2(completedOrders / createdOrders * 100) : 0,
      kotCancellationRate: kitchenRows.length ? round2(cancelledKots / kitchenRows.length * 100) : 0,
    },
    channels,
    payments: { methods: paymentMethods, grossCollected, cashCollected, onlineCollected, refunds: sales.refunds, voidReversals, netCollections },
    finance: {
      netSales: sales.netSales, cogs, grossProfit, operatingExpenses, operatingProfit: round2(pnl.netProfit),
      openingBalance: round2(openingBalanceRow.amount),
      profitMargin: sales.netSales ? round2(num(pnl.netProfit) / sales.netSales * 100) : 0,
      ledgerCollections: round2(creditCollectionsRow.amount),
      totalDeposits: round2(savingsDepositRow.amount),
      depositCount: num(savingsDepositRow.count),
      cashInflow: round2((cashFlow.operating?.inflows || []).reduce((sum, row) => sum + num(row.amount), 0)),
      cashOutflow: round2((cashFlow.operating?.outflows || []).reduce((sum, row) => sum + num(row.amount), 0)),
      netCashChange: round2(cashFlow.netChange), cashBalance: round2(cashBalance), bankBalance: round2(bankBalance),
      accountsReceivable: Math.max(round2(arBalance), arOutstanding), accountsPayable: apOutstanding,
    },
    menu: {
      topItems: menuItems.slice(0, 8), lowItems: menuItems.filter((row) => row.quantity > 0).slice().sort((a, b) => a.quantity - b.quantity || a.revenue - b.revenue).slice(0, 5),
      categories, pairs: pairRows.map((row) => ({ items: `${row.item_a} + ${row.item_b}`, orders: num(row.orders) })),
      recipeCoverage: { menuItems: num(recipeCoverage.menu_items), recipes: num(recipeCoverage.recipes), reliable: num(recipeCoverage.menu_items) > 0 && num(recipeCoverage.recipes) === num(recipeCoverage.menu_items) },
    },
    kitchen: {
      generated: kitchenRows.length, completed: completedKots, cancelled: cancelledKots,
      averagePrepMinutes: round2(prepValues.length ? prepValues.reduce((sum, value) => sum + value, 0) / prepValues.length : 0),
      medianPrepMinutes: round2(median(prepValues)), overTarget: slowKots.length,
      backlog: activeKots.length, slowest: slowKots.sort((a, b) => num(b.prep_minutes) - num(a.prep_minutes)).slice(0, 5),
      cancellationReasons: cancelledKotReasons.map((row) => ({ reason: row.reason, count: num(row.count) })),
    },
    tables: {
      total: tableState.length, occupied: occupiedTables, available: availableTables, reserved: reservedTables,
      occupancy: tableState.length ? round2((occupiedTables + reservedTables) / tableState.length * 100) : 0,
      averageDiningMinutes: round2(avgDining), rows: tableRows.map((row) => ({ ...row, orders: num(row.orders), revenue: round2(row.revenue), average_bill: round2(row.average_bill), dining_minutes: round2(row.dining_minutes) })),
    },
    inventory: {
      value: round2(inventorySummary.value), low: num(inventorySummary.low_count), out: num(inventorySummary.out_count),
      consumptionValue: round2(movementMap.order_deduction?.value), purchaseMovementValue: round2(movementMap.purchase_receipt?.value),
      wastageEntries: num(wastageSummary.entries), wastageValue: round2(wastageSummary.value),
      purchases: num(purchaseSummary.count), purchaseValue: round2(purchaseSummary.value),
      alerts: stockAlerts.map((row) => ({ ...row, quantity: num(row.quantity), minimum: num(row.minimum), status: num(row.quantity) <= 0 ? 'out' : 'low' })),
    },
    suppliers: { purchases: num(purchaseSummary.count), purchaseValue: round2(purchaseSummary.value), outstandingPayables: apOutstanding, top: supplierSpend.map((row) => ({ supplier: row.supplier, purchases: num(row.purchases), spend: round2(row.spend) })) },
    customers: {
      identified: num(customerSummary.identified), anonymousBills: num(customerSummary.anonymous_bills),
      repeatCustomers, repeatRate: num(customerSummary.identified) ? round2(repeatCustomers / num(customerSummary.identified) * 100) : 0,
      averageSpend: round2(customerSummary.avg_spend), receivables: arOutstanding,
      top: topCustomers.map((row) => ({ name: row.name, bills: num(row.bills), spend: round2(row.spend) })),
    },
    staff: {
      waiters: waiterRows.map((row) => ({ name: row.name, orders: num(row.orders), sales: round2(row.sales), averageOrder: round2(row.average_order) })),
      cashiers: cashierRows.map((row) => ({ name: row.name, bills: num(row.bills), collections: round2(row.collections) })),
    },
    reservations: {
      total: reservationTotal, guests: reservationGuests, completed: reservationMap.completed?.count || 0,
      cancelled: reservationMap.cancelled?.count || 0, noShow: reservationMap.no_show?.count || 0,
      upcoming: upcomingReservations,
    },
    controls: {
      discounts: sales.discounts, discountedBills: num(billControl.discounted_bills), cancelledOrders,
      cancelledKots, voidedBills: num(billControl.voided), voidedValue: round2(billControl.voided_value),
      refunds: sales.refunds, refundCount: sales.refundCount,
      reasons: { orders: orderCancelReasons, kots: cancelledKotReasons, bills: voidReasons },
    },
    attention: attention.slice(0, 10),
    recentTransactions: transactions.rows,
    transactionPagination: transactions.pagination,
    recentKots: recentKots.map((row) => ({ ...row, item_count: num(row.item_count), prep_minutes: row.prep_minutes == null ? null : round2(row.prep_minutes) })),
    bestWorst: {
      bestItem: menuItems[0] || null,
      lowestItem: menuItems.filter((row) => row.quantity > 0).slice().sort((a, b) => a.quantity - b.quantity)[0] || null,
      bestCategory: categories[0] || null,
      bestWaiter: waiterRows[0] || null,
      bestTable: tableRows[0] || null,
      peakHour: hourlyRows.slice().sort((a, b) => num(b.sales) - num(a.sales))[0] || null,
      slowestKot: kitchenRows.filter((row) => num(row.prep_minutes) > 0).slice().sort((a, b) => num(b.prep_minutes) - num(a.prep_minutes))[0] || null,
    },
    reconciliation: {
      salesToLedger: { billNetSales: sales.netSales, ledgerIncome: round2(pnl.totalIncome), difference: round2(sales.netSales - pnl.totalIncome), reconciled: Math.abs(sales.netSales - pnl.totalIncome) < 1 },
      collections: { grossCollected, refunds: sales.refunds, voidReversals, netCollections },
      note: 'Bill sales, payment collections, and ledger income are separate controls. Timing, credit collection, tax/service postings, or incomplete historical journals can create a visible difference.',
    },
    limitations: [
      !num(recipeCoverage.recipes) ? 'Recipe margin analytics are hidden because no menu recipes are configured.' : null,
      num(customerSummary.anonymous_bills) ? `${num(customerSummary.anonymous_bills)} bill(s) are anonymous walk-ins and are excluded from repeat-customer metrics.` : null,
      'Historical table transfers and merges are not persisted, so table analytics use the order table snapshot.',
    ].filter(Boolean),
  };
}

'use client';

import Link from 'next/link';
import {
  AlertTriangle, Award, ArrowRight, CheckCircle2, ChefHat, CircleDollarSign,
  Clock3, Download, Info, LayoutGrid, PackageSearch, ReceiptText, ShieldAlert, Users,
} from 'lucide-react';
import { BarChart, ChartCard, RankBars } from '@/components/admin/report-kit';
import PaginationControls from '@/components/ui/pagination-controls';
import {
  DashboardSection, Metric, NepalTime, SectionHeading, StatCell, StatusPill, TableWrap,
  money, percent,
} from './analytics-ui';
import { compactBillNumber, compactOrderNumber } from '@/lib/document-display';
import { orderTypeLabel } from '@/lib/order-types.js';

export function LiveStatus({ data }) {
  const live = data.live;
  const items = [
    ['Tables Occupied', live.occupiedTables], ['Tables Available', live.availableTables],
    ['Orders Open', live.openOrders], ['Open Orders Value', money(live.openOrdersValue)],
    ['KOTs Preparing', live.preparingKots],
    ['KOTs Ready', live.readyKots], ['Pending Payments', live.pendingPayments],
    ['Reservations Soon', live.upcomingReservations],
  ];
  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-950 px-5 py-5 text-white shadow-sm sm:px-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="flex min-w-[190px] items-center gap-2">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-400" />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-400">{live.label}</p>
            <p className="mt-0.5 text-sm text-gray-400">Current operational state</p>
          </div>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 xl:grid-cols-7">
          {items.map(([label, value]) => <div key={label}><p className="text-xs text-gray-400">{label}</p><p className="mt-0.5 text-xl font-semibold tabular-nums">{value}</p></div>)}
        </div>
      </div>
    </section>
  );
}

const SEVERITY = {
  critical: { Icon: ShieldAlert, wrap: 'border-red-200 bg-red-50', icon: 'text-red-600', badge: 'negative' },
  warning: { Icon: AlertTriangle, wrap: 'border-amber-200 bg-amber-50', icon: 'text-amber-600', badge: 'warning' },
  info: { Icon: Info, wrap: 'border-blue-200 bg-blue-50', icon: 'text-blue-600', badge: 'info' },
  clear: { Icon: CheckCircle2, wrap: 'border-emerald-200 bg-emerald-50', icon: 'text-emerald-600', badge: 'positive' },
};

export function AttentionCenter({ rows }) {
  return (
    <DashboardSection>
      <SectionHeading eyebrow="Attention center" title="What needs management action" description="Rule-based alerts only. Normal operations remain quiet." />
      <div className="grid gap-3 lg:grid-cols-2">
        {(rows || []).map((row, index) => {
          const meta = SEVERITY[row.severity] || SEVERITY.info;
          const body = <div className={`flex gap-3 rounded-lg border p-3 ${meta.wrap}`}><meta.Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.icon}`} /><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><p className="text-sm font-semibold text-gray-900">{row.title}</p><StatusPill tone={meta.badge}>{row.severity}</StatusPill></div><p className="mt-1 text-xs text-gray-600">{row.detail}</p></div></div>;
          return row.href ? <Link key={`${row.type}-${index}`} href={row.href}>{body}</Link> : <div key={`${row.type}-${index}`}>{body}</div>;
        })}
      </div>
    </DashboardSection>
  );
}

export function LifecycleKitchen({ data }) {
  const life = data.lifecycle;
  const kitchen = data.kitchen;
  const lifecycleRows = [
    ['Orders created', life.ordersCreated], ['KOTs sent', life.kotsSent], ['Preparing', life.preparing], ['Ready', life.ready],
    ['Completed bills', life.completedBills], ['Cancelled orders', life.cancelledOrders], ['Cancelled KOTs', life.cancelledKots], ['Voided bills', life.voidedBills],
  ];
  const cancellationBars = (kitchen.cancellationReasons || []).map((row) => ({ label: row.reason, value: row.count }));
  return (
    <DashboardSection>
      <SectionHeading icon={ChefHat} tone="orange" eyebrow="Order flow" title="Lifecycle and kitchen health" description="Order, KOT, bill, and payment states remain separate so bottlenecks are visible." action={<Link href="/admin/reports?tab=orders" className="inline-flex items-center gap-1 text-sm font-medium text-gray-700">Orders analytics <ArrowRight className="h-4 w-4" /></Link>} />
      <div className="grid gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {lifecycleRows.map(([label, value]) => <StatCell key={label} label={label} value={value} />)}
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_1.15fr]">
        <div className="grid grid-cols-2 gap-4 rounded-xl border border-gray-100 bg-gray-50 p-4 sm:grid-cols-3">
          <Metric label="KOTs Generated" value={kitchen.generated} />
          <Metric label="Completed" value={kitchen.completed} tone="positive" />
          <Metric label="Cancelled" value={kitchen.cancelled} tone={kitchen.cancelled ? 'negative' : 'default'} />
          <Metric label="Avg Prep" value={kitchen.averagePrepMinutes} format="minutes" />
          <Metric label="Median Prep" value={kitchen.medianPrepMinutes} format="minutes" />
          <Metric label="Over 25 min" value={kitchen.overTarget} tone={kitchen.overTarget ? 'warning' : 'default'} />
          <Metric label="Current Backlog" value={kitchen.backlog} tone={kitchen.backlog ? 'warning' : 'default'} />
          <Metric label="Completion Rate" value={life.completionRate} format="percent" />
          <Metric label="KOT Cancel Rate" value={life.kotCancellationRate} format="percent" />
        </div>
        <ChartCard title="KOT Cancellation Reasons" isEmpty={!cancellationBars.length} empty="No cancelled KOTs in this period."><RankBars data={cancellationBars} color="red" format="number" /></ChartCard>
      </div>
      {kitchen.slowest?.length > 0 && <div className="mt-5"><h3 className="mb-2 text-sm font-semibold text-gray-900">Slowest completed KOTs</h3><TableWrap minWidth="620px"><thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400"><tr><th className="px-4 py-2.5">KOT</th><th className="px-4 py-2.5">Order</th><th className="px-4 py-2.5">Table</th><th className="px-4 py-2.5 text-right">Items</th><th className="px-4 py-2.5 text-right">Prep time</th></tr></thead><tbody className="divide-y divide-gray-100">{kitchen.slowest.map((row) => <tr key={row.id}><td className="px-4 py-3 font-medium">{row.kot_number || row.id}</td><td className="px-4 py-3">{row.order_number}</td><td className="px-4 py-3">{row.table_number || '-'}</td><td className="px-4 py-3 text-right tabular-nums">{row.item_count}</td><td className="px-4 py-3 text-right font-medium tabular-nums">{Math.round(row.prep_minutes)} min</td></tr>)}</tbody></TableWrap></div>}
    </DashboardSection>
  );
}

export function FloorAndReservations({ data }) {
  const table = data.tables;
  const reservations = data.reservations;
  const tableBars = (table.rows || []).slice(0, 8).map((row) => ({ label: `Table ${row.table_number}`, value: row.revenue, meta: `${row.orders} orders` }));
  return (
    <DashboardSection>
      <SectionHeading icon={LayoutGrid} tone="cyan" eyebrow="Floor" title="Tables and reservations" description="Historical table results use the table snapshot saved on each order; live occupancy uses current table state." />
      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <ChartCard title="Revenue by Table" isEmpty={!tableBars.length} empty="No settled dine-in bills in this period."><RankBars data={tableBars} color="slate" format="currency" /></ChartCard>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 rounded-xl border border-gray-100 bg-gray-50 p-4 sm:grid-cols-3">
            <Metric label="Occupancy Now" value={table.occupancy} format="percent" />
            <Metric label="Occupied" value={table.occupied} />
            <Metric label="Available" value={table.available} />
            <Metric label="Avg Dining" value={table.averageDiningMinutes} format="minutes" />
            <Metric label="Reservations" value={reservations.total} />
            <Metric label="Guests Expected" value={reservations.guests} />
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Users className="h-4 w-4" /> Upcoming reservations</h3>
            <div className="mt-2 divide-y divide-gray-100">{reservations.upcoming?.length ? reservations.upcoming.map((row) => <div key={row.id} className="flex items-center justify-between gap-4 py-2.5 text-sm"><div><p className="font-medium text-gray-900">{row.name}</p><p className="text-xs text-gray-400">{row.date} {row.time || ''} | {row.party_size || 0} guests</p></div><span className="text-gray-600">{row.table_number ? `Table ${row.table_number}` : 'Unassigned'}</span></div>) : <p className="py-6 text-center text-sm text-gray-400">No upcoming reservations.</p>}</div>
          </div>
        </div>
      </div>
    </DashboardSection>
  );
}

export function InventorySupplier({ data }) {
  const inv = data.inventory;
  const suppliers = data.suppliers;
  const supplierBars = (suppliers.top || []).map((row) => ({ label: row.supplier, value: row.spend, meta: `${row.purchases} purchases` }));
  return (
    <DashboardSection>
      <SectionHeading icon={PackageSearch} tone="teal" eyebrow="Stock and purchasing" title="Inventory and supplier health" description="Current stock health is live; movement, wastage, and purchasing totals use the selected period." />
      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 rounded-xl border border-gray-100 bg-gray-50 p-4 sm:grid-cols-3">
            <Metric label="Inventory Value" value={inv.value} format="currency" />
            <Metric label="Low Stock" value={inv.low} tone={inv.low ? 'warning' : 'default'} />
            <Metric label="Out of Stock" value={inv.out} tone={inv.out ? 'negative' : 'default'} />
            <Metric label="Consumption" value={inv.consumptionValue} format="currency" />
            <Metric label="Wastage" value={inv.wastageValue} format="currency" />
            <Metric label="Purchases" value={inv.purchaseValue} format="currency" />
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><PackageSearch className="h-4 w-4" /> Stock alerts</h3>
            <div className="mt-2 divide-y divide-gray-100">{inv.alerts?.length ? inv.alerts.map((row) => <div key={row.id} className="flex items-center justify-between py-2.5 text-sm"><span className="font-medium text-gray-800">{row.name}</span><StatusPill tone={row.status === 'out' ? 'negative' : 'warning'}>{row.quantity} {row.unit || ''}</StatusPill></div>) : <p className="py-5 text-center text-sm text-gray-400">All tracked stock is above reorder level.</p>}</div>
          </div>
        </div>
        <div className="space-y-4">
          <ChartCard title="Top Suppliers by Spend" isEmpty={!supplierBars.length} empty="No purchases recorded in this period."><RankBars data={supplierBars} color="blue" format="currency" /></ChartCard>
          <div className="grid grid-cols-3 gap-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
            <Metric label="Purchase Records" value={suppliers.purchases} />
            <Metric label="Purchase Value" value={suppliers.purchaseValue} format="currency" />
            <Metric label="Outstanding AP" value={suppliers.outstandingPayables} format="currency" tone={suppliers.outstandingPayables ? 'warning' : 'default'} />
          </div>
        </div>
      </div>
    </DashboardSection>
  );
}

export function PeoplePerformance({ data }) {
  const customers = data.customers;
  const waiterBars = (data.staff.waiters || []).map((row) => ({ label: row.name, value: row.sales, meta: `${row.orders} orders` }));
  return (
    <DashboardSection>
      <SectionHeading icon={Users} tone="violet" eyebrow="People" title="Customers and staff" description="Anonymous walk-ins are excluded from repeat-customer metrics. Staff sales are attributed only through saved waiter/cashier IDs." />
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Metric label="Identified Customers" value={customers.identified} />
            <Metric label="Repeat Customers" value={customers.repeatCustomers} />
            <Metric label="Repeat Rate" value={customers.repeatRate} format="percent" />
            <Metric label="Average Spend" value={customers.averageSpend} format="currency" />
            <Metric label="Anonymous Bills" value={customers.anonymousBills} />
            <Metric label="Customer Credit" value={customers.receivables} format="currency" />
          </div>
          <div className="mt-4 divide-y divide-gray-100">{customers.top?.map((row) => <div key={row.name} className="flex justify-between py-2 text-sm"><span className="font-medium text-gray-800">{row.name}</span><span className="tabular-nums text-gray-600">{money(row.spend)} | {row.bills} bills</span></div>)}</div>
        </div>
        <ChartCard title="Waiter Sales Attribution" isEmpty={!waiterBars.length} empty="No settled bills are attributed to a waiter."><RankBars data={waiterBars} color="emerald" format="currency" /></ChartCard>
      </div>
    </DashboardSection>
  );
}

export function Controls({ data }) {
  const c = data.controls;
  const reasonRows = [...(c.reasons.orders || []).map((r) => ({ label: `Order: ${r.reason}`, value: r.count })), ...(c.reasons.kots || []).map((r) => ({ label: `KOT: ${r.reason}`, value: r.count })), ...(c.reasons.bills || []).map((r) => ({ label: `Bill: ${r.reason}`, value: r.count }))];
  return (
    <DashboardSection>
      <SectionHeading icon={ShieldAlert} tone="rose" eyebrow="Management control" title="Discounts, refunds, voids and cancellations" description="A compact fraud/control view backed by persisted reasons and audit history." />
      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Discount', c.discounts, 'currency'], ['Discounted Bills', c.discountedBills, 'number'], ['Refunds', c.refunds, 'currency'], ['Refund Count', c.refundCount, 'number'],
            ['Cancelled Orders', c.cancelledOrders, 'number'], ['Cancelled KOTs', c.cancelledKots, 'number'], ['Voided Bills', c.voidedBills, 'number'], ['Value Voided', c.voidedValue, 'currency'],
          ].map(([label, value, format]) => <StatCell key={label} label={label} value={value} format={format} tone={value ? 'negative' : 'default'} />)}
        </div>
        <ChartCard title="Top Recorded Reasons" isEmpty={!reasonRows.length} empty="No cancellation or void reasons in this period."><RankBars data={reasonRows.slice(0, 8)} color="red" format="number" /></ChartCard>
      </div>
    </DashboardSection>
  );
}

export function RecentActivity({ data, pagination, loading = false, onPageChange, onPageSizeChange, onExportTransactions }) {
  return (
    <DashboardSection>
      <SectionHeading
        icon={CircleDollarSign}
        tone="slate"
        eyebrow="Transactions"
        title="Paged transaction report"
        description="Transactions are loaded page by page so longer periods stay fast. Export downloads the full selected period."
        action={<button type="button" onClick={onExportTransactions} className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><Download className="h-4 w-4" /> Excel export</button>}
      />
      <div className="space-y-5">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><CircleDollarSign className="h-4 w-4" /> Transactions</h3>
            <Link href="/admin/bills" className="text-xs font-medium text-gray-600">View bills</Link>
          </div>
          <TableWrap minWidth="1360px">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-4 py-2.5">Time</th><th className="px-4 py-2.5">Bill / Order</th><th className="px-4 py-2.5">Table / Channel</th><th className="px-4 py-2.5">Customer</th><th className="px-4 py-2.5">Cashier</th><th className="px-4 py-2.5">Payment</th>
                <th className="px-4 py-2.5 text-right">Subtotal</th><th className="px-4 py-2.5 text-right">Discount</th><th className="px-4 py-2.5 text-right">Cash</th><th className="px-4 py-2.5 text-right">QR</th><th className="px-4 py-2.5">QR Type</th>
                <th className="px-4 py-2.5 text-right">Food</th><th className="px-4 py-2.5 text-right">Beverage</th><th className="px-4 py-2.5 text-right">Tobacco</th><th className="px-4 py-2.5 text-right">Final Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.recentTransactions?.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 text-gray-500"><NepalTime value={row.paid_at || row.created_at} /></td>
                  <td className="px-4 py-3"><p className="font-medium">{compactBillNumber(row.bill_number)}</p><p className="text-xs text-gray-400">{compactOrderNumber(row.order_number)}</p></td>
                  <td className="px-4 py-3">{row.table_number ? `Table ${row.table_number}` : orderTypeLabel(row)}</td>
                  <td className="px-4 py-3">{row.customer_name || 'Walk-in'}</td>
                  <td className="px-4 py-3">{row.cashier}</td>
                  <td className="px-4 py-3 capitalize">{row.payment}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(row.subtotal)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(row.discount_amount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(row.cash_amount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(row.qr_amount)}</td>
                  <td className="px-4 py-3">{row.qr_type || 'Not recorded'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(row.food_amount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(row.beverage_amount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(row.tobacco_amount)}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(row.final_total || row.grand_total)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <PaginationControls pagination={pagination} loading={loading} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
        </div>
        <div><div className="mb-2 flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-semibold"><ChefHat className="h-4 w-4" /> Recent KOT activity</h3><Link href="/admin/kot" className="text-xs font-medium text-gray-600">View KOT history</Link></div><TableWrap minWidth="760px"><thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400"><tr><th className="px-4 py-2.5">Created</th><th className="px-4 py-2.5">KOT</th><th className="px-4 py-2.5">Order</th><th className="px-4 py-2.5">Table</th><th className="px-4 py-2.5 text-right">Items</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5 text-right">Prep</th><th className="px-4 py-2.5">Reason</th></tr></thead><tbody className="divide-y divide-gray-100">{data.recentKots?.map((row, i) => <tr key={`${row.kot_number}-${i}`}><td className="px-4 py-3 text-gray-500"><NepalTime value={row.printed_at} /></td><td className="px-4 py-3 font-medium">{row.kot_number || '-'}</td><td className="px-4 py-3">{row.order_number}</td><td className="px-4 py-3">{row.table_number || '-'}</td><td className="px-4 py-3 text-right tabular-nums">{row.item_count}</td><td className="px-4 py-3"><StatusPill tone={row.status === 'completed' ? 'positive' : row.status === 'cancelled' ? 'negative' : 'warning'}>{row.status}</StatusPill></td><td className="px-4 py-3 text-right tabular-nums">{row.prep_minutes == null ? '-' : `${Math.round(row.prep_minutes)} min`}</td><td className="px-4 py-3 text-gray-500">{row.cancel_reason || '-'}</td></tr>)}</tbody></TableWrap></div>
      </div>
    </DashboardSection>
  );
}

export function ManagementSummary({ data }) {
  const best = data.bestWorst;
  const rows = [
    ['Best selling item', best.bestItem?.item, best.bestItem ? `${best.bestItem.quantity} sold` : null],
    ['Lowest selling item', best.lowestItem?.item, best.lowestItem ? `${best.lowestItem.quantity} sold` : null],
    ['Highest revenue category', best.bestCategory?.category, best.bestCategory ? money(best.bestCategory.revenue) : null],
    ['Best performing waiter', best.bestWaiter?.name, best.bestWaiter ? money(best.bestWaiter.sales) : null],
    ['Highest revenue table', best.bestTable?.table_number ? `Table ${best.bestTable.table_number}` : null, best.bestTable ? money(best.bestTable.revenue) : null],
    ['Peak sales hour', best.peakHour ? `${String(best.peakHour.hour).padStart(2, '0')}:00` : null, best.peakHour ? money(best.peakHour.sales) : null],
    ['Slowest KOT', best.slowestKot?.kot_number, best.slowestKot ? `${Math.round(best.slowestKot.prep_minutes)} min` : null],
  ].filter((row) => row[1]);
  return (
    <DashboardSection className="pb-8">
      <SectionHeading icon={Award} tone="indigo" eyebrow="Business overview" title="Best and worst performance summary" description="A concise owner handoff for the selected period." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{rows.map(([label, value, detail]) => <div key={label} className="rounded-xl border border-gray-100 bg-gray-50 p-4"><p className="text-xs text-gray-500">{label}</p><p className="mt-1 truncate text-sm font-semibold text-gray-900">{value}</p><p className="mt-0.5 text-xs text-gray-400">{detail}</p></div>)}</div>
      {data.limitations?.length > 0 && <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4"><p className="text-xs font-semibold uppercase text-gray-500">Data notes</p><ul className="mt-2 space-y-1 text-xs text-gray-600">{data.limitations.map((note) => <li key={note}>- {note}</li>)}</ul></div>}
    </DashboardSection>
  );
}

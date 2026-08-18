'use client';

import Link from 'next/link';
import { ArrowRight, BadgeDollarSign, ReceiptText, ShoppingBasket } from 'lucide-react';
import { BarChart, ChartCard, ChartGrid, RankBars, TrendChart } from '@/components/admin/report-kit';
import DonutChart, { DEFAULT_COLORS } from '@/components/admin/donut-chart';
import { financialTone } from '@/lib/financial-tone';
import {
  CompactMetrics, DashboardSection, Metric, PrimaryKpis, SectionHeading,
  TableWrap, money, percent,
} from './analytics-ui';

export function ExecutiveSummary({ data }) {
  return (
    <div className="space-y-4">
      <PrimaryKpis rows={data.primaryKpis} />
      <CompactMetrics rows={data.secondaryKpis} />
    </div>
  );
}

export function SalesPerformance({ data }) {
  const trend = data.sales.trend || [];
  const hourly = data.sales.hourly || [];
  return (
    <DashboardSection>
      <SectionHeading
        eyebrow="Sales performance"
        title="Demand and sales movement"
        description="Settled bill sales and payment activity for the selected Nepal reporting period."
        action={<Link href="/admin/reports?tab=sales" className="inline-flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-gray-950">Sales analytics <ArrowRight className="h-4 w-4" /></Link>}
      />
      <ChartGrid>
        <ChartCard title="Net Sales Trend" hint="Item sales less discounts and period refunds" isEmpty={!trend.length} empty="No settled sales in this period.">
          <TrendChart data={trend} color="blue" format="currency" height={230} />
        </ChartCard>
        <ChartCard title="Collections by Hour" hint="Actual payment rows, Nepal time" isEmpty={!hourly.length} empty="No collections in this period.">
          <BarChart data={hourly} color="slate" format="currency" height={230} />
        </ChartCard>
      </ChartGrid>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.25fr_1fr]">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-900">Sales by channel</h3>
          <TableWrap minWidth="620px">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400"><tr><th className="px-4 py-2.5">Channel</th><th className="px-4 py-2.5 text-right">Orders</th><th className="px-4 py-2.5 text-right">Sales</th><th className="px-4 py-2.5 text-right">Average</th><th className="px-4 py-2.5 text-right">Share</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {(data.channels || []).map((row) => <tr key={row.channel}><td className="px-4 py-3 font-medium text-gray-900">{row.channel}</td><td className="px-4 py-3 text-right tabular-nums">{row.orders}</td><td className="px-4 py-3 text-right font-medium tabular-nums text-emerald-700">{money(row.sales)}</td><td className="px-4 py-3 text-right tabular-nums text-emerald-700">{money(row.averageOrder)}</td><td className="px-4 py-3 text-right tabular-nums">{percent(row.share)}</td></tr>)}
            </tbody>
          </TableWrap>
        </div>
        <div className="grid grid-cols-2 gap-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
          <Metric label="Gross Item Sales" value={data.totals.itemSales} format="currency" />
          <Metric label="Net Sales" value={data.totals.netSales} format="currency" tone="positive" />
          <Metric label="Discount" value={data.totals.discounts} format="currency" />
          <Metric label="Tax + Service" value={data.totals.tax + data.totals.serviceCharge} format="currency" />
          <Metric label="Bills" value={data.totals.bills} />
          <Metric label="Items Sold" value={data.totals.itemsSold} />
        </div>
      </div>
    </DashboardSection>
  );
}

export function PaymentFinance({ data }) {
  const sales = data.sales || {};
  const payRows = sales.byPayment || (data.payments.methods || []).map((row) => ({ label: row.label, value: row.amount, meta: `${row.transactions} transaction${row.transactions === 1 ? '' : 's'}` }));
  const groupRows = sales.byGroup || [];
  const categoryRows = (sales.byCategory || []).slice(0, 6);
  const reportKpis = sales.reportKpis || [];
  const finance = data.finance;
  return (
    <DashboardSection>
      <SectionHeading icon={BadgeDollarSign} tone="emerald" eyebrow="Money control" title="Sales, collections and revenue mix" description="One owner overview for the selected Nepal reporting period. Deeper drilldowns stay inside Reports." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {reportKpis.map((row) => (
          <div key={row.key} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <Metric label={row.label} value={row.value} format={row.format} tone={row.key === 'refunds' || row.key === 'cancelled' ? 'negative' : row.key === 'net' ? 'positive' : 'default'} />
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <ChartCard title="Revenue Trend" hint="Settled sales less discounts and refunds" isEmpty={!sales.trend?.length} empty="No settled sales in this period.">
          <TrendChart data={sales.trend || []} color="blue" format="currency" height={230} />
        </ChartCard>
        <ChartCard title="By Hour" hint="Settled bill value by Nepal hour" isEmpty={!sales.hourly?.length} empty="No hourly sales in this period.">
          <BarChart data={sales.hourly || []} color="slate" format="currency" height={230} />
        </ChartCard>
        <ChartCard title="By Day" isEmpty={!sales.byDay?.length} empty="No daily sales in this period.">
          <BarChart data={sales.byDay || []} color="blue" format="currency" height={220} />
        </ChartCard>
        <DonutMix title="By Payment" rows={payRows} centerLabel="Collected" />
        <DonutMix title="By Group" rows={groupRows} centerLabel="Sales" />
        <DonutMix title="By Category" rows={categoryRows} centerLabel="Sales" />
      </div>

      <div className="mt-5 grid gap-4 rounded-2xl border border-gray-800 bg-gray-950 p-5 text-white sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 sm:p-6">
        {[
          ['Gross Profit', finance.grossProfit], ['Operating Expenses', finance.operatingExpenses], ['Operating Profit', finance.operatingProfit], ['Cash in Hand', finance.cashBalance],
          ['Bank / Online', finance.bankBalance], ['Receivables', finance.accountsReceivable], ['Payables', finance.accountsPayable], ['COGS', finance.cogs],
        ].map(([label, value]) => {
          const tone = financialTone({ label, value });
          return <div key={label}><p className="text-xs text-gray-400">{label}</p><p className={`mt-1 truncate text-base font-semibold tabular-nums ${tone === 'positive' ? 'text-emerald-400' : tone === 'negative' ? 'text-rose-400' : 'text-white'}`}>{money(value)}</p></div>;
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-sm font-medium">
        <Link href="/admin/financial-reports?report=pnl" className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-950"><BadgeDollarSign className="h-4 w-4" /> View P&amp;L</Link>
        <Link href="/admin/finance-dashboard" className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-950"><ReceiptText className="h-4 w-4" /> Full finance</Link>
      </div>
    </DashboardSection>
  );
}

function DonutMix({ title, rows, centerLabel }) {
  const total = (rows || []).reduce((sum, row) => sum + Number(row.value || 0), 0);
  const segments = (rows || []).slice(0, 6).map((row, index) => ({
    label: row.label,
    value: row.value,
    color: DEFAULT_COLORS[index % DEFAULT_COLORS.length],
  }));

  return (
    <ChartCard title={title} isEmpty={!segments.length} empty={`No ${title.toLowerCase()} data in this period.`}>
      <div className="grid items-center gap-5 sm:grid-cols-[220px_1fr]">
        <DonutChart segments={segments} size={220} thickness={32} centerLabel={centerLabel} centerValue={money(total)} />
        <div className="space-y-2">
          {segments.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 inline-flex items-center gap-2 text-gray-600">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: row.color }} />
                <span className="truncate">{row.label}</span>
              </span>
              <span className="shrink-0 font-medium tabular-nums text-gray-900">{money(row.value)}</span>
            </div>
          ))}
        </div>
      </div>
    </ChartCard>
  );
}

export function MenuPerformance({ data }) {
  const menu = data.menu;
  const categoryBars = (menu.categories || []).slice(0, 8).map((row) => ({ label: row.category, value: row.revenue, meta: `${row.quantity} items | ${row.orders} orders` }));
  return (
    <DashboardSection>
      <SectionHeading icon={ShoppingBasket} tone="amber" eyebrow="Menu intelligence" title="What guests are ordering" description="Item and category revenue are pre-discount menu mix figures; recipe margin is shown only when recipe coverage is complete." action={<Link href="/admin/reports?tab=menu" className="inline-flex items-center gap-1 text-sm font-medium text-gray-700">Menu analytics <ArrowRight className="h-4 w-4" /></Link>} />
      {!menu.recipeCoverage.reliable && <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Margin ranking is hidden: {menu.recipeCoverage.recipes} of {menu.recipeCoverage.menuItems} menu items have recipes.</div>}
      <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <TableWrap minWidth="680px">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400"><tr><th className="px-4 py-2.5">Item</th><th className="px-4 py-2.5">Category</th><th className="px-4 py-2.5 text-right">Qty</th><th className="px-4 py-2.5 text-right">Orders</th><th className="px-4 py-2.5 text-right">Revenue</th></tr></thead>
          <tbody className="divide-y divide-gray-100">{(menu.topItems || []).map((row) => <tr key={`${row.item}-${row.category}`}><td className="px-4 py-3 font-medium text-gray-900">{row.item}</td><td className="px-4 py-3 text-gray-500">{row.category}</td><td className="px-4 py-3 text-right tabular-nums">{row.quantity}</td><td className="px-4 py-3 text-right tabular-nums">{row.orders}</td><td className="px-4 py-3 text-right font-medium tabular-nums text-emerald-700">{money(row.revenue)}</td></tr>)}</tbody>
        </TableWrap>
        <ChartCard title="Category Mix" isEmpty={!categoryBars.length} empty="No category sales."><RankBars data={categoryBars} color="slate" format="currency" /></ChartCard>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><ShoppingBasket className="h-4 w-4" /> Commonly ordered together</h3>
          <div className="mt-3 divide-y divide-gray-100">{menu.pairs?.length ? menu.pairs.map((row) => <div key={row.items} className="flex items-center justify-between gap-4 py-2.5 text-sm"><span className="text-gray-700">{row.items}</span><span className="shrink-0 tabular-nums text-gray-500">{row.orders} orders</span></div>) : <p className="py-6 text-center text-sm text-gray-400">Not enough completed baskets yet.</p>}</div>
        </div>
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
          <h3 className="text-sm font-semibold text-gray-900">Lowest-moving sold items</h3>
          <div className="mt-3 divide-y divide-gray-100">{(menu.lowItems || []).map((row) => <div key={`${row.item}-${row.category}`} className="flex items-center justify-between gap-4 py-2.5 text-sm"><div><p className="font-medium text-gray-800">{row.item}</p><p className="text-xs text-gray-400">{row.category}</p></div><span className="tabular-nums text-gray-600">{row.quantity} sold</span></div>)}</div>
        </div>
      </div>
    </DashboardSection>
  );
}

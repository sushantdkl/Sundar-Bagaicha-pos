'use client';

import Link from 'next/link';
import {
  ArrowRight, CircleDollarSign, CreditCard, PackageSearch,
  ShoppingBasket, WalletCards,
} from 'lucide-react';
import { ChartCard, RankBars, formatValue } from '@/components/admin/report-kit';
import { financialToneClass } from '@/lib/financial-tone';

const money = (value) => formatValue(value, 'currency');
const number = (value) => formatValue(value, 'number');
const percent = (value) => formatValue(value, 'percent');

const tones = {
  blue: 'bg-blue-50 text-blue-700',
  emerald: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  rose: 'bg-rose-50 text-rose-700',
  violet: 'bg-violet-50 text-violet-700',
};

export function AnalyticsKeyMetrics({ data }) {
  const finance = data.finance || {};
  const totals = data.totals || {};
  const inventory = data.inventory || {};
  const averageOrder = totals.bills ? totals.billedTotal / totals.bills : 0;
  const openingBalance = data.businessDayMetrics?.openingCash ?? finance.openingBalance;
  const metrics = [
    ['Opening Balance', openingBalance, 'currency', 'Drawer at opening'],
    ['Total Sales', totals.netSales, 'currency', `${number(totals.bills)} orders`],
    ['Ledger Collections', finance.ledgerCollections, 'currency', 'Past dues paid'],
    ['Total Purchases', inventory.purchaseValue, 'currency', `${number(inventory.purchases)} records`],
    ['Total Expenses', finance.operatingExpenses, 'currency', 'Operating expenses'],
    ['Total Deposit', finance.totalDeposits, 'currency', `${number(finance.depositCount)} deposits`],
    ['Net Profit', finance.operatingProfit, 'currency', 'After operating expenses'],
    ['Profit Margin', finance.profitMargin, 'percent', 'Of total sales'],
    ['Avg Order', averageOrder, 'currency', `${number(totals.bills)} bills`],
    ['Total Discount', totals.discounts, 'currency', 'Customer discounts'],
  ];

  return (
    <section aria-label="Key financial figures" className="mb-5 overflow-hidden rounded-lg border border-gray-200 bg-gray-200 shadow-sm">
      <div className="grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-5">
        {metrics.map(([label, value, format, detail]) => (
          <div key={label} className="min-w-0 bg-white px-4 py-4 sm:px-5">
            <p className="truncate text-xs font-medium text-gray-500">{label}</p>
            <p className={`mt-1.5 truncate text-xl font-semibold tabular-nums ${format === 'currency' ? financialToneClass({ label, value }) : 'text-gray-950'}`} title={String(value ?? 0)}>
              {format === 'percent' ? percent(value) : money(value)}
            </p>
            <p className="mt-1 truncate text-xs text-gray-400">{detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function OverviewCard({ title, icon: Icon, tone, moneyTone, href, value, detail, children }) {
  return (
    <Link href={href} className="group flex min-h-[154px] flex-col rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-[border-color,transform] duration-150 ease-out hover:border-gray-300 active:scale-[0.98]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}><Icon className="h-4 w-4" /></span>
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        </div>
        <ArrowRight className="h-4 w-4 text-gray-300 transition-transform duration-150 ease-out group-hover:translate-x-0.5" />
      </div>
      <p className={`mt-4 text-2xl font-semibold tabular-nums ${moneyTone || 'text-gray-950'}`}>{value}</p>
      <p className="mt-1 text-xs text-gray-500">{detail}</p>
      {children}
    </Link>
  );
}

export default function AnalyticsHome({ data }) {
  const finance = data.finance || {};
  const totals = data.totals || {};
  const inventory = data.inventory || {};
  const payments = data.payments || {};
  const topItems = (data.menu?.topItems || []).slice(0, 7).map((row) => ({
    label: row.item,
    value: row.revenue,
    meta: `${number(row.quantity)} sold`,
  }));
  const tableEarnings = (data.tables?.rows || []).slice(0, 7).map((row) => ({
    label: `Table ${row.table_number}`,
    value: row.revenue,
    meta: `${number(row.orders)} order${Number(row.orders) === 1 ? '' : 's'}`,
  }));
  const paymentTotal = Number(payments.cashCollected || 0) + Number(payments.onlineCollected || 0);
  const cashShare = paymentTotal ? Math.min(100, (Number(payments.cashCollected || 0) / paymentTotal) * 100) : 0;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-950">Overview</h2>
        <p className="mt-0.5 text-sm text-gray-500">Sales, spending, stock and restaurant performance at a glance.</p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Business overview">
        <OverviewCard title="Payments" icon={CreditCard} tone="blue" moneyTone="text-emerald-700" href="/admin/reports?tab=finance" value={money(payments.grossCollected)} detail={`${money(payments.cashCollected)} cash · ${money(payments.onlineCollected)} online`}>
          <div className="mt-auto flex h-1.5 overflow-hidden rounded-full bg-gray-100" aria-label={`${Math.round(cashShare)} percent cash`}>
            <span className="bg-blue-600" style={{ width: `${cashShare}%` }} />
            <span className="flex-1 bg-cyan-400" />
          </div>
        </OverviewCard>
        <OverviewCard title="Purchases" icon={ShoppingBasket} tone="amber" moneyTone="text-rose-700" href="/admin/purchases" value={money(inventory.purchaseValue)} detail={`${number(inventory.purchases)} purchase records`} />
        <OverviewCard title="Sales" icon={CircleDollarSign} tone="emerald" moneyTone="text-emerald-700" href="/admin/reports?tab=sales" value={money(totals.netSales)} detail={`${number(totals.bills)} orders · ${number(totals.itemsSold)} items${data.live?.openOrdersValue > 0 ? ` · +${money(data.live.openOrdersValue)} on open tables` : ''}`} />
        <OverviewCard title="Expenses" icon={WalletCards} tone="rose" moneyTone="text-rose-700" href="/admin/expenses" value={money(finance.operatingExpenses)} detail={`Food cost ${money(finance.cogs)}`} />
        <OverviewCard title="Stock" icon={PackageSearch} tone="violet" href="/admin/inventory" value={money(inventory.value)} detail={`${number(inventory.low)} low stock · ${number(inventory.out)} out`} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2" aria-label="Sales rankings">
        <ChartCard title="Top Selling Items" hint="Highest earning menu items" isEmpty={!topItems.length} empty="No item sales in this period.">
          <RankBars data={topItems} color="emerald" format="currency" limit={7} />
        </ChartCard>
        <ChartCard title="Table Earnings" hint="Revenue earned by each dine-in table" isEmpty={!tableEarnings.length} empty="No settled table sales in this period.">
          <RankBars data={tableEarnings} color="blue" format="currency" limit={7} />
        </ChartCard>
      </section>
    </div>
  );
}

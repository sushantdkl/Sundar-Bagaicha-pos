'use client';

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, Banknote, ChevronDown, ChevronUp, CircleCheck, CreditCard, ReceiptText, Utensils } from 'lucide-react';
import { financialToneClass } from '@/lib/financial-tone';

const amount = (value) => `Rs ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const count = (value) => Number(value || 0).toLocaleString('en-IN');

function Metric({ label, value, money = true, tone }) {
  return <div className="min-w-0 border-l-2 border-gray-200 pl-3"><p className="text-xs font-medium text-gray-500">{label}</p><p className={`mt-1 truncate text-base font-semibold tabular-nums ${money ? financialToneClass({ label, value, tone }) : 'text-gray-950'}`}>{money ? amount(value) : count(value)}</p></div>;
}

function Section({ icon: Icon, title, children }) {
  return <section className="border-t border-gray-200 py-6 first:border-t-0 first:pt-0">
    <div className="mb-4 flex items-center gap-2"><Icon className="h-4 w-4 text-gray-500" /><h2 className="text-sm font-semibold text-gray-950">{title}</h2></div>
    {children}
  </section>;
}

export default function ClosingSummary({ summary, countedCash = '', onCountedCashChange, interactive = false }) {
  const [showCash, setShowCash] = React.useState(false);
  const expected = Number(summary?.cash?.expected_cash || 0);
  const hasCount = countedCash !== '' && countedCash != null;
  const difference = hasCount ? Number(countedCash) - expected : null;
  const state = difference == null ? null : Math.abs(difference) < 0.005 ? 'MATCHED' : difference < 0 ? 'SHORT' : 'OVER';
  const sales = summary?.sales || {};
  const collections = summary?.collections || {};
  const breakdown = summary?.cash?.breakdown || {};

  return <div className="space-y-0">
    <Section icon={ReceiptText} title="Sales summary">
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 xl:grid-cols-6">
        <Metric label="Gross Billed Sales" value={sales.gross_sales} tone="positive" /><Metric label="Discounts" value={sales.discounts} />
        <Metric label="Sales Before Returns" value={sales.sales_before_returns} tone="positive" /><Metric label="Net Sales After Refunds" value={sales.net_sales} tone={Number(sales.net_sales) < 0 ? 'negative' : 'positive'} /><Metric label="VAT / Tax" value={sales.tax} />
        <Metric label="Service Charge" value={sales.service_charge} /><Metric label="Refunds" value={sales.refunds} />
        <Metric label="Voided Bill Value" value={sales.voided_bill_value} /><Metric label="Finalized Bills" value={sales.completed_bills} money={false} />
        <Metric label="Orders Completed" value={summary?.orders?.completed} money={false} /><Metric label="Average Net Bill" value={sales.average_bill} tone="positive" />
        <Metric label="Items Sold" value={sales.items_sold} money={false} />
      </div>
      {!!sales.channels?.length && <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-gray-100 pt-4">
        {sales.channels.map((row) => <span key={row.channel} className="text-sm text-gray-600"><strong className="capitalize text-gray-900">{String(row.channel).replaceAll('_', ' ')}</strong> <span className="font-semibold text-emerald-700">{amount(row.amount)} net</span>{Number(row.refunds||0)>0 && <> (<span className="text-emerald-700">{amount(row.gross_amount)} gross</span> - <span className="text-rose-700">{amount(row.refunds)} refunded</span>)</>}</span>)}
      </div>}
    </Section>

    <Section icon={CreditCard} title="Payment collection summary">
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Cash Collected" value={collections.cash} /><Metric label="Online / QR" value={collections.qr} tone="positive" />
        <Metric label="Card" value={collections.card} tone="positive" /><Metric label="Bank Transfer" value={collections.bank} tone="positive" />
        <Metric label="Credit Sales" value={collections.credit_sales} tone="positive" /><Metric label="Gross Collected" value={collections.total_collected} />
        <Metric label="Refunds Returned" value={collections.refunds} /><Metric label="Void Returns" value={collections.void_returns} />
        <Metric label="Net Collected" value={collections.net_collected} />
      </div>
    </Section>

    <section className="border-y-2 border-gray-950 bg-gray-950 px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="mb-5 flex items-center gap-2"><Banknote className="h-5 w-5" /><h2 className="text-base font-semibold">Cash reconciliation</h2></div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="border border-white/20 bg-white/5 p-5">
          <p className="text-xs font-semibold uppercase text-gray-400">Expected Cash</p>
          <p className="mt-2 text-3xl font-bold tabular-nums sm:text-4xl">{amount(expected)}</p>
          <button type="button" onClick={() => setShowCash((value) => !value)} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-gray-300 hover:text-white">
            {showCash ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />} Cash calculation
          </button>
        </div>
        <div className="border border-white/20 bg-white p-5 text-gray-950">
          <label className="block text-xs font-semibold uppercase text-gray-500">Counted Cash</label>
          {interactive ? <div className="mt-2 flex items-center border-b-2 border-gray-950 pb-1"><span className="mr-2 text-xl font-semibold">Rs</span><input aria-label="Counted cash" type="number" min="0" step="0.01" inputMode="decimal" value={countedCash} onChange={(event) => onCountedCashChange(event.target.value)} className="min-w-0 flex-1 bg-transparent text-3xl font-bold tabular-nums outline-none sm:text-4xl" placeholder="0.00" /></div>
            : <p className="mt-2 text-3xl font-bold tabular-nums sm:text-4xl">{amount(summary?.reconciliation?.counted_cash ?? summary?.business_day?.counted_cash)}</p>}
          <div className={`mt-4 border-l-4 pl-3 ${state === 'SHORT' ? 'border-rose-600 text-rose-700' : state === 'OVER' ? 'border-amber-500 text-amber-700' : state === 'MATCHED' ? 'border-emerald-600 text-emerald-700' : 'border-gray-300 text-gray-500'}`}>
            <p className="text-xs font-bold uppercase">{state || 'Difference'}</p>
            <p className="text-xl font-bold tabular-nums">{difference == null ? 'Enter counted cash' : amount(Math.abs(difference))}</p>
          </div>
        </div>
      </div>
      {showCash && <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-white/20 pt-4 text-sm sm:grid-cols-3 lg:grid-cols-5">
        <CashLine label="Opening Cash" value={breakdown.opening_cash} />
        <CashLine label="Cash Collections" value={breakdown.cash_collections} sign="+" />
        <CashLine label="Credit Collections" value={breakdown.credit_collections} sign="+" />
        <CashLine label="Other Cash In" value={breakdown.cash_in} sign="+" />
        <CashLine label="Cash Expenses" value={breakdown.cash_expenses} sign="-" />
        <CashLine label="Cash Refunds" value={breakdown.cash_refunds} sign="-" />
        <CashLine label="Void Returns" value={breakdown.void_returns} sign="-" />
        <CashLine label="Supplier Payments" value={breakdown.supplier_payments} sign="-" />
        <CashLine label="Other Cash Out" value={breakdown.other_cash_out} sign="-" />
      </div>}
    </section>

    <Section icon={CreditCard} title="Online and bank reconciliation">
      {summary?.online?.length ? <div className="divide-y divide-gray-100 border-y border-gray-100">
        {summary.online.map((row) => <div key={row.code} className="grid grid-cols-[1fr_auto_auto_auto] gap-4 py-3 text-sm"><span className="font-medium text-gray-900">{row.name}</span><span className="font-medium text-emerald-700">In {amount(row.inflow)}</span><span className="font-medium text-rose-700">Out {amount(row.outflow)}</span><strong className={`tabular-nums ${Number(row.net) > 0 ? 'text-emerald-700' : Number(row.net) < 0 ? 'text-rose-700' : 'text-gray-950'}`}>Net {amount(row.net)}</strong></div>)}
      </div> : <p className="text-sm text-gray-500">No online or bank movement in this business day.</p>}
    </Section>

    <Section icon={Banknote} title="Outflows">
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-5"><Metric label="Operating Expenses" value={summary?.outflows?.operating_expenses} /><Metric label="Cash Expenses" value={summary?.outflows?.cash_expenses} /><Metric label="Online Expenses" value={summary?.outflows?.online_expenses} /><Metric label="Refunds" value={summary?.outflows?.refunds} /><Metric label="Void Value" value={summary?.outflows?.voided_value} /></div>
    </Section>

    <Section icon={Utensils} title="Orders, kitchen and floor">
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4 lg:grid-cols-8"><Metric label="Orders Created" value={summary?.orders?.created} money={false} /><Metric label="Completed" value={summary?.orders?.completed} money={false} /><Metric label="Open Orders" value={summary?.orders?.open} money={false} /><Metric label="Cancelled" value={summary?.orders?.cancelled} money={false} /><Metric label="KOTs Generated" value={summary?.kots?.generated} money={false} /><Metric label="KOTs Completed" value={summary?.kots?.completed} money={false} /><Metric label="Active KOTs" value={summary?.kots?.active} money={false} /><Metric label="Tables Served" value={summary?.operations?.tables_served} money={false} /></div>
      {!!summary?.operations?.top_items?.length && <div className="mt-5 border-t border-gray-100 pt-4"><p className="mb-2 text-xs font-semibold uppercase text-gray-500">Top-selling items</p><div className="flex flex-wrap gap-x-6 gap-y-2">{summary.operations.top_items.map((item) => <span key={item.name} className="text-sm"><strong>{item.name}</strong> <span className="text-gray-500">{count(item.quantity)} sold</span></span>)}</div></div>}
    </Section>

    <Section icon={summary?.blockers?.canCloseNormally ? CircleCheck : AlertTriangle} title="Issues before closing">
      {summary?.blockers?.canCloseNormally ? <div className="flex items-center gap-2 border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"><CircleCheck className="h-4 w-4" />No unresolved operational records.</div>
        : <div className="border border-rose-200 bg-rose-50"><div className="border-b border-rose-200 px-4 py-3 text-sm font-semibold text-rose-900">Cannot close normally</div><div className="divide-y divide-rose-100">{summary?.blockers?.items?.map((item) => <Link key={item.key} href={item.href} className="flex items-center justify-between px-4 py-3 text-sm text-rose-800 hover:bg-rose-100"><span>{item.count} {item.label}</span><span className="font-semibold">View</span></Link>)}</div></div>}
    </Section>
  </div>;
}

function CashLine({ label, value, sign = '' }) {
  const tone = sign === '+' ? 'text-emerald-400' : sign === '-' ? 'text-rose-400' : 'text-white';
  return <div><p className="text-xs text-gray-400">{label}</p><p className={`mt-0.5 font-semibold tabular-nums ${tone}`}>{sign} {amount(value)}</p></div>;
}

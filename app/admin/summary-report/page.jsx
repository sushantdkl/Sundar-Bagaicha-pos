'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { Printer, RefreshCw } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';
import { formatNepalDateTime, formatNepalDisplay, nepalDateString } from '@/lib/report-dates';
import { financialToneClass } from '@/lib/financial-tone';
import DateInput from '@/components/ui/date-input.jsx';

const money=(n)=>`Rs. ${Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const line=(label,value,sign='',tone)=>({label,value,sign,tone});

export default function SummaryReportPage(){
  const today=nepalDateString();
  const [period,setPeriod]=useState('today'); const [from,setFrom]=useState(today); const [to,setTo]=useState(today);
  const [data,setData]=useState(null); const [loading,setLoading]=useState(true); const [error,setError]=useState('');
  const load=useCallback(async(p=period)=>{setLoading(true);setError('');try{const query=p==='custom'?`period=custom&startDate=${from}&endDate=${to}`:`period=${p}`;setData(await apiJson(`/api/admin/summary-report?${query}`));}catch(e){setError(e.message||'Could not load report.');}finally{setLoading(false)}},[period,from,to]);
  useEffect(()=>{load()},[]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose=(p)=>{setPeriod(p);setTimeout(()=>load(p),0)};
  const d=data;
  return <AdminLayout>
    <header className="print:hidden border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold text-gray-900">Summary Report</h1><p className="mt-1 text-sm text-gray-500">Financial and operational overview</p></div><div className="flex gap-2"><button onClick={()=>window.print()} className={BTN}><Printer className="h-4 w-4"/>Print</button><button onClick={()=>load()} disabled={loading} className={BTN}><RefreshCw className={`h-4 w-4 ${loading?'animate-spin':''}`}/>Refresh</button></div></div>
      <div className="mt-5 flex flex-wrap items-end gap-2">{[['today','Today'],['this_week','This Week'],['this_month','This Month'],['year','This Year']].map(([p,l])=><button key={p} onClick={()=>choose(p)} className={`${FILTER} ${period===p?'bg-gray-900 text-white':'bg-white text-gray-700'}`}>{l}</button>)}<label className={LABEL}>From<DateInput value={from} onChange={setFrom} className={INPUT}/></label><span className="pb-2 text-gray-400">-</span><label className={LABEL}>To<DateInput value={to} onChange={setTo} className={INPUT}/></label><button onClick={()=>{setPeriod('custom');load('custom')}} className={`${FILTER} bg-gray-900 text-white`}>Apply</button><button onClick={()=>{setFrom(today);setTo(today);choose('today')}} className={FILTER}>Reset</button></div>
    </header>
    <main className="bg-gray-50 p-4 sm:p-6 lg:p-8 print:bg-white print:p-0">
      {error&&<div className="mb-4 border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {loading&&!d?<div className="py-24 text-center text-sm text-gray-500">Building the report...</div>:d&&<div className="mx-auto max-w-7xl bg-white p-5 shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <div className="mb-6 border-b-2 border-gray-900 pb-5"><p className="text-sm font-semibold text-gray-600">{d.restaurant_name}</p><h2 className="mt-1 text-3xl font-bold text-gray-950">Summary Report</h2><p className="mt-2 text-sm text-gray-600">{formatNepalDisplay(d.range.start)} - {formatNepalDisplay(d.range.end)}</p><p className="mt-1 text-xs text-gray-400">Generated {formatNepalDateTime(d.generated_at)} NPT</p></div>
        <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
          <Section title="Restaurant Revenue" note="Gross sales show original finalized bills. Net revenue subtracts refunds and voided bills." rows={[line('Gross Cash Sales',d.revenue.cash),line('Gross Bank / Online Sales',d.revenue.bank),line('Gross Credit Sales',d.revenue.credit),line('Gross Sales',d.revenue.gross),line(`Refunds (${d.revenue.refund_count||0})`,d.revenue.refunds,'-'),line(`Voided Bills (${d.revenue.void_count||0})`,d.revenue.voids,'-'),line('Net Revenue',d.revenue.net)]}/>
          <Section title="Customer Ledger Payments" rows={[line('Cash Received',d.ledger.cash),line('Bank Received',d.ledger.bank),line('Total Received',d.ledger.cash+d.ledger.bank)]}/>
          <Section title="Payment Received" note="Net received is the money retained after cash/bank refunds and void reversals." rows={[line('Gross Collected',d.received.gross_total),line('Cash Refunds / Void Returns',d.received.refund_cash+d.received.void_cash,'-'),line('Bank Refunds / Void Returns',d.received.refund_bank+d.received.void_bank,'-'),line('Net Cash Retained',d.received.cash),line('Net Bank Retained',d.received.bank),line('Net Received',d.received.total)]}/>
          <Section title="Total Purchase" rows={[line('Cash',d.purchases.cash),line('Bank Transfer',d.purchases.bank),line('Credit Purchase',d.purchases.credit),line('Total Purchase',d.purchases.total)]}/>
          <Section title="Total Expense" rows={[line('Cash',d.expenses.cash),line('Bank Transfer',d.expenses.bank),line('Credit Expense',d.expenses.credit),line('Total Expense',d.expenses.total)]}/>
          <Section title="Total Salary Paid" rows={[line('Cash / bank paid now',d.salary.cash+d.salary.bank),line('Advance deductions',d.salary.advance_deductions),line('Gross salary expense',d.salary.total)]}/>
          <Section title="Cash Register" rows={[line('Cash In',d.cash_register.cash_in),line('Cash Out',d.cash_register.cash_out),line('Savings Deposit',d.cash_register.deposit)]}/>
          <Section title="Savings / Deposits" note="Transfers to savings are cash movements, not business expenses." rows={[line('From Cash',d.savings.cash),line('From Online / QR',d.savings.online),line('Total Saved',d.savings.total)]}/>
          <Section title="Profit & Loss" note="Refunds reduce revenue. Refunded food remains in food cost because a refund does not restore consumed stock; a void does." rows={[line('Net Revenue after Refunds / Voids',d.profit.revenue,'',d.profit.revenue<0?'negative':'positive'),line('Estimated Food Cost',d.profit.food_cost,'-'),line('Estimated Gross Profit',d.profit.gross),line('Operating Expenses & Salary',d.profit.operating,'-'),line('Estimated Net Profit',d.profit.net,d.profit.net>=0?'+':'')]}/>
          <Account title="Cash in Hand" data={d.accounts.cash}/><Account title="Cash in Bank / Online" data={d.accounts.bank}/>
          <ExchangeCard data={d.exchange}/>
          <Section title="Net Exchange" note="Positive means net income from exchange fees." rows={[line('Total Impact',d.exchange.net)]}/>
          <Section title="Sales - Expense" note="Net revenue minus operating expenses & salary, without subtracting food cost." rows={[line('Net Revenue',d.profit.revenue,'',d.profit.revenue<0?'negative':'positive'),line('Operating Expenses & Salary',d.profit.operating,'-'),line('Result',d.profit.revenue-d.profit.operating,'',(d.profit.revenue-d.profit.operating)<0?'negative':'positive')]}/>
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-2"><Category title="Gross Sale Category (before refunds)" rows={d.sale_categories}/><Category title="Purchase Category" rows={d.purchase_categories}/></div>
        <div className="mt-5 border border-gray-200"><h3 className="border-b border-gray-200 px-4 py-3 text-sm font-bold text-gray-900">Quantity Summary</h3><div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8">{Object.entries({ 'Sold Item Quantity':d.quantities.sold,'Purchase Quantity':d.quantities.purchased,Bills:d.quantities.bills,Orders:d.quantities.orders,KOTs:d.quantities.kots,'Expense Records':d.quantities.expenses,'Salary Records':d.quantities.salary,'Savings Records':d.quantities.savings}).map(([k,v])=><div key={k} className="border-b border-r border-gray-100 p-4"><p className="text-xs text-gray-500">{k}</p><p className="mt-1 text-xl font-bold text-gray-900">{Number(v||0).toLocaleString()}</p></div>)}</div></div>
      </div>}
    </main>
  </AdminLayout>
}

function Rows({title,rows}){return <div className="divide-y divide-gray-100">{rows.map((r,i)=><div key={r.label} className={`flex justify-between gap-4 px-4 py-2.5 text-sm ${i===rows.length-1?'font-bold':'text-gray-600'}`}><span>{r.label}</span><span className={`tabular-nums ${financialToneClass({...r,label:`${title} ${r.label}`})}`}>{r.sign&&`${r.sign} `}{money(r.value)}</span></div>)}</div>}
function Section({title,rows,note}){return <section className="border border-gray-200"><h3 className="border-b border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-900">{title}</h3><Rows title={title} rows={rows}/>{note&&<p className="border-t border-gray-100 px-4 py-3 text-xs text-gray-500">{note}</p>}</section>}
function Account({title,data}){const m=data.movements||{};const isCashInHand=title==='Cash in Hand';return <Section title={title} rows={[line('Opening Balance',data.opening),line('Opening Adjustment',m.drawer_open?.net||m.opening_cash_movement?.net||0),line('Sales & Collections',(m.bill?.net||0)+(m.bill_supplement?.net||0)+(m.credit_collection?.net||0),'+'),line('Refunds',Math.abs(m.refund?.net||0),'-'),line('Void Reversals',Math.abs(m.reversal?.net||0),'-'),line('Purchases & Expenses',(m.purchase?.net||0)+(m.expense?.net||0)),line('Salary',m.payroll?.net||0),line('Savings',(m.savings_deposit?.net||0)),line('Money Exchange',m.exchange?.net||0),line(isCashInHand?'Closing Cash':'Closing Balance',data.closing)]}/>}
function ExchangeCard({data}){
  const cashRows=[line('Cash In',data.cash.in),line('Cash Out',data.cash.out),line('Balance',data.cash.in-data.cash.out)];
  const bankRows=[line('Online In',data.bank.in),line('Online Out',data.bank.out),line('Balance',data.bank.in-data.bank.out)];
  return <section className="border border-gray-200">
    <h3 className="border-b border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-900">Exchange</h3>
    <div className="divide-y divide-gray-100">
      <div><h4 className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Exchange Cash</h4><Rows title="Exchange Cash" rows={cashRows}/></div>
      <div><h4 className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Exchange Online / Bank</h4><Rows title="Exchange Online / Bank" rows={bankRows}/></div>
    </div>
  </section>;
}
function Category({title,rows}){const tone=title.startsWith('Gross Sale')?'positive':title.startsWith('Purchase')?'negative':undefined;const total=rows.reduce((s,r)=>s+Number(r.amount||0),0);return <section className="border border-gray-200"><h3 className="border-b border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold">{title}</h3>{rows.length?<><div className="divide-y divide-gray-100">{rows.map(r=><div key={r.category} className="flex justify-between px-4 py-3 text-sm"><div><p className="font-medium text-gray-900">{r.category}</p><p className="text-xs text-gray-500">Qty: {Number(r.quantity).toLocaleString()}</p></div><b className={financialToneClass({ label: title, value: r.amount, tone })}>{money(r.amount)}</b></div>)}</div><div className="flex justify-between border-t-2 border-gray-900 px-4 py-3 text-sm font-bold text-gray-900"><span>Total</span><b className={financialToneClass({ label: title, value: total, tone })}>{money(total)}</b></div></>:<p className="px-4 py-8 text-center text-sm text-gray-500">No {title.toLowerCase()} data</p>}</section>}
const BTN='inline-flex h-10 items-center gap-2 border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';
const FILTER='h-10 border border-gray-300 px-3 text-sm font-medium hover:bg-gray-50'; const LABEL='text-xs font-medium text-gray-600'; const INPUT='mt-1 block h-10 border border-gray-300 bg-white px-3 text-sm text-gray-900';

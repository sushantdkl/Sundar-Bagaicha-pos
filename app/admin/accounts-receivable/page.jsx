'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import AdminLayout from '@/components/admin/admin-layout';
import { Search, X, User, ExternalLink, Wallet, ShieldAlert, Tag, ChevronRight } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import LedgerTable, { money } from '@/components/accounting/ledger-table';
import { adminInputClass } from '@/components/ui/admin-form';
import DateInput from '@/components/ui/date-input.jsx';
import { resolvePeriodRange, formatNepalDisplay } from '@/lib/report-dates';
import QrEnlargeModal from '@/components/billing/qr-enlarge-modal';

const QR_PROVIDERS = ['Fonepay', 'eSewa', 'Khalti', 'Bank QR', 'Other'];

const PERIODS = [
  { id: 'all', label: 'All Time' },
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'this_week', label: 'This Week' },
  { id: 'this_month', label: 'This Month' },
  { id: 'year', label: 'This Year' },
];

function newKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`;
}

export default function AccountsReceivablePage() {
  const router = useRouter();
  const pathname = usePathname();
  const isCashier = pathname?.startsWith('/cashier');
  const customerPath = isCashier ? '/cashier/customers' : '/admin/customers';
  const posPath = isCashier ? '/cashier/pos' : '/admin/pos';
  const { addToast } = useToast();

  const [overview, setOverview] = useState({ receivables: [], ar_balance: 0, banks: [] });
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState({});
  const [qrModal, setQrModal] = useState({ open: false, title: '', image: '' });

  const [period, setPeriod] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState('');

  // Customer popup
  const [selected, setSelected] = useState(null); // { id, name, phone, is_vip }
  const [detail, setDetail] = useState({ bills: [], statement: [] });
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Order popup, stacked on top of the customer popup
  const [selectedBill, setSelectedBill] = useState(null); // the bill row clicked
  const [orderDetail, setOrderDetail] = useState(null);
  const [loadingOrder, setLoadingOrder] = useState(false);

  // Pay / discount form — { scope: 'customer'|'bill', mode: 'pay'|'writeoff', target }
  const [actionFor, setActionFor] = useState(null);
  const [form, setForm] = useState({ amount: '', method: 'cash', bank_account_id: '', qrProvider: 'Fonepay', note: '' });
  const [busy, setBusy] = useState(false);
  const keyRef = useRef(newKey());

  const load = async () => {
    try { setOverview(await apiJson('/api/admin/accounts-receivable')); }
    catch (error) { addToast(friendlyFromError(error, 'load_failed')); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    apiJson('/api/admin/settings').then((r) => setSettings(r.settings || {})).catch(() => {});
  }, []);

  const choosePeriod = (id) => {
    setPeriod(id);
    if (id === 'all') { setFrom(''); setTo(''); return; }
    const range = resolvePeriodRange(id);
    setFrom(range.start); setTo(range.end);
  };
  const editFrom = (v) => { setFrom(v); setPeriod('custom'); };
  const editTo = (v) => { setTo(v); setPeriod('custom'); };

  const openCustomer = (c) => { setSelected(c); setSelectedBill(null); setOrderDetail(null); };
  const closeCustomer = () => { setSelected(null); setDetail({ bills: [], statement: [] }); setSelectedBill(null); setOrderDetail(null); };

  useEffect(() => {
    if (!selected) return;
    (async () => {
      setLoadingDetail(true);
      try {
        const params = new URLSearchParams({ customer_id: selected.id });
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        const d = await apiJson(`/api/admin/accounts-receivable?${params}`);
        setDetail({ bills: d.bills || [], statement: d.statement || [] });
      } catch (error) { addToast(friendlyFromError(error, 'load_failed')); }
      finally { setLoadingDetail(false); }
    })();
  }, [selected, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const openOrder = async (bill) => {
    setSelectedBill(bill);
    setOrderDetail(null);
    if (!bill.order_id) return;
    setLoadingOrder(true);
    try {
      const res = await apiJson(`/api/admin/pos/orders/${bill.order_id}`);
      setOrderDetail(res.workspace || null);
    } catch (error) { addToast(friendlyFromError(error, 'load_failed')); }
    finally { setLoadingOrder(false); }
  };
  const closeOrder = () => { setSelectedBill(null); setOrderDetail(null); };

  const refreshAfterMoney = async () => {
    await load();
    if (selected) setSelected((prev) => (prev ? { ...prev } : prev)); // retrigger detail refetch
  };

  const outstandingTotal = detail.bills.reduce((s, b) => s + Number(b.outstanding_amount || 0), 0);

  const openAction = (scope, mode, target) => {
    const defaultAmount = scope === 'bill' ? Number(target.outstanding_amount || 0) : outstandingTotal;
    setActionFor({ scope, mode, target });
    setForm({ amount: String(defaultAmount), method: 'cash', bank_account_id: String(overview.banks?.[0]?.id || ''), qrProvider: 'Fonepay', note: '' });
  };

  const submitAction = async () => {
    if (!(Number(form.amount) > 0)) { addToast(friendlyMessage('validation', { description: 'Enter an amount.' })); return; }
    setBusy(true);
    try {
      const body = actionFor.scope === 'bill'
        ? { bill_id: actionFor.target.id }
        : { customer_id: selected.id };
      if (actionFor.mode === 'writeoff') {
        body.action = 'writeoff';
        body.amount = Number(form.amount);
        body.reason = form.note;
      } else {
        body.amount = Number(form.amount);
        body.method = form.method;
        body.bank_account_id = form.method === 'bank' ? form.bank_account_id : null;
        body.provider = form.method === 'qr' ? form.qrProvider : null;
        body.note = form.note;
      }
      body.external_ref = keyRef.current;
      const result = await apiJson('/api/admin/accounts-receivable', { method: 'POST', body: JSON.stringify(body) });
      addToast(friendlyMessage('save_success', {
        description: actionFor.mode === 'writeoff' ? 'Discount recorded.' : 'Payment recorded.',
      }));
      keyRef.current = newKey();
      setActionFor(null);
      await refreshAfterMoney();
      // Bill-scoped actions return the bill's fresh outstanding directly —
      // a re-fetch race would otherwise leave the still-open order popup
      // showing the pre-payment amount for a beat (or forever, on a partial).
      if (actionFor.scope === 'bill' && selectedBill) {
        const nextOutstanding = Number(result.outstanding ?? 0);
        if (nextOutstanding <= 0.009) {
          closeOrder();
        } else {
          setSelectedBill((prev) => (prev ? { ...prev, outstanding_amount: nextOutstanding, payment_status: result.status || prev.payment_status } : prev));
        }
      }
    } catch (error) { addToast(friendlyFromError(error, 'save_failed')); }
    finally { setBusy(false); }
  };

  const visibleCustomers = useMemo(() => {
    const list = overview.receivables || [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => c.name?.toLowerCase().includes(q) || String(c.phone || '').includes(q));
  }, [overview.receivables, query]);

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Customer Ledger</h1>
        <p className="mt-1 text-sm text-gray-500">Manage customer statements and transactions.</p>
      </header>

      <div className="space-y-6 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="rounded-2xl border border-gray-900 bg-gray-900 px-5 py-4 text-white">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Total outstanding customer credit</span>
            <span className="text-xl font-bold tabular-nums">{money(overview.ar_balance)}</span>
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap gap-2">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => choosePeriod(p.id)}
                className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  period === p.id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400">Applies to the statement inside each customer&rsquo;s ledger — the list below is everyone currently owing.</p>

          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">From</span>
              <DateInput value={from} onChange={editFrom} className={INPUT} />
            </label>
            <span className="pb-2 text-gray-400">—</span>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">To</span>
              <DateInput value={to} onChange={editTo} className={INPUT} />
            </label>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search customer by name or phone..."
              className={`${INPUT} pl-9`}
            />
          </div>
        </div>

        {!loading && visibleCustomers.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100">
              <User className="h-6 w-6 text-gray-400" />
            </div>
            <h3 className="text-base font-bold text-gray-900">{query ? 'No match' : 'No Outstanding Credit'}</h3>
            <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
              {query ? 'No customer matches that search.' : 'Nobody currently owes the till anything.'}
            </p>
            {!query && (
              <div className="mx-auto mt-6 flex max-w-md flex-col items-center gap-2 sm:flex-row sm:justify-center">
                <span className="inline-flex items-center gap-2 rounded-full bg-gray-50 px-4 py-2 text-xs font-medium text-gray-600"><Wallet className="h-3.5 w-3.5" />Track payments</span>
                <span className="inline-flex items-center gap-2 rounded-full bg-gray-50 px-4 py-2 text-xs font-medium text-gray-600"><ShieldAlert className="h-3.5 w-3.5" />Monitor dues</span>
              </div>
            )}
          </div>
        ) : (
          <Panel title={`Customers with dues (${visibleCustomers.length})`}>
            <div className="divide-y divide-gray-100">
              {visibleCustomers.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => openCustomer(c)}
                  className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-gray-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium text-gray-900">
                      {c.name}
                      {c.is_vip ? <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">VIP</span> : null}
                    </p>
                    {c.phone && <p className="text-xs text-gray-400">{c.phone}</p>}
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-rose-700">{money(c.outstanding)}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                </button>
              ))}
            </div>
          </Panel>
        )}
      </div>

      {/* Customer popup */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-gray-900">{selected.name}</h2>
                  {selected.is_vip ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">VIP</span> : null}
                </div>
                <p className="text-sm text-gray-500">{selected.phone || 'No phone on file'}</p>
              </div>
              <button type="button" onClick={closeCustomer} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <div className="rounded-xl bg-gray-50 px-4 py-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Outstanding balance</span>
                  <span className="text-lg font-bold tabular-nums text-gray-900">{money(outstandingTotal)}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Link href={`${customerPath}/${selected.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  <ExternalLink className="h-4 w-4" /> View profile
                </Link>
                <button type="button" disabled={outstandingTotal <= 0} onClick={() => openAction('customer', 'pay')} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-40">
                  Receive payment
                </button>
                <button type="button" disabled={outstandingTotal <= 0} onClick={() => openAction('customer', 'writeoff')} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-40">
                  <Tag className="h-4 w-4" /> Give discount
                </button>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-gray-900">Orders with dues</h3>
                <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
                  {detail.bills.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => openOrder(b)}
                      className="flex w-full flex-wrap items-center gap-3 bg-white px-4 py-3 text-left hover:bg-gray-50"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-gray-900">{b.bill_number}</span>
                        <span className="block text-xs text-gray-400">{formatNepalDisplay(String(b.created_at || '').slice(0, 10))}</span>
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${b.payment_status === 'partial' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-700'}`}>
                        {b.payment_status || 'unpaid'}
                      </span>
                      <span className="text-sm tabular-nums text-gray-500">{money(b.grand_total)}</span>
                      <span className="text-sm font-semibold tabular-nums text-rose-700">{money(b.outstanding_amount)} due</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                    </button>
                  ))}
                  {!loadingDetail && detail.bills.length === 0 && (
                    <p className="bg-white px-4 py-8 text-center text-sm text-gray-500">No open dues for this customer.</p>
                  )}
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-gray-900">Statement</h3>
                <LedgerTable
                  lines={detail.statement.map((l) => ({ ...l, entry_date: l.date }))}
                  debitNormal
                  loading={loadingDetail}
                  empty="No transactions in this date range."
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Order popup, stacked above the customer popup */}
      {selectedBill && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{selectedBill.bill_number}</h2>
                <p className="text-sm text-gray-500">{formatNepalDisplay(String(selectedBill.created_at || '').slice(0, 10))}</p>
              </div>
              <button type="button" onClick={closeOrder} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {loadingOrder ? (
                <p className="py-10 text-center text-sm text-gray-500">Loading order…</p>
              ) : orderDetail ? (
                <>
                  <div className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                    {(orderDetail.items || []).map((it) => (
                      <div key={it.order_item_id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                        <span className="text-gray-900">{it.quantity}× {it.item_name}</span>
                        <span className="tabular-nums text-gray-700">{money(it.subtotal ?? it.price * it.quantity)}</span>
                      </div>
                    ))}
                    {!(orderDetail.items || []).length && <p className="px-4 py-6 text-center text-sm text-gray-500">No items on this order.</p>}
                  </div>
                  <div className="rounded-xl bg-gray-50 px-4 py-3 space-y-1.5 text-sm">
                    <div className="flex justify-between"><span className="text-gray-500">Bill total</span><span className="font-semibold tabular-nums text-gray-900">{money(selectedBill.grand_total)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Outstanding</span><span className="font-bold tabular-nums text-rose-700">{money(selectedBill.outstanding_amount)}</span></div>
                  </div>
                </>
              ) : (
                <p className="py-10 text-center text-sm text-gray-500">Order details unavailable.</p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={Number(selectedBill.outstanding_amount || 0) <= 0}
                  onClick={() => openAction('bill', 'pay', selectedBill)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-40"
                >
                  Pay this bill
                </button>
                <button
                  type="button"
                  disabled={Number(selectedBill.outstanding_amount || 0) <= 0}
                  onClick={() => openAction('bill', 'writeoff', selectedBill)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-40"
                >
                  <Tag className="h-4 w-4" /> Discount this bill
                </button>
                {selectedBill.order_id && (
                  <button
                    type="button"
                    onClick={() => router.push(`${posPath}?order=${selectedBill.order_id}`)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <ExternalLink className="h-4 w-4" /> Open in POS
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pay / discount form, stacked above whichever popup opened it */}
      {actionFor && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 max-h-[94dvh] overflow-y-auto">
            <h3 className="mb-1 text-lg font-bold text-gray-900">
              {actionFor.mode === 'writeoff' ? 'Give discount' : 'Receive payment'}
              {actionFor.scope === 'bill' ? ` — ${actionFor.target.bill_number}` : ` — ${selected?.name}`}
            </h3>
            <p className="mb-4 text-sm text-gray-500">
              Outstanding {money(actionFor.scope === 'bill' ? actionFor.target.outstanding_amount : outstandingTotal)}
            </p>
            <div className="space-y-3">
              <Field label={actionFor.mode === 'writeoff' ? 'Discount amount' : 'Amount'}>
                <input type="number" min="0" step="any" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className={INPUT} />
              </Field>
              {actionFor.mode === 'pay' && (
                <>
                  <Field label="Method">
                    <select value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))} className={INPUT}>
                      <option value="cash">Cash</option>
                      <option value="qr">QR / Digital</option>
                      <option value="bank">Bank</option>
                    </select>
                  </Field>
                  {form.method === 'bank' && (
                    <Field label="Bank account">
                      <select value={form.bank_account_id} onChange={(e) => setForm((f) => ({ ...f, bank_account_id: e.target.value }))} className={INPUT}>
                        {overview.banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </Field>
                  )}
                  {form.method === 'qr' && (
                    <>
                      <Field label="Provider">
                        <select value={form.qrProvider} onChange={(e) => setForm((f) => ({ ...f, qrProvider: e.target.value }))} className={INPUT}>
                          {QR_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </Field>
                      {(settings.esewa_qr_image || settings.bank_qr_image) ? (
                        <div className="grid grid-cols-2 gap-2">
                          {settings.esewa_qr_image && (
                            <button
                              type="button"
                              onClick={() => setQrModal({ open: true, title: 'eSewa / Fonepay QR', image: settings.esewa_qr_image })}
                              className="rounded-lg border border-gray-200 p-2 text-center hover:bg-gray-50"
                            >
                              <img src={settings.esewa_qr_image} alt="eSewa / Fonepay QR" className="mx-auto h-24 w-24 object-contain" />
                              <p className="mt-1 text-[11px] text-gray-500">Tap to enlarge</p>
                            </button>
                          )}
                          {settings.bank_qr_image && (
                            <button
                              type="button"
                              onClick={() => setQrModal({ open: true, title: 'Bank QR', image: settings.bank_qr_image })}
                              className="rounded-lg border border-gray-200 p-2 text-center hover:bg-gray-50"
                            >
                              <img src={settings.bank_qr_image} alt="Bank QR" className="mx-auto h-24 w-24 object-contain" />
                              <p className="mt-1 text-[11px] text-gray-500">Tap to enlarge</p>
                            </button>
                          )}
                        </div>
                      ) : (
                        <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">No QR codes configured in Settings.</p>
                      )}
                    </>
                  )}
                </>
              )}
              <Field label={actionFor.mode === 'writeoff' ? 'Reason' : 'Note'}>
                <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className={INPUT} placeholder={actionFor.mode === 'writeoff' ? 'e.g. loyalty discount, goodwill' : 'optional'} />
              </Field>
            </div>
            <div className="mt-6 flex gap-3">
              <button disabled={busy} onClick={submitAction} className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 ${actionFor.mode === 'writeoff' ? 'bg-amber-600' : 'bg-gray-900'}`}>
                {busy ? 'Saving…' : actionFor.mode === 'writeoff' ? 'Apply discount' : 'Post payment'}
              </button>
              <button type="button" onClick={() => setActionFor(null)} className="flex-1 rounded-lg bg-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-300">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <QrEnlargeModal open={qrModal.open} title={qrModal.title} image={qrModal.image} onClose={() => setQrModal({ open: false, title: '', image: '' })} />
    </AdminLayout>
  );
}

function Panel({ title, children }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-5 py-4"><h2 className="text-sm font-semibold text-gray-900">{title}</h2></div>
      {children}
    </section>
  );
}
function Field({ label, children }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>{children}</label>;
}
const INPUT = adminInputClass;

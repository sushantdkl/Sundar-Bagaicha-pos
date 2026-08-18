'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import AdminLayout from '@/components/admin/admin-layout';
import { Search, X, Building2, ExternalLink, Wallet, ShieldAlert, ChevronRight } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import LedgerTable, { money } from '@/components/accounting/ledger-table';
import { adminInputClass } from '@/components/ui/admin-form';
import DateInput from '@/components/ui/date-input.jsx';
import { resolvePeriodRange, formatNepalDisplay } from '@/lib/report-dates';

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

export default function AccountsPayablePage() {
  const pathname = usePathname();
  const suppliersPath = pathname?.startsWith('/cashier') ? '/cashier/suppliers' : '/admin/suppliers';
  const { addToast } = useToast();

  const [overview, setOverview] = useState({ payables: [], liabilities: [], banks: [] });
  const [loading, setLoading] = useState(true);

  const [period, setPeriod] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState('');

  const [selected, setSelected] = useState(null); // { id, name, phone? }
  const [detail, setDetail] = useState({ invoices: [], statement: [] });
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [selectedInvoice, setSelectedInvoice] = useState(null); // stacked popup

  const [payFor, setPayFor] = useState(null);
  const [form, setForm] = useState({ amount: '', method: 'cash', bank_account_id: '', note: '' });
  const [busy, setBusy] = useState(false);
  const keyRef = useRef(newKey());

  const load = async () => {
    try { setOverview(await apiJson('/api/admin/accounts-payable')); }
    catch (error) { addToast(friendlyFromError(error, 'load_failed')); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const choosePeriod = (id) => {
    setPeriod(id);
    if (id === 'all') { setFrom(''); setTo(''); return; }
    const range = resolvePeriodRange(id);
    setFrom(range.start); setTo(range.end);
  };
  const editFrom = (v) => { setFrom(v); setPeriod('custom'); };
  const editTo = (v) => { setTo(v); setPeriod('custom'); };

  const openSupplier = (s) => { setSelected(s); setSelectedInvoice(null); };
  const closeSupplier = () => { setSelected(null); setDetail({ invoices: [], statement: [] }); setSelectedInvoice(null); };

  useEffect(() => {
    if (!selected) return;
    (async () => {
      setLoadingDetail(true);
      try {
        const params = new URLSearchParams({ supplier_id: selected.id });
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        const d = await apiJson(`/api/admin/accounts-payable?${params}`);
        setDetail({ invoices: d.invoices || [], statement: d.statement || [] });
      } catch (error) { addToast(friendlyFromError(error, 'load_failed')); }
      finally { setLoadingDetail(false); }
    })();
  }, [selected, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const outstandingTotal = detail.invoices.reduce((s, i) => s + Number(i.outstanding || 0), 0);

  const openPay = () => {
    if (!selected) return;
    setPayFor(selected);
    setForm({ amount: String(outstandingTotal), method: 'cash', bank_account_id: String(overview.banks?.[0]?.id || ''), note: '' });
  };

  const pay = async () => {
    if (!(Number(form.amount) > 0)) { addToast(friendlyMessage('validation', { description: 'Enter an amount.' })); return; }
    setBusy(true);
    try {
      await apiJson('/api/admin/accounts-payable', {
        method: 'POST',
        body: JSON.stringify({
          supplier_id: payFor.id,
          amount: Number(form.amount),
          method: form.method,
          bank_account_id: form.method === 'cash' ? null : form.bank_account_id,
          note: form.note,
          external_ref: keyRef.current,
        }),
      });
      addToast(friendlyMessage('save_success', { description: 'Supplier payment posted.' }));
      keyRef.current = newKey();
      setPayFor(null);
      setSelectedInvoice(null);
      load();
      setSelected((prev) => (prev ? { ...prev } : prev)); // retrigger detail refetch
    } catch (error) { addToast(friendlyFromError(error, 'save_failed')); }
    finally { setBusy(false); }
  };

  const visibleSuppliers = useMemo(() => {
    const list = overview.payables || [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((s) => s.name?.toLowerCase().includes(q));
  }, [overview.payables, query]);

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Supplier Ledger</h1>
        <p className="mt-1 text-sm text-gray-500">Manage supplier statements and payments.</p>
      </header>

      <div className="space-y-6 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="rounded-2xl border border-gray-900 bg-gray-900 px-5 py-4 text-white">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Total outstanding to suppliers</span>
            <span className="text-xl font-bold tabular-nums">{money(overview.payables.reduce((s, p) => s + Number(p.outstanding || 0), 0))}</span>
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
          <p className="text-xs text-gray-400">Applies to the statement inside each supplier&rsquo;s ledger — the list below is everyone currently owed.</p>

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
              placeholder="Search supplier by name..."
              className={`${INPUT} pl-9`}
            />
          </div>
        </div>

        {!loading && visibleSuppliers.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100">
              <Building2 className="h-6 w-6 text-gray-400" />
            </div>
            <h3 className="text-base font-bold text-gray-900">{query ? 'No match' : 'No Outstanding Payables'}</h3>
            <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
              {query ? 'No supplier matches that search.' : "You don't owe any supplier anything right now."}
            </p>
            {!query && (
              <div className="mx-auto mt-6 flex max-w-md flex-col items-center gap-2 sm:flex-row sm:justify-center">
                <span className="inline-flex items-center gap-2 rounded-full bg-gray-50 px-4 py-2 text-xs font-medium text-gray-600"><Wallet className="h-3.5 w-3.5" />Track payments</span>
                <span className="inline-flex items-center gap-2 rounded-full bg-gray-50 px-4 py-2 text-xs font-medium text-gray-600"><ShieldAlert className="h-3.5 w-3.5" />Monitor dues</span>
              </div>
            )}
          </div>
        ) : (
          <Panel title={`Suppliers with dues (${visibleSuppliers.length})`}>
            <div className="divide-y divide-gray-100">
              {visibleSuppliers.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => openSupplier(s)}
                  className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-gray-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">{s.name}</p>
                    {s.phone && <p className="text-xs text-gray-400">{s.phone}</p>}
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-rose-700">{money(s.outstanding)}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                </button>
              ))}
            </div>
          </Panel>
        )}
      </div>

      {/* Supplier popup */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{selected.name}</h2>
                <p className="text-sm text-gray-500">{selected.phone || 'No phone on file'}</p>
              </div>
              <button type="button" onClick={closeSupplier} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <div className="rounded-xl bg-gray-50 px-4 py-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Outstanding balance</span>
                  <span className="text-lg font-bold tabular-nums text-gray-900">{money(outstandingTotal)}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Link href={suppliersPath} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  <ExternalLink className="h-4 w-4" /> Suppliers list
                </Link>
                <button type="button" disabled={outstandingTotal <= 0} onClick={openPay} className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-40">
                  Pay supplier
                </button>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-gray-900">Open purchase invoices</h3>
                <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
                  {detail.invoices.map((inv, i) => (
                    <button
                      key={inv.purchase_id || i}
                      type="button"
                      onClick={() => setSelectedInvoice(inv)}
                      className="flex w-full flex-wrap items-center gap-3 bg-white px-4 py-3 text-left hover:bg-gray-50"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-gray-900">{inv.invoice_number || inv.description || `Purchase #${inv.purchase_id || '—'}`}</span>
                        <span className="block text-xs text-gray-400">{formatNepalDisplay(String(inv.date || '').slice(0, 10))}</span>
                      </span>
                      <span className="text-sm tabular-nums text-gray-500">{money(inv.total)}</span>
                      <span className="text-sm font-semibold tabular-nums text-rose-700">{money(inv.outstanding)} due</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                    </button>
                  ))}
                  {!loadingDetail && detail.invoices.length === 0 && (
                    <p className="bg-white px-4 py-8 text-center text-sm text-gray-500">No open invoices for this supplier.</p>
                  )}
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-gray-900">Statement</h3>
                <LedgerTable
                  lines={detail.statement}
                  debitNormal={false}
                  loading={loadingDetail}
                  empty="No transactions in this date range."
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Invoice popup, stacked above the supplier popup — view-only: supplier
          payments settle oldest-invoice-first, there's no per-invoice ledger to pay against. */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white overflow-hidden">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{selectedInvoice.invoice_number || selectedInvoice.description || `Purchase #${selectedInvoice.purchase_id || '—'}`}</h2>
                <p className="text-sm text-gray-500">{formatNepalDisplay(String(selectedInvoice.date || '').slice(0, 10))}</p>
              </div>
              <button type="button" onClick={() => setSelectedInvoice(null)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="rounded-xl bg-gray-50 px-4 py-3 space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Invoice total</span><span className="font-semibold tabular-nums text-gray-900">{money(selectedInvoice.total)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Outstanding</span><span className="font-bold tabular-nums text-rose-700">{money(selectedInvoice.outstanding)}</span></div>
              </div>
              <p className="text-xs text-gray-400">Supplier payments settle the oldest open invoice first, so paying here pays the supplier, applied automatically starting with this or an older invoice.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={outstandingTotal <= 0} onClick={openPay} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-40">
                  Pay supplier
                </button>
                {selectedInvoice.purchase_id && (
                  <Link href="/admin/purchases" className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                    <ExternalLink className="h-4 w-4" /> Open in Purchases
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {payFor && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-t-2xl bg-white p-6 sm:rounded-2xl sm:p-8 max-h-[94dvh] overflow-y-auto">
            <h3 className="mb-1 text-lg font-bold text-gray-900">Pay {payFor.name}</h3>
            <p className="mb-4 text-sm text-gray-500">Outstanding {money(outstandingTotal)}</p>
            <div className="space-y-3">
              <Field label="Amount"><input type="number" min="0" step="any" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className={INPUT} /></Field>
              <Field label="Method">
                <select value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))} className={INPUT}>
                  <option value="cash">Cash</option>
                  <option value="bank">Bank</option>
                  <option value="cheque">Cheque</option>
                </select>
              </Field>
              {form.method !== 'cash' && (
                <Field label="Bank account">
                  <select value={form.bank_account_id} onChange={(e) => setForm((f) => ({ ...f, bank_account_id: e.target.value }))} className={INPUT}>
                    {overview.banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Note"><input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className={INPUT} placeholder="optional" /></Field>
            </div>
            <div className="mt-6 flex gap-3">
              <button disabled={busy} onClick={pay} className="flex-1 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
                {busy ? 'Saving…' : 'Post payment'}
              </button>
              <button type="button" onClick={() => setPayFor(null)} className="flex-1 rounded-lg bg-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-300">Cancel</button>
            </div>
          </div>
        </div>
      )}
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

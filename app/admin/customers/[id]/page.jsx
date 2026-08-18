'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AdminLayout from '@/components/admin/admin-layout';
import { ArrowLeft, Phone, Mail, MapPin, CreditCard, Receipt, ShoppingBag, Loader2, Tag } from 'lucide-react';
import { formatNepalDateTime } from '@/lib/report-dates.js';
import { formatCurrency } from '@/lib/currency';
import { orderTypeLabel } from '@/lib/order-types';
import { apiJson } from '@/lib/authed-fetch';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { adminInputClass } from '@/components/ui/admin-form';
import QrEnlargeModal from '@/components/billing/qr-enlarge-modal';

const QR_PROVIDERS = ['Fonepay', 'eSewa', 'Khalti', 'Bank QR', 'Other'];
const INPUT = adminInputClass;

function authHeaders() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('pos_token') : null;
  return { Authorization: `Bearer ${token}` };
}

function newKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`;
}

function customersPath() {
  return typeof window !== 'undefined' && window.location.pathname.startsWith('/cashier')
    ? '/cashier/customers'
    : '/admin/customers';
}

export default function CustomerProfilePage() {
  const { id } = useParams();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('orders');
  const { addToast } = useToast();

  const [settings, setSettings] = useState({});
  const [banks, setBanks] = useState([]);
  const [qrModal, setQrModal] = useState({ open: false, title: '', image: '' });
  const [payFor, setPayFor] = useState(null); // 'pay' | 'writeoff' | null
  const [form, setForm] = useState({ amount: '', method: 'cash', bank_account_id: '', qrProvider: 'Fonepay', note: '' });
  const [busy, setBusy] = useState(false);
  const keyRef = useRef(newKey());

  useEffect(() => {
    apiJson('/api/admin/settings').then((r) => setSettings(r.settings || {})).catch(() => {});
    apiJson('/api/admin/accounts-receivable').then((r) => setBanks(r.banks || [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/customers/${id}/profile`, { headers: authHeaders() });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Failed to load profile');
      setData(j);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center py-24 text-gray-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading customer…
        </div>
      </AdminLayout>
    );
  }

  if (error || !data?.customer) {
    return (
      <AdminLayout>
        <div className="p-8 text-center">
          <p className="text-red-600">{error || 'Customer not found'}</p>
          <button type="button" onClick={() => router.push(customersPath())} className="mt-4 text-sm text-blue-600 underline">
            Back to customers
          </button>
        </div>
      </AdminLayout>
    );
  }

  const { customer, summary, orders, bills, ledger, payments, outstanding_bills } = data;

  const openPay = (mode) => {
    setPayFor(mode);
    setForm({ amount: String(summary.outstanding_credit), method: 'cash', bank_account_id: String(banks[0]?.id || ''), qrProvider: 'Fonepay', note: '' });
  };

  const submitPay = async () => {
    if (!(Number(form.amount) > 0)) { addToast(friendlyMessage('validation', { description: 'Enter an amount.' })); return; }
    setBusy(true);
    try {
      const body = { customer_id: customer.id, amount: Number(form.amount) };
      if (payFor === 'writeoff') {
        body.action = 'writeoff';
        body.reason = form.note;
      } else {
        body.method = form.method;
        body.bank_account_id = form.method === 'bank' ? form.bank_account_id : null;
        body.provider = form.method === 'qr' ? form.qrProvider : null;
        body.note = form.note;
      }
      body.external_ref = keyRef.current;
      await apiJson('/api/admin/accounts-receivable', { method: 'POST', body: JSON.stringify(body) });
      addToast(friendlyMessage('save_success', { description: payFor === 'writeoff' ? 'Discount recorded.' : 'Payment recorded.' }));
      keyRef.current = newKey();
      setPayFor(null);
      await load();
    } catch (error) { addToast(friendlyFromError(error, 'save_failed')); }
    finally { setBusy(false); }
  };

  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => router.push(customersPath())}
          className="mb-4 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" /> Customers
        </button>

        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {customer.name}
                {customer.is_vip ? <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">VIP</span> : null}
                {customer.is_blacklisted ? <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">Blacklisted</span> : null}
              </h1>
              <p className="mt-1 text-sm text-gray-500">Customer #{customer.id} · Since {formatNepalDateTime(customer.created_at)}</p>
              <div className="mt-3 space-y-1 text-sm text-gray-700">
                {customer.phone && <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-gray-400" />{customer.phone}</p>}
                {customer.email && <p className="flex items-center gap-2"><Mail className="h-4 w-4 text-gray-400" />{customer.email}</p>}
                {customer.address && <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-gray-400" />{customer.address}</p>}
              </div>
              {customer.notes && <p className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-600">{customer.notes}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm sm:min-w-[280px]">
              <Stat label="Credit due" value={formatCurrency(summary.outstanding_credit)} tone={summary.outstanding_credit > 0 ? 'red' : 'green'} />
              <Stat label="Credit limit" value={formatCurrency(summary.credit_limit)} />
              <Stat label="Available" value={formatCurrency(summary.available_credit)} />
              <Stat label="Lifetime spent" value={formatCurrency(customer.total_spent)} />
              <Stat label="Visits" value={String(customer.total_visits || 0)} />
              <Stat label="Open invoices" value={String(summary.outstanding_invoices)} />
            </div>
          </div>
          {summary.outstanding_credit > 0 && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-4">
              <button type="button" onClick={() => openPay('pay')} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800">
                Receive payment
              </button>
              <button type="button" onClick={() => openPay('writeoff')} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100">
                <Tag className="h-4 w-4" /> Give discount
              </button>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2 border-b border-gray-200 pb-2">
          {[
            { id: 'orders', label: `Orders (${orders.length})`, icon: ShoppingBag },
            { id: 'bills', label: `Bills (${bills.length})`, icon: Receipt },
            { id: 'ledger', label: 'Credit ledger', icon: CreditCard },
            { id: 'payments', label: `Payments (${payments.length})`, icon: CreditCard },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${tab === t.id ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </div>

        <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          {tab === 'orders' && (
            <SimpleTable
              router={router}
              empty="No orders yet."
              headers={['Order', 'Type', 'Table', 'Total', 'Status', 'When (NPT)']}
              rows={orders.map((o) => ({
                href: `/admin/orders/${o.id}`,
                cells: [
                  <span key="n" className="inline-flex items-center gap-1.5">
                    <span className="font-medium text-blue-700">{o.order_number}</span>
                    {o.was_credit && <CreditBadge />}
                  </span>,
                  orderTypeLabel(o),
                  o.table_number || '—',
                  formatCurrency(o.total),
                  <span key="status" className="capitalize">{String(o.status || '').replace(/_/g, ' ')}</span>,
                  formatNepalDateTime(o.created_at),
                ],
              }))}
            />
          )}
          {tab === 'bills' && (
            <>
              {outstanding_bills?.length > 0 && (
                <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {outstanding_bills.length} invoice(s) still have an outstanding balance.
                </p>
              )}
              <SimpleTable
                router={router}
                empty="No bills yet."
                headers={['Bill', 'Order', 'Total', 'Outstanding', 'Status', 'When (NPT)']}
                rows={bills.map((b) => ({
                  href: b.order_id ? `/admin/orders/${b.order_id}` : undefined,
                  cells: [
                    <span key="b" className="inline-flex items-center gap-1.5">
                      <span className="font-medium text-blue-700">{b.bill_number}</span>
                      {b.was_credit && <CreditBadge />}
                    </span>,
                    b.order_number || '—',
                    formatCurrency(b.grand_total),
                    formatCurrency(b.outstanding_amount || 0),
                    <span key="status" className="capitalize">{String(b.payment_status || b.status || '').replace(/_/g, ' ')}</span>,
                    formatNepalDateTime(b.created_at),
                  ],
                }))}
              />
            </>
          )}
          {tab === 'ledger' && (
            <SimpleTable
              empty="No credit ledger entries."
              headers={['When (NPT)', 'Type', 'Invoice', 'Debit', 'Credit', 'Balance', 'Note']}
              rows={ledger.map((e) => [
                formatNepalDateTime(e.created_at),
                <span key="type" className="capitalize">{String(e.type || '').replace(/_/g, ' ')}</span>,
                e.invoice || '—',
                e.debit ? formatCurrency(e.debit) : '—',
                e.credit ? formatCurrency(e.credit) : '—',
                formatCurrency(e.running_balance),
                e.note || e.reference || '—',
              ])}
            />
          )}
          {tab === 'payments' && (
            <SimpleTable
              empty="No payments recorded."
              headers={['When (NPT)', 'Bill', 'Method', 'Amount', 'Reference']}
              rows={payments.map((p) => [
                formatNepalDateTime(p.created_at),
                p.bill_number || '—',
                <span key="method" className="capitalize">{p.method}{p.provider ? ` · ${p.provider}` : ''}</span>,
                formatCurrency(p.amount),
                p.reference || '—',
              ])}
            />
          )}
        </div>
      </div>

      {payFor && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 max-h-[94dvh] overflow-y-auto">
            <h3 className="mb-1 text-lg font-bold text-gray-900">{payFor === 'writeoff' ? 'Give discount' : 'Receive payment'} — {customer.name}</h3>
            <p className="mb-4 text-sm text-gray-500">Outstanding {formatCurrency(summary.outstanding_credit)}</p>
            <div className="space-y-3">
              <Field label={payFor === 'writeoff' ? 'Discount amount' : 'Amount'}>
                <input type="number" min="0" step="any" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className={INPUT} />
              </Field>
              {payFor === 'pay' && (
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
                        {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
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
                            <button type="button" onClick={() => setQrModal({ open: true, title: 'eSewa / Fonepay QR', image: settings.esewa_qr_image })} className="rounded-lg border border-gray-200 p-2 text-center hover:bg-gray-50">
                              <img src={settings.esewa_qr_image} alt="eSewa / Fonepay QR" className="mx-auto h-24 w-24 object-contain" />
                              <p className="mt-1 text-[11px] text-gray-500">Tap to enlarge</p>
                            </button>
                          )}
                          {settings.bank_qr_image && (
                            <button type="button" onClick={() => setQrModal({ open: true, title: 'Bank QR', image: settings.bank_qr_image })} className="rounded-lg border border-gray-200 p-2 text-center hover:bg-gray-50">
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
              <Field label={payFor === 'writeoff' ? 'Reason' : 'Note'}>
                <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className={INPUT} placeholder={payFor === 'writeoff' ? 'e.g. loyalty discount, goodwill' : 'optional'} />
              </Field>
            </div>
            <div className="mt-6 flex gap-3">
              <button disabled={busy} onClick={submitPay} className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 ${payFor === 'writeoff' ? 'bg-amber-600' : 'bg-gray-900'}`}>
                {busy ? 'Saving…' : payFor === 'writeoff' ? 'Apply discount' : 'Post payment'}
              </button>
              <button type="button" onClick={() => setPayFor(null)} className="flex-1 rounded-lg bg-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-300">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <QrEnlargeModal open={qrModal.open} title={qrModal.title} image={qrModal.image} onClose={() => setQrModal({ open: false, title: '', image: '' })} />
    </AdminLayout>
  );
}

function CreditBadge() {
  return <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-700">Credit</span>;
}

function Field({ label, children }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>{children}</label>;
}

function Stat({ label, value, tone }) {
  const color = tone === 'red' ? 'text-red-700' : tone === 'green' ? 'text-emerald-700' : 'text-gray-900';
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-0.5 font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function SimpleTable({ headers, rows, empty, router }) {
  if (!rows.length) return <p className="py-10 text-center text-sm text-gray-400">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-gray-100 text-xs uppercase text-gray-400">
          <tr>{headers.map((h) => <th key={h} className="px-2 py-2 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map((row, i) => {
            const cells = row.cells || row;
            const href = row.href;
            return (
              <tr key={i} onClick={href ? () => router.push(href) : undefined} className={`hover:bg-gray-50 ${href ? 'cursor-pointer' : ''}`}>
                {cells.map((c, j) => <td key={j} className="px-2 py-2.5 text-gray-700">{c}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

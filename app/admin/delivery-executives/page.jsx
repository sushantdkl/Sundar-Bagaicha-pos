'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AdminLayout from '@/components/admin/admin-layout';
import { Bike, Download, Loader2, Pencil, Plus, X } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { apiJson } from '@/lib/authed-fetch';
import { friendlyFromError } from '@/lib/friendly-message';
import { formatCurrency } from '@/lib/currency';

const STATUSES = [
  ['AVAILABLE', 'Available'],
  ['BUSY', 'Busy'],
  ['OFF_DUTY', 'Off duty'],
];

const TONE = {
  AVAILABLE: 'bg-emerald-50 text-emerald-700',
  BUSY: 'bg-amber-50 text-amber-700',
  OFF_DUTY: 'bg-gray-100 text-gray-600',
};

const EMPTY = { name: '', phone: '', email: '', status: 'AVAILABLE', notes: '' };

const INPUT = 'h-10 w-full border border-gray-300 bg-white px-3 text-sm text-gray-900';
const BTN = 'inline-flex h-10 items-center justify-center gap-2 border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';
const PRIMARY = 'inline-flex h-10 items-center justify-center gap-2 border border-gray-950 bg-gray-950 px-4 text-sm font-semibold text-white hover:bg-black disabled:opacity-50 [color:#fff!important]';
const SMALL = 'inline-flex h-8 items-center gap-1 border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';

/**
 * Delivery executives.
 *
 * The delivered counts and amounts on this page are read from the orders and
 * bills that already exist — this screen attributes sales, it does not create
 * them, so nothing here can change the business's revenue.
 */
export default function DeliveryExecutivesPage() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const d = await apiJson(`/api/admin/delivery-executives${showInactive ? '?all=1' : ''}`);
      setRows(d.executives || []);
    } catch (e) {
      setError(e?.error || e?.message || 'Request failed.');
    } finally {
      setLoading(false);
    }
  }, [showInactive]);

  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (!form.name.trim()) { addToast({ type: 'error', title: 'Name is required.' }); return; }
    if (!form.phone.trim()) { addToast({ type: 'error', title: 'Phone is required.' }); return; }
    setSaving(true);
    try {
      const editing = Boolean(form.id);
      await apiJson(
        editing ? `/api/admin/delivery-executives/${form.id}` : '/api/admin/delivery-executives',
        { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(form) }
      );
      addToast({ type: 'success', title: editing ? 'Executive updated.' : 'Delivery executive added.' });
      setForm(null);
      await load();
    } catch (err) {
      addToast(friendlyFromError(err, 'save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (row, status) => {
    try {
      await apiJson(`/api/admin/delivery-executives/${row.id}`, {
        method: 'PATCH', body: JSON.stringify({ status }),
      });
      addToast({ type: 'success', title: `${row.name} is now ${STATUSES.find(([v]) => v === status)?.[1]}.` });
      await load();
    } catch (err) {
      addToast(friendlyFromError(err, 'save_failed'));
    }
  };

  const deactivate = async (row) => {
    try {
      await apiJson(`/api/admin/delivery-executives/${row.id}`, {
        method: 'PATCH', body: JSON.stringify({ is_active: !row.is_active }),
      });
      addToast({ type: 'success', title: row.is_active ? 'Executive deactivated.' : 'Executive restored.' });
      await load();
    } catch (err) {
      addToast(friendlyFromError(err, 'save_failed'));
    }
  };

  /** CSV of exactly what is on screen, built in the browser — no new dependency. */
  const exportCsv = () => {
    if (!rows.length) { addToast({ type: 'error', title: 'Nothing to export.' }); return; }
    const header = ['Name', 'Phone', 'Email', 'Status', 'Active deliveries', 'Completed deliveries', 'Delivered sales'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const body = rows.map((r) => [
      r.name, r.phone, r.email || '',
      STATUSES.find(([v]) => v === r.status)?.[1] || r.status,
      r.active_deliveries ?? 0, r.completed_deliveries ?? 0, Number(r.delivered_amount || 0).toFixed(2),
    ].map(esc).join(','));

    const blob = new Blob([[header.map(esc).join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `delivery-executives-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-orange-700">Operations</p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900">Delivery Executives</h1>
            <p className="mt-1 max-w-3xl text-sm text-gray-500">
              Manage delivery staff and see what each of them has delivered.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={exportCsv} className={BTN}>
              <Download className="h-4 w-4" />Export
            </button>
            <button type="button" onClick={() => setForm({ ...EMPTY })} className={PRIMARY}>
              <Plus className="h-4 w-4" />Add Executive
            </button>
          </div>
        </div>
      </header>

      <main className="space-y-4 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox" className="h-4 w-4"
            checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show deactivated
        </label>

        {loading ? (
          <section className="flex items-center justify-center border border-gray-200 bg-white py-16">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            <span className="ml-2 text-sm text-gray-500">Loading…</span>
          </section>
        ) : error ? (
          <section className="border border-red-200 bg-red-50 p-6 text-sm text-red-800">
            <p className="font-semibold">Could not load delivery executives.</p>
            <p className="mt-1">{error}</p>
          </section>
        ) : !rows.length ? (
          <section className="border border-gray-200 bg-white px-6 py-16 text-center">
            <Bike className="mx-auto h-8 w-8 text-gray-300" />
            <p className="mt-3 text-base font-semibold text-gray-900">No delivery executives yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
              Add your first delivery executive to start assigning orders.
            </p>
            <div className="mt-5 flex justify-center">
              <button type="button" onClick={() => setForm({ ...EMPTY })} className={PRIMARY}>
                <Plus className="h-4 w-4" />Add Executive
              </button>
            </div>
          </section>
        ) : (
          <section className="border border-gray-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Executive</th>
                    <th className="px-4 py-3 font-semibold">Phone</th>
                    <th className="px-4 py-3 font-semibold">Email</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Active</th>
                    <th className="px-4 py-3 text-right font-semibold">Completed</th>
                    <th className="px-4 py-3 text-right font-semibold">Delivered sales</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/delivery-executives/${r.id}`}
                          className="font-semibold text-gray-900 hover:underline"
                        >
                          {r.name}
                        </Link>
                        {!r.is_active && <div className="text-xs text-gray-500">Deactivated</div>}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-gray-700">{r.phone}</td>
                      <td className="px-4 py-3 text-gray-600">{r.email || <span className="text-gray-400">—</span>}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block whitespace-nowrap px-2 py-1 text-xs font-semibold ${TONE[r.status] || TONE.OFF_DUTY}`}>
                          {STATUSES.find(([v]) => v === r.status)?.[1] || r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">{r.active_deliveries ?? 0}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">{r.completed_deliveries ?? 0}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        {formatCurrency(r.delivered_amount || 0)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Link href={`/admin/delivery-executives/${r.id}`} className={SMALL}>View</Link>
                          <button
                            type="button" className={SMALL}
                            onClick={() => setForm({
                              id: r.id, name: r.name, phone: r.phone, email: r.email || '',
                              status: r.status, notes: r.notes || '',
                            })}
                          >
                            <Pencil className="h-3.5 w-3.5" />Edit
                          </button>
                          <select
                            value={r.status} aria-label={`Status for ${r.name}`}
                            onChange={(e) => setStatus(r, e.target.value)}
                            className="h-8 border border-gray-300 bg-white px-2 text-xs text-gray-700"
                          >
                            {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                          <button type="button" className={SMALL} onClick={() => deactivate(r)}>
                            {r.is_active ? 'Deactivate' : 'Restore'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      {form && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <form onSubmit={submit} className="my-8 w-full max-w-lg border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h2 className="font-bold text-gray-900">
                {form.id ? `Edit ${form.name}` : 'Add delivery executive'}
              </h2>
              <button
                type="button" onClick={() => setForm(null)} aria-label="Close"
                className="inline-flex h-9 w-9 items-center justify-center border border-gray-300 text-gray-600 hover:bg-gray-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <label className="text-sm font-medium text-gray-700 sm:col-span-2">
                Name<span className="text-red-600"> *</span>
                <input
                  required autoFocus value={form.name} className={`${INPUT} mt-1`}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label className="text-sm font-medium text-gray-700">
                Phone<span className="text-red-600"> *</span>
                <input
                  required value={form.phone} placeholder="98XXXXXXXX" className={`${INPUT} mt-1`}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </label>
              <label className="text-sm font-medium text-gray-700">
                Email
                <input
                  type="email" value={form.email} className={`${INPUT} mt-1`}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
                <span className="mt-1 block text-xs font-normal text-gray-500">Optional</span>
              </label>
              <label className="text-sm font-medium text-gray-700 sm:col-span-2">
                Status
                <select
                  value={form.status} className={`${INPUT} mt-1`}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-gray-700 sm:col-span-2">
                Notes
                <input
                  value={form.notes} className={`${INPUT} mt-1`}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
              <button type="button" onClick={() => setForm(null)} className={BTN}>Cancel</button>
              <button type="submit" disabled={saving} className={PRIMARY}>
                {saving ? 'Saving…' : form.id ? 'Save changes' : 'Add Executive'}
              </button>
            </div>
          </form>
        </div>
      )}
    </AdminLayout>
  );
}

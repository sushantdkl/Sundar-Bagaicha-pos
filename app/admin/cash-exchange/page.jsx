'use client';

import { useEffect, useRef, useState } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { ArrowRight } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import { formatNepalTime } from '@/lib/time-utils';

const METHODS = ['cash', 'bank', 'card', 'esewa', 'khalti', 'qr', 'online'];

export default function CashExchangePage() {
  const { addToast } = useToast();
  const [form, setForm] = useState({ from_method: 'online', to_method: 'cash', amount: '', charge: '', note: '' });
  const [recent, setRecent] = useState([]);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef(newKey());
  const set = (p) => setForm((f) => ({ ...f, ...p }));

  const load = () => apiJson('/api/admin/cash-exchange').then((d) => setRecent(d.exchanges || [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!(Number(form.amount) > 0)) { addToast(friendlyMessage('validation', { description: 'Enter an amount.' })); return; }
    if (form.from_method === form.to_method) { addToast(friendlyMessage('validation', { description: 'Pick two different methods.' })); return; }
    setBusy(true);
    try {
      await apiJson('/api/admin/cash-exchange', { method: 'POST', body: JSON.stringify({ ...form, amount: Number(form.amount), charge: Number(form.charge) || 0, external_ref: keyRef.current }) });
      addToast(friendlyMessage('save_success', { description: 'Exchange recorded and journaled.' }));
      keyRef.current = newKey();
      set({ amount: '', charge: '', note: '' });
      load();
    } catch (error) { addToast(friendlyFromError(error, 'save_failed')); }
    finally { setBusy(false); }
  };

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Cash Exchange</h1>
        <p className="mt-1 text-sm text-gray-500">Swap money between media — e.g. a guest pays online but wants cash back. Posts a balanced journal (no sale).</p>
      </header>

      <div className="space-y-6 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-8">
          <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[1fr_auto_1fr]">
            <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">Customer gives (received)</span>
              <select value={form.from_method} onChange={(e) => set({ from_method: e.target.value })} className={INPUT}>
                {METHODS.map((m) => <option key={m} value={m} className="capitalize">{m}</option>)}
              </select>
            </label>
            <div className="hidden pb-3 text-gray-400 sm:block"><ArrowRight className="h-5 w-5" /></div>
            <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">You return (paid out)</span>
              <select value={form.to_method} onChange={(e) => set({ to_method: e.target.value })} className={INPUT}>
                {METHODS.map((m) => <option key={m} value={m} className="capitalize">{m}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">Amount</span><input type="number" min="0" step="any" value={form.amount} onChange={(e) => set({ amount: e.target.value })} className={INPUT} placeholder="0.00" /></label>
            <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">Charge (optional)</span><input type="number" min="0" step="any" value={form.charge} onChange={(e) => set({ charge: e.target.value })} className={INPUT} placeholder="0" /></label>
            <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">Note</span><input value={form.note} onChange={(e) => set({ note: e.target.value })} className={INPUT} placeholder="optional" /></label>
          </div>
          {Number(form.amount) > 0 && (
            <p className="mt-3 text-sm text-gray-500">
              Receive <span className="font-medium text-gray-900">{form.from_method}</span> Rs {Number(form.amount).toLocaleString()}, pay out{' '}
              <span className="font-medium text-gray-900">{form.to_method}</span> Rs {(Number(form.amount) - (Number(form.charge) || 0)).toLocaleString()}
              {Number(form.charge) > 0 ? ` (Rs ${Number(form.charge).toLocaleString()} charge kept as income)` : ''}.
            </p>
          )}
          <button disabled={busy} onClick={submit} className="mt-4 h-11 rounded-lg bg-gray-900 px-6 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">{busy ? 'Saving…' : 'Record exchange'}</button>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-5 py-4"><h2 className="text-sm font-semibold text-gray-900">Recent exchanges</h2></div>
          <div className="divide-y divide-gray-100">
            {recent.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-5 py-3">
                <span className="text-sm text-gray-900">{r.memo}</span>
                <span className="text-xs text-gray-500">{formatNepalTime(r.created_at)}{r.by_name ? ` · ${r.by_name}` : ''}</span>
              </div>
            ))}
            {recent.length === 0 && <p className="px-5 py-8 text-center text-sm text-gray-500">No exchanges yet.</p>}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

const INPUT = 'h-11 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-900';

function newKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`;
}

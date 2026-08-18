'use client';

import { useEffect, useRef, useState } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import { money } from '@/components/accounting/ledger-table';
import { formatNepalDate } from '@/lib/time-utils';

// Clearing account code -> settlement method key the API expects.
const CODE_METHOD = { '1100': 'card', '1110': 'esewa', '1120': 'khalti', '1130': 'qr', '1140': 'online' };

export default function SettlementsPage() {
  const { addToast } = useToast();
  const [pending, setPending] = useState([]);
  const [history, setHistory] = useState([]);
  const [banks, setBanks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ method: '', gross_amount: '', fee_amount: '', bank_account_id: '', reference: '' });
  const [busy, setBusy] = useState(false);
  const keyRef = useRef(newKey());

  const load = async () => {
    try {
      const d = await apiJson('/api/admin/settlements');
      setPending(d.pending || []);
      setHistory(d.history || []);
      setBanks(d.banks || []);
      setForm((f) => ({ ...f, bank_account_id: f.bank_account_id || String(d.banks?.[0]?.id || '') }));
    } catch (error) { addToast(friendlyFromError(error, 'load_failed')); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const pickMethod = (row) => setForm((f) => ({ ...f, method: CODE_METHOD[row.code] || '', gross_amount: String(row.pending) }));

  const settle = async () => {
    if (!form.method) { addToast(friendlyMessage('validation', { description: 'Pick a method to settle.' })); return; }
    if (!(Number(form.gross_amount) > 0)) { addToast(friendlyMessage('validation', { description: 'Enter the settled amount.' })); return; }
    setBusy(true);
    try {
      await apiJson('/api/admin/settlements', { method: 'POST', body: JSON.stringify({
        method: form.method, gross_amount: Number(form.gross_amount), fee_amount: Number(form.fee_amount) || 0,
        bank_account_id: form.bank_account_id, reference: form.reference, external_ref: keyRef.current,
      }) });
      addToast(friendlyMessage('save_success', { description: 'Settlement recorded to bank.' }));
      keyRef.current = newKey();
      setForm((f) => ({ ...f, gross_amount: '', fee_amount: '', reference: '' }));
      load();
    } catch (error) { addToast(friendlyFromError(error, 'save_failed')); }
    finally { setBusy(false); }
  };

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Payment Settlement</h1>
        <p className="mt-1 text-sm text-gray-500">Digital payments sit in clearing until the processor pays out. Settle to move them into the bank.</p>
      </header>

      <div className="space-y-6 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {pending.filter((p) => Number(p.pending) !== 0).map((p) => (
            <button key={p.code} onClick={() => pickMethod(p)} className="rounded-2xl border border-gray-200 bg-white p-4 text-left hover:border-gray-400">
              <p className="text-sm text-gray-500">{p.name}</p>
              <p className="mt-1 text-xl font-bold text-gray-900">{money(p.pending)}</p>
              <p className="mt-1 text-xs text-gray-400">pending settlement</p>
            </button>
          ))}
          {!loading && pending.every((p) => Number(p.pending) === 0) && <p className="text-sm text-gray-500">Nothing pending — all digital payments are settled.</p>}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Settle a payout</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">Method</span>
              <select value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))} className={INPUT}>
                <option value="">Select…</option>
                {['card', 'esewa', 'khalti', 'qr', 'online'].map((m) => <option key={m} value={m} className="capitalize">{m}</option>)}
              </select>
            </label>
            <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">Gross amount</span><input type="number" min="0" step="any" value={form.gross_amount} onChange={(e) => setForm((f) => ({ ...f, gross_amount: e.target.value }))} className={INPUT} /></label>
            <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">Fee</span><input type="number" min="0" step="any" value={form.fee_amount} onChange={(e) => setForm((f) => ({ ...f, fee_amount: e.target.value }))} className={INPUT} placeholder="0" /></label>
            <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">Into bank</span>
              <select value={form.bank_account_id} onChange={(e) => setForm((f) => ({ ...f, bank_account_id: e.target.value }))} className={INPUT}>
                {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">Reference</span><input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} className={INPUT} placeholder="optional" /></label>
          </div>
          <button disabled={busy || !banks.length} onClick={settle} className="mt-4 h-11 rounded-lg bg-gray-900 px-5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">{busy ? 'Saving…' : 'Settle to bank'}</button>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-5 py-4"><h2 className="text-sm font-semibold text-gray-900">Settlement history</h2></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr><th className="px-4 py-3 font-semibold">Date</th><th className="px-4 py-3 font-semibold">Method</th><th className="px-4 py-3 font-semibold">Bank</th><th className="px-4 py-3 text-right font-semibold">Gross</th><th className="px-4 py-3 text-right font-semibold">Fee</th><th className="px-4 py-3 text-right font-semibold">Net</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-600">{formatNepalDate(s.settled_at)}</td>
                    <td className="px-4 py-2.5 capitalize text-gray-900">{s.method}</td>
                    <td className="px-4 py-2.5 text-gray-600">{s.bank_name || '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{money(s.gross_amount)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-rose-700">{money(s.fee_amount)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">{money(s.net_amount)}</td>
                  </tr>
                ))}
                {!loading && history.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-500">No settlements yet.</td></tr>}
              </tbody>
            </table>
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

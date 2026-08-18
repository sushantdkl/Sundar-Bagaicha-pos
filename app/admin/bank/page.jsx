'use client';

import { useEffect, useRef, useState } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { Plus, ArrowRightLeft, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';

const KINDS = [
  { id: 'deposit', label: 'Deposit (cash → bank)', icon: ArrowDownToLine },
  { id: 'withdrawal', label: 'Withdraw (bank → cash)', icon: ArrowUpFromLine },
  { id: 'transfer', label: 'Transfer (bank → bank)', icon: ArrowRightLeft },
];

export default function BankPage() {
  const { addToast } = useToast();
  const [banks, setBanks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [newBank, setNewBank] = useState({ name: '', account_number: '' });
  const [form, setForm] = useState({ action: 'deposit', amount: '', bank_account_id: '', to_bank_account_id: '', note: '' });
  const [busy, setBusy] = useState(false);
  const keyRef = useRef(newKey());

  const load = async () => {
    try {
      const d = await apiJson('/api/admin/bank');
      setBanks(d.banks || []);
      setForm((f) => ({ ...f, bank_account_id: f.bank_account_id || String(d.banks?.[0]?.id || '') }));
    } catch (error) { addToast(friendlyFromError(error, 'load_failed')); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const addBank = async () => {
    if (!newBank.name.trim()) { addToast(friendlyMessage('validation', { description: 'Bank name required.' })); return; }
    try {
      await apiJson('/api/admin/bank', { method: 'POST', body: JSON.stringify({ action: 'add_account', ...newBank }) });
      setNewBank({ name: '', account_number: '' }); setAddOpen(false); load();
    } catch (error) { addToast(friendlyFromError(error, 'save_failed')); }
  };

  const submit = async () => {
    if (!(Number(form.amount) > 0)) { addToast(friendlyMessage('validation', { description: 'Enter an amount.' })); return; }
    setBusy(true);
    try {
      await apiJson('/api/admin/bank', { method: 'POST', body: JSON.stringify({ ...form, amount: Number(form.amount), external_ref: keyRef.current }) });
      addToast(friendlyMessage('save_success', { description: 'Recorded and journaled.' }));
      keyRef.current = newKey();
      setForm((f) => ({ ...f, amount: '', note: '' }));
    } catch (error) { addToast(friendlyFromError(error, 'save_failed')); }
    finally { setBusy(false); }
  };

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Bank</h1>
            <p className="mt-1 text-sm text-gray-500">Move money between cash and bank. Every action posts a balanced journal.</p>
          </div>
          <button onClick={() => setAddOpen((o) => !o)} className="inline-flex items-center gap-1.5 self-start rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            <Plus className="h-4 w-4" /> Add bank account
          </button>
        </div>
      </header>

      <div className="space-y-6 bg-gray-50 p-4 sm:p-6 lg:p-8">
        {addOpen && (
          <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-gray-200 bg-white p-4">
            <label className="block"><span className="mb-1 block text-xs font-medium text-gray-500">Bank name</span><input value={newBank.name} onChange={(e) => setNewBank((b) => ({ ...b, name: e.target.value }))} className={INPUT} placeholder="e.g. NIC Asia" /></label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-gray-500">Account number</span><input value={newBank.account_number} onChange={(e) => setNewBank((b) => ({ ...b, account_number: e.target.value }))} className={INPUT} placeholder="optional" /></label>
            <button onClick={addBank} className="h-11 rounded-lg bg-gray-900 px-5 text-sm font-medium text-white hover:bg-gray-800">Add</button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {banks.map((b) => (
            <div key={b.id} className="rounded-2xl border border-gray-200 bg-white p-4">
              <p className="font-semibold text-gray-900">{b.name}</p>
              <p className="text-xs text-gray-500">{b.account_number || 'No account number'}</p>
            </div>
          ))}
          {!loading && banks.length === 0 && <p className="text-sm text-gray-500">No bank accounts yet.</p>}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Record a movement</h2>
          <div className="mb-4 flex flex-wrap gap-2">
            {KINDS.map((k) => (
              <button key={k.id} onClick={() => setForm((f) => ({ ...f, action: k.id }))} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${form.action === k.id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
                <k.icon className="h-4 w-4" /> {k.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">{form.action === 'transfer' ? 'From bank' : 'Bank account'}</span>
              <select value={form.bank_account_id} onChange={(e) => setForm((f) => ({ ...f, bank_account_id: e.target.value }))} className={INPUT}>
                {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            {form.action === 'transfer' && (
              <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">To bank</span>
                <select value={form.to_bank_account_id} onChange={(e) => setForm((f) => ({ ...f, to_bank_account_id: e.target.value }))} className={INPUT}>
                  <option value="">Select…</option>
                  {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            )}
            <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">Amount</span><input type="number" min="0" step="any" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className={INPUT} placeholder="0.00" /></label>
            <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">Note</span><input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className={INPUT} placeholder="optional" /></label>
          </div>
          <button disabled={busy || !banks.length} onClick={submit} className="mt-4 h-11 rounded-lg bg-gray-900 px-5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">{busy ? 'Saving…' : 'Record'}</button>
        </div>
      </div>
    </AdminLayout>
  );
}

const INPUT = 'h-11 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-900';

// Idempotency key: same value on a double-submit/retry, fresh per new operation.
function newKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`;
}

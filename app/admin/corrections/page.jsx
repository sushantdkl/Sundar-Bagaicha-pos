'use client';

import { useEffect, useRef, useState } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { RotateCcw, Ban, Undo2 } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import { money } from '@/components/accounting/ledger-table';
import { formatNepalTime } from '@/lib/time-utils';

const METHODS = ['cash', 'bank', 'card', 'esewa', 'khalti', 'qr', 'online'];

export default function CorrectionsPage() {
  const { addToast } = useToast();
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [refundForm, setRefundForm] = useState({ bill_number: '', full: true, amount: '', method: 'cash', reason: '' });
  const [voidForm, setVoidForm] = useState({ bill_number: '', reason: '', restock: true });
  const [reverseForm, setReverseForm] = useState({ journal_id: '', reason: '' });
  const keyRef = useRef(newKey());

  const load = () => apiJson('/api/admin/corrections').then((d) => setHistory(d.bill_corrections || [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const post = async (body, done) => {
    setBusy(true);
    try {
      await apiJson('/api/admin/corrections', { method: 'POST', body: JSON.stringify(body) });
      addToast(friendlyMessage('save_success', { description: 'Posted to the ledger.' }));
      done?.();
      load();
    } catch (error) { addToast(friendlyFromError(error, 'save_failed')); }
    finally { setBusy(false); }
  };

  const doRefund = () => {
    if (!refundForm.bill_number.trim()) { addToast(friendlyMessage('validation', { description: 'Enter the bill number.' })); return; }
    if (!refundForm.full && !(Number(refundForm.amount) > 0)) { addToast(friendlyMessage('validation', { description: 'Enter a refund amount.' })); return; }
    if (!refundForm.reason.trim()) { addToast(friendlyMessage('validation', { description: 'A reason is required.' })); return; }
    post(
      { action: 'refund', bill_number: refundForm.bill_number.trim(), full: refundForm.full, amount: refundForm.full ? undefined : Number(refundForm.amount), method: refundForm.method, reason: refundForm.reason },
      () => { keyRef.current = newKey(); setRefundForm((f) => ({ ...f, bill_number: '', amount: '', reason: '' })); }
    );
  };
  const doVoid = () => {
    if (!voidForm.bill_number.trim()) { addToast(friendlyMessage('validation', { description: 'Enter the bill number.' })); return; }
    if (!voidForm.reason.trim()) { addToast(friendlyMessage('validation', { description: 'A reason is required.' })); return; }
    post({ action: 'void_bill', bill_number: voidForm.bill_number.trim(), reason: voidForm.reason, restock: voidForm.restock }, () => setVoidForm({ bill_number: '', reason: '', restock: true }));
  };
  const doReverse = () => {
    if (!reverseForm.journal_id) { addToast(friendlyMessage('validation', { description: 'Enter the journal id.' })); return; }
    post({ action: 'reverse', journal_id: Number(reverseForm.journal_id), reason: reverseForm.reason }, () => setReverseForm({ journal_id: '', reason: '' }));
  };

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Corrections &amp; Reversals</h1>
        <p className="mt-1 text-sm text-gray-500">Refunds, bill voids and journal reversals — each posts a proper contra entry. Nothing is deleted.</p>
      </header>

      <div className="space-y-6 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Card icon={Undo2} title="Refund" hint="Return money for a served bill. Full or partial; over-refund is blocked. Stock stays consumed.">
            <Field label="Bill number"><input value={refundForm.bill_number} onChange={(e) => setRefundForm((f) => ({ ...f, bill_number: e.target.value }))} className={INPUT} placeholder="e.g. BILL-000123" /></Field>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={refundForm.full} onChange={(e) => setRefundForm((f) => ({ ...f, full: e.target.checked }))} className="h-4 w-4 rounded border-gray-300" /> Full refund
            </label>
            {!refundForm.full && <Field label="Amount"><input type="number" min="0" step="any" value={refundForm.amount} onChange={(e) => setRefundForm((f) => ({ ...f, amount: e.target.value }))} className={INPUT} /></Field>}
            <Field label="Method">
              <select value={refundForm.method} onChange={(e) => setRefundForm((f) => ({ ...f, method: e.target.value }))} className={INPUT}>
                {METHODS.map((m) => <option key={m} value={m} className="capitalize">{m}</option>)}
              </select>
            </Field>
            <Field label="Reason"><input value={refundForm.reason} onChange={(e) => setRefundForm((f) => ({ ...f, reason: e.target.value }))} className={INPUT} placeholder="required" /></Field>
            <button disabled={busy} onClick={doRefund} className={BTN}>Post refund</button>
          </Card>

          <Card icon={Ban} title="Void Bill" hint="Undo a paid bill entirely — reverses sale, payment & tax, cancels the order, frees the table.">
            <Field label="Bill number"><input value={voidForm.bill_number} onChange={(e) => setVoidForm((f) => ({ ...f, bill_number: e.target.value }))} className={INPUT} placeholder="e.g. BILL-000123" /></Field>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={voidForm.restock} onChange={(e) => setVoidForm((f) => ({ ...f, restock: e.target.checked }))} className="h-4 w-4 rounded border-gray-300" /> Return items to inventory
            </label>
            <Field label="Reason"><input value={voidForm.reason} onChange={(e) => setVoidForm((f) => ({ ...f, reason: e.target.value }))} className={INPUT} placeholder="required" /></Field>
            <p className="text-xs text-gray-400">To void an order before payment, cancel it from Orders — that already restores stock.</p>
            <button disabled={busy} onClick={doVoid} className={BTN}>Void bill</button>
          </Card>

          <Card icon={RotateCcw} title="Reverse Journal" hint="Post the exact opposite of any journal by its id.">
            <Field label="Journal id"><input type="number" value={reverseForm.journal_id} onChange={(e) => setReverseForm((f) => ({ ...f, journal_id: e.target.value }))} className={INPUT} placeholder="from General Ledger → Journal" /></Field>
            <Field label="Reason"><input value={reverseForm.reason} onChange={(e) => setReverseForm((f) => ({ ...f, reason: e.target.value }))} className={INPUT} /></Field>
            <button disabled={busy} onClick={doReverse} className={BTN}>Reverse</button>
          </Card>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-5 py-4"><h2 className="text-sm font-semibold text-gray-900">Refund &amp; void history</h2></div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {history.map((h) => (
                <tr key={h.id} className="hover:bg-gray-50">
                  <td className="px-5 py-2.5">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${h.type === 'void' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>{h.type}</span>
                  </td>
                  <td className="px-5 py-2.5 font-medium text-gray-900">{h.bill_number || '—'}</td>
                  <td className="px-5 py-2.5 text-gray-600">{h.reason}{h.restocked ? ' · restocked' : ''}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-gray-900">{money(h.amount)}</td>
                  <td className="px-5 py-2.5 text-right text-xs text-gray-500">{formatNepalTime(h.created_at)}{h.by_name ? ` · ${h.by_name}` : ''}</td>
                </tr>
              ))}
              {history.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-500">No refunds or voids yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  );
}

function Card({ icon: Icon, title, hint, children }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-center gap-2"><Icon className="h-5 w-5 text-gray-500" /><h3 className="text-sm font-semibold text-gray-900">{title}</h3></div>
      <p className="mb-4 text-xs text-gray-500">{hint}</p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
function Field({ label, children }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>{children}</label>;
}
const INPUT = 'h-11 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-900';
const BTN = 'mt-1 h-11 w-full rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50';
function newKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`;
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Plus, Trash2, X } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';
import { money, errText, PAYMENT_METHODS } from '../event-ui';

/**
 * Bill Event — the settlement dialog.
 *
 * This is the action the whole simple workflow turns on: a confirmed birthday
 * is billed here and nowhere else. It opens on the server's own statement
 * (GET .../billing) rather than anything assembled in the browser, so what the
 * cashier is asked to collect is exactly what the server will charge.
 *
 * Settling recognises the sale, releases the advance, issues a bill from the
 * shared sequence and completes the event — in one transaction, on the server.
 * The dialog's only jobs are to show the arithmetic and collect the split.
 */
export default function SettlementDialog({ event, onClose, onSettled, addToast }) {
  const [statement, setStatement] = useState(null);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([{ method: 'cash', amount: '', reference_number: '' }]);
  const [busy, setBusy] = useState(false);
  // Minted on first submit and reused, so a double-click or a retry after a
  // timeout cannot produce a second Rs 100,000 bill.
  const keyRef = useRef(null);

  useEffect(() => {
    let alive = true;
    apiJson(`/api/admin/events/${event.id}/billing`)
      .then((d) => {
        if (!alive) return;
        setStatement(d);
        // Prefill the balance in cash — overwhelmingly the common settlement —
        // here in the callback rather than in a second effect watching the
        // first, which would need its own dependency exemption to avoid looping.
        const due = Number(d?.balance_due ?? 0);
        setRows([{ method: 'cash', amount: due > 0 ? String(due) : '', reference_number: '' }]);
      })
      .catch((e) => { if (alive) setError(errText(e)); });
    return () => { alive = false; };
  }, [event.id]);

  const balanceDue = Number(statement?.balance_due ?? 0);

  const collected = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const shortfall = Math.round((balanceDue - collected) * 100) / 100;
  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const payments = rows
      .map((r) => ({
        method: r.method,
        amount: Number(r.amount) || 0,
        reference_number: r.reference_number.trim() || undefined,
      }))
      .filter((p) => p.amount > 0);

    if (!keyRef.current) {
      keyRef.current = `evt-bill-${event.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    setBusy(true);
    try {
      const res = await apiJson(`/api/admin/events/${event.id}/billing`, {
        method: 'POST',
        body: JSON.stringify({
          payments,
          idempotency_key: keyRef.current,
          // A short settlement is a deliberate decision (approved credit), so it
          // is sent explicitly rather than inferred from the numbers.
          allow_partial: shortfall > 0.009,
        }),
      });
      addToast({
        type: 'success',
        title: `${event.event_number} settled`,
        description: res.bill?.bill_number
          ? `Bill ${res.bill.bill_number} · ${money(res.revenue_recognised)} recognised.`
          : 'The event is completed.',
      });
      await onSettled(res);
    } catch (err) {
      addToast({ type: 'error', title: 'Could not settle the event', description: errText(err) });
      setBusy(false);
    }
  };

  return (
    <div className="evx-backdrop">
      <form className="evx-dialog evx-dialog-wide" onSubmit={submit}>
        <div className="evx-dialog-head">
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>Bill {event.event_number}</h2>
            <p className="panel-sub">Settling recognises the sale, issues a bill and completes the event.</p>
          </div>
          <button type="button" onClick={onClose} className="btn-square btn-square-lg" aria-label="Close">
            <X size={15} />
          </button>
        </div>

        {error && (
          <div style={{ padding: 20 }}>
            <div className="note note-error"><AlertTriangle size={16} /><p style={{ margin: 0 }}>{error}</p></div>
          </div>
        )}

        {!statement && !error && (
          <p style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--color-neutral-600)' }}>
            Building the statement…
          </p>
        )}

        {statement && (
          <>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <section className="panel">
                <h3 className="panel-title" style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-divider)' }}>
                  What is owed
                </h3>
                <Line label="Contracted quotation" value={money(statement.contracted_subtotal)} />
                {statement.additional_sales > 0 && (
                  <Line label="Additional orders during the event" value={money(statement.additional_sales)} />
                )}
                {statement.discount > 0 && <Line label="Discount" value={`− ${money(statement.discount)}`} />}
                {statement.service_charge > 0 && (
                  <Line label={`Service charge (${statement.service_charge_percent}%)`} value={money(statement.service_charge)} />
                )}
                {statement.tax > 0 && <Line label={`VAT (${statement.tax_percent}%)`} value={money(statement.tax)} />}
                <Line label="Total" value={money(statement.grand_total)} strong />
                <Line label="Advances already held" value={`− ${money(statement.advances_applied)}`} />
                <Line label="Balance to collect" value={money(statement.balance_due)} strong />
              </section>

              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h3 className="panel-title">Collect</h3>
                    <p className="panel-sub">Add a row for each method to split the settlement.</p>
                  </div>
                  <button
                    type="button" className="btn btn-secondary btn-sm"
                    onClick={() => setRows((rs) => [...rs, { method: 'cash', amount: '', reference_number: '' }])}
                  >
                    <Plus size={14} />Add method
                  </button>
                </div>

                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {rows.map((r, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
                      <label style={{ display: 'block' }}>
                        <span className="field-label">Method</span>
                        <select className="input" value={r.method} onChange={(e) => setRow(i, { method: e.target.value })}>
                          {PAYMENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </label>
                      <label style={{ display: 'block' }}>
                        <span className="field-label">Amount (Rs)</span>
                        <input
                          className="input" type="number" min="0" step="0.01"
                          value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })}
                        />
                      </label>
                      <label style={{ display: 'block' }}>
                        <span className="field-label">Reference</span>
                        <input
                          className="input" value={r.reference_number}
                          onChange={(e) => setRow(i, { reference_number: e.target.value })}
                        />
                      </label>
                      <button
                        type="button" className="btn-square" aria-label="Remove method"
                        disabled={rows.length === 1}
                        onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, borderTop: '1px solid var(--color-divider)', paddingTop: 10 }}>
                    <span style={{ color: 'var(--color-neutral-600)' }}>Collecting</span>
                    <span className="num" style={{ fontWeight: 700 }}>{money(collected)}</span>
                  </div>

                  {shortfall > 0.009 && (
                    <div className="note">
                      <AlertTriangle size={16} />
                      <p style={{ margin: 0 }}>
                        {money(shortfall)} will be left outstanding. The event still completes and the
                        balance stays owed by the customer — settle it only if that credit is agreed.
                      </p>
                    </div>
                  )}
                  {shortfall < -0.009 && (
                    <div className="note note-error">
                      <AlertTriangle size={16} />
                      <p style={{ margin: 0 }}>
                        That is {money(Math.abs(shortfall))} more than the balance. The server will refuse
                        an overpayment — reduce the amount or record a separate refund afterwards.
                      </p>
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div className="evx-dialog-foot">
              <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
              <button type="submit" disabled={busy || shortfall < -0.009} className="btn btn-primary">
                {busy ? 'Settling…' : `Settle ${money(collected)} and complete`}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

function Line({ label, value, strong }) {
  return (
    <div className="drow" style={strong ? { fontWeight: 700 } : undefined}>
      <span className={strong ? undefined : 'drow-label'}>{label}</span>
      <span className="drow-value num">{value}</span>
    </div>
  );
}

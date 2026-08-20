'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Plus, Printer, Trash2, X } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';
import { money, errText, EVENT_SETTLEMENT_METHODS } from '../event-ui';
import { printFinalBill, printProforma } from '@/lib/pos-print.js';

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
export default function SettlementDialog({ event, lines = [], onClose, onSettled, addToast }) {
  const [statement, setStatement] = useState(null);
  const [settings, setSettings] = useState({});
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([{ method: 'cash', amount: '', reference_number: '', provider: '', due_date: '', notes: '' }]);
  const [busy, setBusy] = useState(false);
  // Minted on first submit and reused, so a double-click or a retry after a
  // timeout cannot produce a second Rs 100,000 bill.
  const keyRef = useRef(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      apiJson(`/api/admin/events/${event.id}/billing`),
      apiJson('/api/admin/settings').catch(() => ({ settings: {} })),
    ])
      .then(([d, settingsResult]) => {
        if (!alive) return;
        setStatement(d);
        setSettings(settingsResult.settings || settingsResult || {});
        // Prefill the balance in cash — overwhelmingly the common settlement —
        // here in the callback rather than in a second effect watching the
        // first, which would need its own dependency exemption to avoid looping.
        const due = Number(d?.balance_due ?? 0);
        setRows([{ method: 'cash', amount: due > 0 ? String(due) : '', reference_number: '', provider: '', due_date: '', notes: '' }]);
      })
      .catch((e) => { if (alive) setError(errText(e)); });
    return () => { alive = false; };
  }, [event.id]);

  const balanceDue = Number(statement?.balance_due ?? 0);

  const allocated = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const collected = rows.filter((r) => r.method !== 'credit').reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const credit = rows.filter((r) => r.method === 'credit').reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const shortfall = Math.round((balanceDue - allocated) * 100) / 100;
  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const receiptItems = () => {
    const items = lines.map((line) => ({
      item_name: line.item_name || line.package_name || line.menu_item_current_name || 'Event charge',
      quantity: Number(line.quantity || 0),
      price: line.is_complimentary ? 0 : Number(line.unit_price || 0),
      subtotal: Number(line.line_total || 0),
    }));
    if (Number(statement?.additional_sales || 0) > 0) {
      items.push({
        item_name: 'Additional event orders',
        quantity: 1,
        price: Number(statement.additional_sales),
        subtotal: Number(statement.additional_sales),
      });
    }
    return items;
  };

  const printPreBill = () => {
    if (!statement) return;
    const printed = printProforma({
      workspace: {
        order: {
          order_type: 'event',
          event_number: event.event_number,
          customer_name: event.customer_name || event.contact_name || '',
          table_number: event.space_name || null,
        },
        items: receiptItems(),
      },
      totals: {
        subtotal: statement.subtotal,
        discount: statement.discount,
        tax: statement.tax,
        taxPercent: statement.tax_percent,
        serviceCharge: statement.service_charge,
        servicePercent: statement.service_charge_percent,
        total: statement.grand_total,
      },
    }, { size: settings.receipt_paper_size || '80', settings });
    if (!printed) {
      addToast({ type: 'warning', title: 'Print was blocked', description: 'Allow pop-ups for this site, then print the pre-bill again.' });
    }
  };

  const printSettledBill = (result, payments) => {
    const allocations = [];
    if (Number(result.advances_applied || 0) > 0) {
      allocations.push({ method: 'advance', amount: Number(result.advances_applied) });
    }
    allocations.push(...payments);
    return printFinalBill({
      bill_number: result.bill.bill_number,
      order_number: event.event_number,
      table_number: event.space_name || null,
      order_type: 'event',
      items: receiptItems(),
      subtotal: Number(result.statement.subtotal || 0),
      discount: Number(result.statement.discount || 0),
      tax: Number(result.statement.tax || 0),
      tax_percent: Number(result.statement.tax_percent || 0),
      service_charge: Number(result.statement.service_charge || 0),
      service_charge_percent: Number(result.statement.service_charge_percent || 0),
      delivery_fee: 0,
      grand_total: Number(result.statement.grand_total || 0),
      allocations,
      outstanding: Number(result.bill.outstanding || 0),
      change: 0,
      payment_status: result.bill.status,
      customer_name: event.customer_name || event.contact_name || '',
      customer_phone: event.customer_phone || event.contact_phone || '',
      processed_at: new Date().toISOString(),
      restaurant_name: settings.restaurant_name,
      restaurant_address: settings.restaurant_address,
      restaurant_phone: settings.restaurant_phone,
      vat_number: settings.vat_number,
      pan_number: settings.pan_number,
      receipt_footer: settings.receipt_footer,
    }, { size: settings.receipt_paper_size || '80' });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const allocations = rows
      .map((r) => ({
        method: r.method,
        amount: Number(r.amount) || 0,
        cash_tendered: r.method === 'cash' ? (Number(r.amount) || 0) : undefined,
        provider: r.method === 'qr' ? (r.provider.trim() || undefined) : undefined,
        reference_number: r.reference_number.trim() || undefined,
        due_date: r.method === 'credit' ? (r.due_date || undefined) : undefined,
        notes: r.method === 'credit' ? (r.notes.trim() || undefined) : undefined,
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
          allocations,
          idempotency_key: keyRef.current,
        }),
      });
      addToast({
        type: 'success',
        title: `${event.event_number} settled`,
        description: res.bill?.bill_number
          ? `Bill ${res.bill.bill_number} · ${money(res.revenue_recognised)} recognised.`
          : 'The event is completed.',
      });
      if (!printSettledBill(res, allocations)) {
        addToast({ type: 'warning', title: 'Bill saved but print was blocked', description: 'Allow pop-ups, then reprint the bill from Bills.' });
      }
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
                    onClick={() => setRows((rs) => [...rs, { method: 'cash', amount: '', reference_number: '', provider: '', due_date: '', notes: '' }])}
                  >
                    <Plus size={14} />Add method
                  </button>
                </div>

                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {rows.map((r, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(130px, 1fr) minmax(120px, 1fr) minmax(170px, 1.4fr) auto', gap: 8, alignItems: 'end' }}>
                      <label style={{ display: 'block' }}>
                        <span className="field-label">Method</span>
                        <select className="input" value={r.method} onChange={(e) => setRow(i, { method: e.target.value })}>
                          {EVENT_SETTLEMENT_METHODS.map(([v, l]) => (
                            <option key={v} value={v} disabled={v === 'credit' && !statement.customer}>{l}</option>
                          ))}
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
                        <span className="field-label">
                          {r.method === 'qr' ? 'Provider / reference' : r.method === 'credit' ? 'Due date' : 'Reference (optional)'}
                        </span>
                        {r.method === 'credit' ? (
                          <input className="input" type="date" value={r.due_date} onChange={(e) => setRow(i, { due_date: e.target.value })} />
                        ) : r.method === 'qr' ? (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                            <input className="input" placeholder="eSewa / Fonepay" value={r.provider} onChange={(e) => setRow(i, { provider: e.target.value })} required />
                            <input className="input" placeholder="Reference" value={r.reference_number} onChange={(e) => setRow(i, { reference_number: e.target.value })} />
                          </div>
                        ) : (
                          <input className="input" value={r.reference_number} onChange={(e) => setRow(i, { reference_number: e.target.value })} />
                        )}
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

                  {shortfall > 0.009 && statement.customer && (
                    <button
                      type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}
                      onClick={() => setRows((rs) => [...rs, {
                        method: 'credit', amount: String(shortfall), reference_number: '', provider: '', due_date: '',
                        notes: `Event ${event.event_number} balance`,
                      }])}
                    >
                      Leave {money(shortfall)} on customer credit
                    </button>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, borderTop: '1px solid var(--color-divider)', paddingTop: 10 }}>
                    <span style={{ color: 'var(--color-neutral-600)' }}>Allocated</span>
                    <span className="num" style={{ fontWeight: 700 }}>{money(allocated)}</span>
                  </div>

                  {credit > 0.009 && (
                    <div className="note">
                      <AlertTriangle size={16} />
                      <p style={{ margin: 0 }}>
                        {money(credit)} will be posted to the ledger for {statement.customer?.name || 'the customer'}.
                        Cash and QR received now: {money(collected)}.
                      </p>
                    </div>
                  )}

                  {shortfall > 0.009 && (
                    <div className="note note-error">
                      <AlertTriangle size={16} />
                      <p style={{ margin: 0 }}>
                        Allocate the remaining {money(shortfall)} to Cash, QR or Customer credit before completing.
                        {!statement.customer && ' This event has no linked customer, so credit is unavailable.'}
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
              <button type="button" onClick={printPreBill} className="btn btn-secondary">
                <Printer size={15} />Print pre-bill
              </button>
              <button type="submit" disabled={busy || Math.abs(shortfall) > 0.009} className="btn btn-primary">
                {busy ? 'Settling…' : `Complete sale · ${money(allocated)}`}
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

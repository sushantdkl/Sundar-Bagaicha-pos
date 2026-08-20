'use client';

import { useEffect, useRef, useState } from 'react';
import { CreditCard, X } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';
import { money, dateLabel, errText, pillClass, statusText, PAYMENT_METHODS } from '../event-ui';

/**
 * Money, Payments and Payment schedule — the right-hand rail of the redesign.
 *
 * These read from and write to the real deposits ledger
 * (/api/admin/events/:id/deposits), not local state: a deposit posts a journal
 * entry against customer advances, so the panel is a view onto accounting
 * rather than a tally the screen keeps for itself. That is also why the money
 * shown here comes from the ledger's own `total`/`held`/`outstanding` instead
 * of being recomputed in the browser.
 */
export default function Payments({ event, onChanged, addToast }) {
  const [summary, setSummary] = useState(null);
  const [open, setOpen] = useState(false);
  // Bumped to ask for a fresh read after a payment posts. Reloading through a
  // dependency rather than an imperative call keeps the fetch inside the
  // effect, where setState belongs.
  const [reloadAt, setReloadAt] = useState(0);

  useEffect(() => {
    let alive = true;
    apiJson(`/api/admin/events/${event.id}/deposits`)
      .then((d) => { if (alive) setSummary(d); })
      .catch((e) => {
        if (alive) addToast({ type: 'error', title: 'Could not load payments', description: errText(e) });
      });
    return () => { alive = false; };
  }, [event.id, addToast, reloadAt]);

  // The ledger is authoritative; the event row is the fallback before it lands.
  const total = Number(summary?.total ?? event.total_amount ?? 0);
  const paid = Number(summary?.held ?? event.deposit_total ?? 0);
  const outstanding = Number(summary?.outstanding ?? event.outstanding_amount ?? 0);
  const paidPct = total > 0 ? Math.round(Math.min(100, (paid / total) * 100)) : 0;

  const deposits = summary?.deposits || [];
  const schedule = summary?.schedule || [];
  const cancelled = event.status === 'CANCELLED';

  const afterSave = async () => {
    setOpen(false);
    setReloadAt(Date.now());
    // The event row carries payment_status and outstanding_amount too, so the
    // header pill and the quotation totals have to be refetched with it.
    await onChanged();
  };

  return (
    <>
      <section className="panel">
        <h2 className="panel-title" style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-divider)' }}>Money</h2>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <span style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>Outstanding balance</span>
            <div
              style={{
                fontSize: 32, fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1.1,
                color: outstanding > 0 ? 'var(--color-due)' : 'var(--color-received)',
              }}
            >
              {money(outstanding)}
            </div>
          </div>

          <div className="meter" role="img" aria-label={`${paidPct}% of the quote received`}>
            <div className="meter-fill" style={{ width: `${paidPct}%` }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--color-neutral-600)' }}>
            <span>Paid {paidPct}%</span>
            <span>of {money(total)}</span>
          </div>

          <div
            style={{
              display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14,
              borderTop: '1px solid var(--color-divider)', paddingTop: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--color-neutral-600)' }}>Total quote</span>
              <span className="num" style={{ fontWeight: 700 }}>{money(total)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--color-neutral-600)' }}>Deposits received</span>
              <span className="num" style={{ fontWeight: 700, color: 'var(--color-received)' }}>{money(paid)}</span>
            </div>
          </div>

          {!cancelled && (
            <button
              type="button" className="btn btn-primary btn-block" style={{ height: 44 }}
              onClick={() => setOpen(true)}
            >
              <CreditCard size={16} />Record payment
            </button>
          )}

          <p style={{ margin: 0, fontSize: 11, color: 'var(--color-neutral-600)' }}>
            Deposits are held as a customer advance (a liability) and are not recognised as sales
            revenue until the event is fulfilled.
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Payments</h2>
          <span style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>{deposits.length} recorded</span>
        </div>
        <div>
          {deposits.map((d) => {
            const isRefund = d.entry_type === 'refund';
            const isVoid = d.status === 'void';
            return (
              <div
                key={d.id}
                style={{
                  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
                  padding: '12px 16px', borderBottom: '1px solid var(--color-divider)',
                  opacity: isVoid ? 0.55 : 1,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    className="num"
                    style={{
                      fontWeight: 700, fontSize: 14, textAlign: 'left',
                      textDecoration: isVoid ? 'line-through' : undefined,
                      color: isRefund ? 'var(--color-due)' : undefined,
                    }}
                  >
                    {isRefund ? `− ${money(d.amount)}` : money(d.amount)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>
                    {methodLabel(d.payment_method)}
                    {d.provider ? ` · ${d.provider}` : ''} · {dateLabel(d.received_on)}
                    {isRefund ? ' · Refund' : ''}
                    {isVoid ? ' · Voided' : ''}
                  </div>
                  {d.notes && (
                    <div style={{ fontSize: 12, color: 'var(--color-neutral-600)', overflowWrap: 'anywhere' }}>{d.notes}</div>
                  )}
                  {d.created_by_name && (
                    <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>by {d.created_by_name}</div>
                  )}
                </div>
                {d.reference_number && <span className="tag-neutral">{d.reference_number}</span>}
              </div>
            );
          })}
          {!deposits.length && (
            <div style={{ padding: '20px 16px', textAlign: 'center', fontSize: 13, color: 'var(--color-neutral-600)' }}>
              No payments recorded yet.
            </div>
          )}
        </div>
      </section>

      {schedule.length > 0 && (
        <section className="panel">
          <h2 className="panel-title" style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-divider)' }}>
            Payment schedule
          </h2>
          {schedule.map((s) => (
            <div
              key={s.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                padding: '11px 16px', borderBottom: '1px solid var(--color-divider)', fontSize: 14,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{s.label}</div>
                <div style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>
                  {s.due_date ? `Due ${dateLabel(s.due_date)}` : 'Due on event day'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="num" style={{ fontWeight: 700 }}>{money(s.due_amount)}</div>
                <span className={pillClass(scheduleState(s))}>{statusText(scheduleState(s))}</span>
              </div>
            </div>
          ))}
        </section>
      )}

      {open && (
        <RecordPaymentDialog
          event={event}
          outstanding={outstanding}
          onClose={() => setOpen(false)}
          onSaved={afterSave}
          addToast={addToast}
        />
      )}
    </>
  );
}

const methodLabel = (m) =>
  PAYMENT_METHODS.find(([v]) => v === String(m || '').toLowerCase())?.[1] || statusText(m);

/** The schedule row's own status column, mapped onto the payment pill vocabulary. */
function scheduleState(s) {
  const status = String(s.status || 'pending').toLowerCase();
  if (status === 'paid') return 'PAID';
  if (status === 'partial') return 'PARTIALLY_PAID';
  if (status === 'waived' || status === 'cancelled') return 'REFUNDED';
  return 'DEPOSIT_DUE';
}

/** Today in Nepal, as the plain YYYY-MM-DD the ledger stores. */
function todayNepal() {
  return new Date(Date.now() + 5.75 * 3600 * 1000).toISOString().slice(0, 10);
}

function RecordPaymentDialog({ event, outstanding, onClose, onSaved, addToast }) {
  const [form, setForm] = useState({
    amount: '', payment_method: 'cash', received_on: todayNepal(), reference_number: '', notes: '',
  });
  const [busy, setBusy] = useState(false);
  // Minted on the first submit and reused for the life of this dialog, so a
  // double-click or a retry after a timeout reaches the same key and the server
  // returns the original deposit instead of taking the money twice. Generated
  // in the handler rather than during render — Date.now/Math.random are impure
  // and a re-render would otherwise mint a fresh key mid-flight.
  const keyRef = useRef(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const amount = Number(form.amount || 0);
  const after = Math.max(0, outstanding - (Number.isFinite(amount) ? amount : 0));
  const overpaying = amount > outstanding + 0.005;

  const submit = async (e) => {
    e.preventDefault();
    if (!(amount > 0)) {
      addToast({ type: 'error', title: 'Enter an amount greater than zero.' });
      return;
    }
    setBusy(true);
    if (!keyRef.current) {
      keyRef.current = `evt-${event.id}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
    try {
      const res = await apiJson(`/api/admin/events/${event.id}/deposits`, {
        method: 'POST',
        body: JSON.stringify({
          amount,
          payment_method: form.payment_method,
          received_on: form.received_on,
          reference_number: form.reference_number.trim() || undefined,
          notes: form.notes.trim() || undefined,
          idempotency_key: keyRef.current,
        }),
      });
      addToast({ type: 'success', title: res.message || 'Payment recorded' });
      await onSaved();
    } catch (err) {
      addToast({ type: 'error', title: 'Could not record the payment', description: errText(err) });
      setBusy(false);
    }
  };

  return (
    <div className="evx-backdrop">
      <form className="evx-dialog" onSubmit={submit}>
        <div className="evx-dialog-head">
          <h2 style={{ margin: 0, fontSize: 18 }}>Record payment</h2>
          <button type="button" onClick={onClose} className="btn-square btn-square-lg" aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div
            style={{
              display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13,
              background: 'var(--color-surface)', padding: '10px 12px', border: '1px solid var(--color-divider)',
            }}
          >
            <span style={{ color: 'var(--color-neutral-700)' }}>Outstanding after this payment</span>
            <span className="num" style={{ fontWeight: 800 }}>{money(after)}</span>
          </div>

          <label style={{ display: 'block' }}>
            <span className="field-label">Amount (Rs) <span className="req">*</span></span>
            <input
              className="input" type="number" min="0" step="0.01" required autoFocus
              value={form.amount} onChange={(e) => set('amount', e.target.value)}
            />
          </label>

          {overpaying && (
            <div className="note">
              <span>
                That is more than the {money(outstanding)} still owed. The venue should not hold more
                than the event is worth — the server will refuse it.
              </span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ display: 'block' }}>
              <span className="field-label">Method</span>
              <select className="input" value={form.payment_method} onChange={(e) => set('payment_method', e.target.value)}>
                {PAYMENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label style={{ display: 'block' }}>
              <span className="field-label">Date</span>
              <input className="input" type="date" value={form.received_on} onChange={(e) => set('received_on', e.target.value)} />
            </label>
          </div>

          <label style={{ display: 'block' }}>
            <span className="field-label">Reference</span>
            <input
              className="input" placeholder="Cheque no., txn id, receipt no.…"
              value={form.reference_number} onChange={(e) => set('reference_number', e.target.value)}
            />
          </label>

          <label style={{ display: 'block' }}>
            <span className="field-label">Note</span>
            <input
              className="input" placeholder="Booking advance, second instalment…"
              value={form.notes} onChange={(e) => set('notes', e.target.value)}
            />
          </label>
        </div>

        <div className="evx-dialog-foot">
          <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button type="submit" disabled={busy} className="btn btn-primary">
            {busy ? 'Recording…' : 'Record payment'}
          </button>
        </div>
      </form>
    </div>
  );
}

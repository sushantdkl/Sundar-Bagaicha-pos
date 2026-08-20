'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import AdminLayout from '@/components/admin/admin-layout';
import { ArrowLeft, Ban, CheckCircle2, PlayCircle, Receipt, Pencil, RefreshCw, X } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { EVENT_STATUS_TRANSITIONS, canBill } from '@/lib/events/constants.js';
import {
  money, dateLabel, timeRange, guestLabel, errText, pillClass, statusText, LIFECYCLE, useEventsBasePath,
} from '../event-ui';
import Quotation from './quotation';
import Payments from './payments';
import SettlementDialog from './settlement';

export default function EventDetailPage() {
  const { id } = useParams();
  const eventsBase = useEventsBasePath();
  const { addToast } = useToast();
  const { confirm, prompt } = useConfirm();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null);
  const [settling, setSettling] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await apiJson(`/api/admin/events/${id}`));
    } catch (e) {
      addToast({ type: 'error', title: 'Could not load the event', description: errText(e) });
    } finally {
      setBusy(false);
    }
  }, [id, addToast]);

  useEffect(() => { load(); }, [load]);

  const event = data?.event;
  const lines = data?.lines || [];
  const nextStatuses = (EVENT_STATUS_TRANSITIONS[event?.status] || []).filter((s) => s !== 'CANCELLED');

  const patch = async (body, successTitle) => {
    setBusy(true);
    try {
      const res = await apiJson(`/api/admin/events/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      addToast({
        type: 'success',
        title: successTitle || res.message,
        description: res.warnings?.length ? res.warnings[0].message : undefined,
      });
      setEdit(null);
      await load();
    } catch (e) {
      addToast({ type: 'error', title: 'Action failed', description: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const cancelEvent = async () => {
    const reason = await prompt({
      title: 'Cancel this event?',
      message: 'The reason is recorded in the audit trail. Deposits already taken are left untouched — refunding them is a separate, audited decision.',
      label: 'Reason',
      required: true,
      tone: 'danger',
    });
    if (!reason || !reason.trim()) return;
    await patch({ action: 'cancel', reason: reason.trim() }, 'Event cancelled');
  };

  const moveStatus = async (status) => {
    const ok = await confirm({
      title: `Move to ${statusText(status)}?`,
      message: status === 'CONFIRMED'
        ? 'Confirming holds the space exclusively. Any other booking in the same slot will be blocked.'
        : 'This is recorded in the event audit trail.',
    });
    if (!ok) return;
    await patch({ action: 'status', status });
  };

  if (!event) {
    return (
      <AdminLayout>
        <div className="evx">
          <main className="pad" style={{ fontSize: 13, color: 'var(--color-neutral-600)' }}>
            {busy ? 'Loading event…' : 'Event not found.'}
          </main>
        </div>
      </AdminLayout>
    );
  }

  const closed = event.status === 'CANCELLED' || event.status === 'COMPLETED';
  const currentStep = LIFECYCLE.indexOf(event.status);
  // Which of the three headline actions this event is actually up for.
  const billable = canBill(event.status);
  const canConfirm = nextStatuses.includes('CONFIRMED');
  const canStart = nextStatuses.includes('IN_PROGRESS');

  return (
    <AdminLayout>
      <div className="evx">
        <header className="headpad" style={{ borderBottom: '1px solid var(--color-divider)', background: 'var(--color-bg)' }}>
          <Link
            href={eventsBase}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--color-neutral-600)', textDecoration: 'none' }}
          >
            <ArrowLeft size={15} />Events
          </Link>

          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
            <div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
                <h1 style={{ fontSize: 28, margin: 0 }}>{event.event_number}</h1>
                <span className={pillClass(event.status)}>{statusText(event.status)}</span>
                <span className={pillClass(event.payment_status)}>{statusText(event.payment_status)}</span>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--color-neutral-700)' }}>
                {event.title || event.event_type}
              </p>
            </div>

            {/* Actions are ordered by what this event actually needs next: the
                primary one first, the rest behind it. Staff should not have to
                understand the lifecycle to run a booking. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {billable && (
                <button type="button" onClick={() => setSettling(true)} disabled={busy} className="btn btn-primary">
                  <Receipt size={15} />Bill event
                </button>
              )}
              {canStart && (
                <button
                  type="button" onClick={() => moveStatus('IN_PROGRESS')} disabled={busy}
                  className="btn btn-secondary"
                >
                  <PlayCircle size={15} />Start event
                </button>
              )}
              {canConfirm && (
                <button
                  type="button" onClick={() => moveStatus('CONFIRMED')} disabled={busy}
                  className="btn btn-primary"
                >
                  <CheckCircle2 size={15} />Confirm event
                </button>
              )}
              <button type="button" onClick={load} disabled={busy} className="btn btn-secondary">
                <RefreshCw size={15} className={busy ? 'animate-spin' : undefined} />Refresh
              </button>
              {!closed && (
                <>
                  <button type="button" onClick={() => setEdit({ ...event })} className="btn btn-secondary">
                    <Pencil size={15} />Edit
                  </button>
                  <button type="button" onClick={cancelEvent} className="btn btn-outline-accent">
                    <Ban size={15} />Cancel event
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Lifecycle strip: the whole path, with the steps this event may move
              to next as the only clickable ones. */}
          <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>Lifecycle:</span>
            {event.status === 'CANCELLED' ? (
              <span className={pillClass('CANCELLED')}>{statusText('CANCELLED')}</span>
            ) : (
              LIFECYCLE.map((s, i) => {
                const can = nextStatuses.includes(s);
                const tone = i === currentStep ? 'step-current' : i < currentStep ? 'step-done' : 'step-ahead';
                return can ? (
                  <button
                    key={s} type="button" disabled={busy}
                    onClick={() => moveStatus(s)} className={`step ${tone}`}
                    title={`Move to ${statusText(s)}`}
                  >
                    {statusText(s)}
                  </button>
                ) : (
                  <span key={s} className={`step ${tone}`}>{statusText(s)}</span>
                );
              })
            )}
          </div>
        </header>

        <main className="pad detail-grid">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
            <Panel title="Booking">
              <Row label="Event type" value={event.event_type} />
              <Row label="Date" value={`${dateLabel(event.event_date)}${event.end_date ? ` → ${dateLabel(event.end_date)}` : ''}`} />
              <Row label="Time" value={timeRange(event) || 'Not set'} />
              <Row label="Space" value={event.space_name || 'Not assigned'} />
              <Row label="Guests" value={guestLabel(event)} />
              <Row
                label="Expected / guaranteed / actual"
                value={`${event.expected_guests ?? '—'} / ${event.guaranteed_guests ?? '—'} / ${event.actual_guests ?? '—'}`}
              />
            </Panel>

            <Quotation event={event} lines={lines} onChanged={load} addToast={addToast} />

            <Panel title="Client">
              <Row label="Name" value={event.customer_name || event.contact_name || '—'} />
              <Row label="Phone" value={event.contact_phone || event.customer_phone || '—'} />
              <Row label="Email" value={event.contact_email || '—'} />
              <Row label="Customer record" value={event.customer_id ? `#${event.customer_id}` : 'Not linked'} />
            </Panel>

            {(event.notes || event.internal_notes) && (
              <Panel title="Notes">
                <div style={{ padding: '14px 16px', fontSize: 14 }}>
                  {event.notes && (
                    <>
                      <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--color-neutral-600)' }}>Client notes</p>
                      <p style={{ margin: event.internal_notes ? '0 0 14px' : 0 }}>{event.notes}</p>
                    </>
                  )}
                  {event.internal_notes && (
                    <>
                      <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--color-neutral-600)' }}>Internal</p>
                      <p style={{ margin: 0 }}>{event.internal_notes}</p>
                    </>
                  )}
                </div>
              </Panel>
            )}

            {event.status === 'CANCELLED' && (
              <div className="note note-error">
                <p style={{ margin: 0 }}>
                  <b>Cancelled.</b> {event.cancel_reason}
                  <br />
                  Any deposits already taken are untouched — refunds are a separate, audited decision.
                </p>
              </div>
            )}

          </div>

          <div
            className="detail-rail"
            style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0, position: 'sticky', top: 20 }}
          >
            <Payments event={event} onChanged={load} addToast={addToast} />
          </div>
        </main>

        {edit && <EditDialog event={edit} busy={busy} onClose={() => setEdit(null)} onSave={(body) => patch(body)} />}

        {settling && (
          <SettlementDialog
            event={event}
            lines={lines}
            addToast={addToast}
            onClose={() => setSettling(false)}
            onSettled={async () => { setSettling(false); await load(); }}
          />
        )}
      </div>
    </AdminLayout>
  );
}

function EditDialog({ event, busy, onClose, onSave }) {
  const [form, setForm] = useState({
    title: event.title || '', event_type: event.event_type || '',
    event_date: (event.event_date || '').slice(0, 10), end_date: (event.end_date || '').slice(0, 10),
    start_time: event.start_time || '', end_time: event.end_time || '',
    expected_guests: event.expected_guests ?? '', guaranteed_guests: event.guaranteed_guests ?? '',
    actual_guests: event.actual_guests ?? '', notes: event.notes || '', internal_notes: event.internal_notes || '',
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = (e) => {
    e.preventDefault();
    const body = { ...form };
    for (const k of ['expected_guests', 'guaranteed_guests', 'actual_guests']) {
      body[k] = body[k] === '' ? null : Number(body[k]);
    }
    if (!body.end_date) body.end_date = null;
    onSave(body);
  };

  return (
    <div className="evx-backdrop">
      <form onSubmit={submit} className="evx-dialog evx-dialog-wide">
        <div className="evx-dialog-head">
          <h2 style={{ margin: 0, fontSize: 18 }}>Edit {event.event_number}</h2>
          <button type="button" onClick={onClose} className="btn-square btn-square-lg" aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <div className="form-grid" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          <F label="Event type"><input required value={form.event_type} onChange={(e) => set('event_type', e.target.value)} className="input" /></F>
          <F label="Title"><input value={form.title} onChange={(e) => set('title', e.target.value)} className="input" /></F>
          <F label="Event date"><input required type="date" value={form.event_date} onChange={(e) => set('event_date', e.target.value)} className="input" /></F>
          <F label="End date"><input type="date" min={form.event_date} value={form.end_date} onChange={(e) => set('end_date', e.target.value)} className="input" /></F>
          <F label="Start time"><input type="time" value={form.start_time} onChange={(e) => set('start_time', e.target.value)} className="input" /></F>
          <F label="End time"><input type="time" value={form.end_time} onChange={(e) => set('end_time', e.target.value)} className="input" /></F>
          <F label="Expected guests"><input type="number" min="0" step="1" value={form.expected_guests} onChange={(e) => set('expected_guests', e.target.value)} className="input" /></F>
          <F label="Guaranteed guests"><input type="number" min="0" step="1" value={form.guaranteed_guests} onChange={(e) => set('guaranteed_guests', e.target.value)} className="input" /></F>
          <F label="Actual guests"><input type="number" min="0" step="1" value={form.actual_guests} onChange={(e) => set('actual_guests', e.target.value)} className="input" /></F>
          <F label="Client notes" wide><textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} className="input" /></F>
          <F label="Internal notes" wide><textarea value={form.internal_notes} onChange={(e) => set('internal_notes', e.target.value)} className="input" /></F>
        </div>
        <div className="evx-dialog-foot">
          <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button type="submit" disabled={busy} className="btn btn-primary">{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <section className="panel">
      <h2 className="panel-title" style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-divider)' }}>{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }) {
  return (
    <div className="drow">
      <span className="drow-label">{label}</span>
      <span className="drow-value">{value}</span>
    </div>
  );
}

function F({ label, wide, children }) {
  return (
    <label style={{ display: 'block' }} className={wide ? 'wide' : undefined}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

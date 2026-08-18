'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import AdminLayout from '@/components/admin/admin-layout';
import { ArrowLeft, Ban, Check, History, Pencil, RefreshCw, X } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { EVENT_STATUS_TRANSITIONS } from '@/lib/events/constants.js';
import { STATUS_TONE, money, dateLabel, timeRange, guestLabel , errText} from '../event-ui';

export default function EventDetailPage() {
  const { id } = useParams();
  const { addToast } = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null);

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
  const audit = data?.audit || [];
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
    const reason = window.prompt('Why is this event being cancelled? (recorded in the audit trail)');
    if (!reason || !reason.trim()) return;
    await patch({ action: 'cancel', reason: reason.trim() }, 'Event cancelled');
  };

  const moveStatus = async (status) => {
    const ok = await confirm({
      title: `Move to ${status.replace('_', ' ')}?`,
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
        <main className="p-8 text-sm text-gray-500">{busy ? 'Loading event…' : 'Event not found.'}</main>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <Link href="/admin/events" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" />Events
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{event.event_number}</h1>
              <span className={`px-2 py-1 text-xs font-semibold ${STATUS_TONE[event.status]}`}>
                {event.status.replace('_', ' ')}
              </span>
              <span className="text-xs font-medium text-gray-500">{event.payment_status.replace('_', ' ')}</span>
            </div>
            <p className="mt-1 text-sm text-gray-600">{event.title || event.event_type}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={load} className={BTN}><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Refresh</button>
            {event.status !== 'CANCELLED' && event.status !== 'COMPLETED' && (
              <>
                <button onClick={() => setEdit({ ...event })} className={BTN}><Pencil className="h-4 w-4" />Edit</button>
                <button onClick={cancelEvent} className={DANGER}><Ban className="h-4 w-4" />Cancel event</button>
              </>
            )}
          </div>
        </div>
        {nextStatuses.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-500">Move to:</span>
            {nextStatuses.map((s) => (
              <button key={s} disabled={busy} onClick={() => moveStatus(s)} className={STEP}>
                <Check className="h-3.5 w-3.5" />{s.replace('_', ' ')}
              </button>
            ))}
          </div>
        )}
      </header>

      <main className="grid gap-5 bg-gray-50 p-4 sm:p-6 lg:grid-cols-3 lg:p-8">
        <div className="space-y-5 lg:col-span-2">
          <Panel title="Booking">
            <Row label="Event type" value={event.event_type} />
            <Row label="Date" value={`${dateLabel(event.event_date)}${event.end_date ? ` → ${dateLabel(event.end_date)}` : ''}`} />
            <Row label="Time" value={timeRange(event) || 'Not set'} />
            <Row label="Space" value={event.space_name || 'Not assigned'} />
            <Row label="Guests" value={guestLabel(event)} />
            <Row label="Expected / guaranteed / actual"
              value={`${event.expected_guests ?? '—'} / ${event.guaranteed_guests ?? '—'} / ${event.actual_guests ?? '—'}`} />
          </Panel>

          <Panel title="Client">
            <Row label="Name" value={event.customer_name || event.contact_name || '—'} />
            <Row label="Phone" value={event.contact_phone || event.customer_phone || '—'} />
            <Row label="Email" value={event.contact_email || '—'} />
            <Row label="Customer record" value={event.customer_id ? `#${event.customer_id}` : 'Not linked'} />
          </Panel>

          {(event.notes || event.internal_notes) && (
            <Panel title="Notes">
              {event.notes && <Row label="Client notes" value={event.notes} />}
              {event.internal_notes && <Row label="Internal" value={event.internal_notes} />}
            </Panel>
          )}

          {event.status === 'CANCELLED' && (
            <div className="border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <b>Cancelled.</b> {event.cancel_reason}
              <p className="mt-1 text-xs">Any deposits already taken are untouched — refunds are a separate, audited decision.</p>
            </div>
          )}
        </div>

        <div className="space-y-5">
          <Panel title="Money">
            <Row label="Subtotal" value={money(event.subtotal)} />
            <Row label="Discount" value={money(event.discount_amount)} />
            <Row label="Service charge" value={money(event.service_charge_amount)} />
            <Row label="Tax" value={money(event.tax_amount)} />
            <Row label="Total" value={money(event.total_amount)} strong />
            <Row label="Deposits received" value={money(event.deposit_total)} />
            <Row label="Outstanding" value={money(event.outstanding_amount)} strong />
            <p className="px-4 pb-4 text-xs text-gray-500">
              Totals are filled in by the quotation builder in a later phase. Deposits are held as a
              liability and are not sales revenue until the event is fulfilled.
            </p>
          </Panel>

          <Panel title={<span className="inline-flex items-center gap-2"><History className="h-4 w-4" />Audit trail</span>}>
            <ul className="divide-y divide-gray-100">
              {audit.map((a) => (
                <li key={a.id} className="px-4 py-3 text-sm">
                  <p className="font-medium text-gray-900">{a.action.replace(/^event_/, '').replace(/_/g, ' ')}</p>
                  <p className="text-xs text-gray-500">
                    {a.actor_name || 'system'} · {new Date(a.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Kathmandu' })}
                  </p>
                  {a.reason && <p className="mt-1 text-xs text-gray-600">“{a.reason}”</p>}
                  {(a.previous_value || a.new_value) && (
                    <p className="mt-1 break-words text-xs text-gray-500">
                      {a.previous_value || '—'} → {a.new_value || '—'}
                    </p>
                  )}
                </li>
              ))}
              {!audit.length && <li className="px-4 py-6 text-center text-sm text-gray-500">No audit entries yet.</li>}
            </ul>
          </Panel>
        </div>
      </main>

      {edit && <EditDialog event={edit} busy={busy} onClose={() => setEdit(null)} onSave={(body) => patch(body)} />}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4">
      <form onSubmit={submit} className="w-full max-w-2xl border border-gray-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="font-bold text-gray-900">Edit {event.event_number}</h2>
          <button type="button" onClick={onClose} className={ICON}><X className="h-4 w-4" /></button>
        </div>
        <div className="grid max-h-[70vh] gap-4 overflow-y-auto p-5 sm:grid-cols-2">
          <L label="Event type"><input required value={form.event_type} onChange={(e) => set('event_type', e.target.value)} className={INPUT} /></L>
          <L label="Title"><input value={form.title} onChange={(e) => set('title', e.target.value)} className={INPUT} /></L>
          <L label="Event date"><input required type="date" value={form.event_date} onChange={(e) => set('event_date', e.target.value)} className={INPUT} /></L>
          <L label="End date"><input type="date" min={form.event_date} value={form.end_date} onChange={(e) => set('end_date', e.target.value)} className={INPUT} /></L>
          <L label="Start time"><input type="time" value={form.start_time} onChange={(e) => set('start_time', e.target.value)} className={INPUT} /></L>
          <L label="End time"><input type="time" value={form.end_time} onChange={(e) => set('end_time', e.target.value)} className={INPUT} /></L>
          <L label="Expected guests"><input type="number" min="0" step="1" value={form.expected_guests} onChange={(e) => set('expected_guests', e.target.value)} className={INPUT} /></L>
          <L label="Guaranteed guests"><input type="number" min="0" step="1" value={form.guaranteed_guests} onChange={(e) => set('guaranteed_guests', e.target.value)} className={INPUT} /></L>
          <L label="Actual guests"><input type="number" min="0" step="1" value={form.actual_guests} onChange={(e) => set('actual_guests', e.target.value)} className={INPUT} /></L>
          <L label="Client notes" wide><textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} className="min-h-16 w-full border border-gray-300 p-3 text-sm" /></L>
          <L label="Internal notes" wide><textarea value={form.internal_notes} onChange={(e) => set('internal_notes', e.target.value)} className="min-h-16 w-full border border-gray-300 p-3 text-sm" /></L>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
          <button type="button" onClick={onClose} className={BTN}>Cancel</button>
          <button disabled={busy} className={PRIMARY}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <section className="border border-gray-200 bg-white">
      <h2 className="border-b border-gray-200 px-4 py-3 text-sm font-bold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value, strong }) {
  return (
    <div className="flex justify-between gap-4 border-b border-gray-50 px-4 py-2.5 text-sm last:border-0">
      <span className="text-gray-500">{label}</span>
      <span className={`text-right ${strong ? 'font-bold text-gray-900' : 'text-gray-800'}`}>{value}</span>
    </div>
  );
}

function L({ label, wide, children }) {
  return (
    <label className={`text-sm font-medium text-gray-700 ${wide ? 'sm:col-span-2' : ''}`}>
      {label}<div className="mt-1">{children}</div>
    </label>
  );
}

const BTN = 'inline-flex h-10 items-center justify-center gap-2 border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50';
const PRIMARY = 'inline-flex h-10 items-center justify-center gap-2 border border-gray-950 bg-gray-950 px-4 text-sm font-semibold text-white hover:bg-black disabled:opacity-50 [color:#fff!important]';
const DANGER = 'inline-flex h-10 items-center justify-center gap-2 border border-red-300 bg-white px-4 text-sm font-medium text-red-700 hover:bg-red-50';
const STEP = 'inline-flex h-8 items-center gap-1 border border-gray-300 bg-white px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50';
const ICON = 'inline-flex h-9 w-9 items-center justify-center border border-gray-300 text-gray-600 hover:bg-gray-50';
const INPUT = 'h-10 w-full border border-gray-300 bg-white px-3 text-sm text-gray-900';

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AdminLayout from '@/components/admin/admin-layout';
import { ArrowLeft, CalendarClock, Pencil, Plus, RefreshCw, X } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { STATUS_TONE, money, dateLabel, timeRange , errText} from '../event-ui';

const EMPTY = {
  name: '', description: '', min_capacity: '', max_capacity: '',
  standard_charge: '', setup_buffer_minutes: '0', cleanup_buffer_minutes: '0',
  display_order: '0', is_active: true,
};

export default function EventSpacesPage() {
  const { addToast } = useToast();
  const confirm = useConfirm();
  const [spaces, setSpaces] = useState([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);
  const [viewing, setViewing] = useState(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const d = await apiJson('/api/admin/events/spaces?usage=1');
      setSpaces(d.spaces || []);
    } catch (e) {
      addToast({ type: 'error', title: 'Could not load spaces', description: errText(e) });
    } finally {
      setBusy(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...form };
      for (const k of ['min_capacity', 'max_capacity', 'setup_buffer_minutes', 'cleanup_buffer_minutes', 'display_order']) {
        body[k] = body[k] === '' ? null : Number(body[k]);
      }
      body.standard_charge = body.standard_charge === '' ? 0 : Number(body.standard_charge);
      const res = form.id
        ? await apiJson(`/api/admin/events/spaces/${form.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : await apiJson('/api/admin/events/spaces', { method: 'POST', body: JSON.stringify(body) });
      addToast({ type: 'success', title: res.message });
      setForm(null);
      await load();
    } catch (err) {
      addToast({ type: 'error', title: 'Could not save the space', description: errText(err) });
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (space) => {
    if (space.is_active) {
      const ok = await confirm({
        title: `Deactivate ${space.name}?`,
        message: 'It stays on existing bookings and reports, but cannot be chosen for new ones.',
      });
      if (!ok) return;
    }
    try {
      const res = space.is_active
        ? await apiJson(`/api/admin/events/spaces/${space.id}`, { method: 'DELETE' })
        : await apiJson(`/api/admin/events/spaces/${space.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: true }) });
      addToast({ type: 'success', title: res.message });
      await load();
    } catch (e) {
      addToast({ type: 'error', title: 'Could not change the space', description: errText(e) });
    }
  };

  const openBookings = async (space) => {
    try {
      const d = await apiJson(`/api/admin/events/spaces/${space.id}`);
      setViewing({ space: d.space, bookings: d.bookings || [] });
    } catch (e) {
      addToast({ type: 'error', title: 'Could not load bookings', description: errText(e) });
    }
  };

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <Link href="/admin/events" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" />Events
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Event Spaces</h1>
            <p className="mt-1 max-w-3xl text-sm text-gray-500">
              Bookable venues and their rules. Capacity is enforced when a booking is saved; a manager
              can exceed it only with a recorded reason. Setup and cleanup buffers extend how long a
              space counts as occupied, so a teardown never collides with the next event.
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={load} className={BTN}><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Refresh</button>
            <button onClick={() => setForm({ ...EMPTY })} className={PRIMARY}><Plus className="h-4 w-4" />New Space</button>
          </div>
        </div>
      </header>

      <main className="bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {spaces.map((s) => (
            <article key={s.id} className={`border bg-white ${s.is_active ? 'border-gray-200' : 'border-dashed border-gray-300 opacity-70'}`}>
              <div className="flex items-start justify-between gap-2 border-b border-gray-100 p-4">
                <div>
                  <h2 className="font-bold text-gray-900">{s.name}</h2>
                  {s.description && <p className="mt-0.5 text-xs text-gray-500">{s.description}</p>}
                </div>
                <span className={`shrink-0 px-2 py-1 text-xs font-semibold ${s.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                  {s.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <dl className="divide-y divide-gray-50 text-sm">
                <Row label="Capacity" value={s.max_capacity ? `${s.min_capacity ? `${s.min_capacity}–` : 'up to '}${s.max_capacity} guests` : 'Not set'} />
                <Row label="Venue charge" value={money(s.standard_charge)} />
                <Row label="Setup / cleanup" value={`${s.setup_buffer_minutes || 0} / ${s.cleanup_buffer_minutes || 0} min`} />
                <Row label="Committed bookings" value={s.committed_events ?? 0} />
              </dl>
              <div className="flex flex-wrap gap-2 border-t border-gray-100 p-3">
                <button onClick={() => openBookings(s)} className={SMALL}><CalendarClock className="h-3.5 w-3.5" />Bookings</button>
                <button onClick={() => setForm({ ...s, is_active: !!s.is_active })} className={SMALL}><Pencil className="h-3.5 w-3.5" />Edit</button>
                <button onClick={() => toggleActive(s)} className={SMALL}>{s.is_active ? 'Deactivate' : 'Reactivate'}</button>
              </div>
            </article>
          ))}
        </div>

        {!busy && !spaces.length && (
          <div className="border border-dashed border-gray-300 bg-white py-16 text-center">
            <p className="text-sm text-gray-500">No event spaces yet.</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-gray-400">
              Add the venues you actually book — a garden, a hall, a private dining room. Bookings can
              be taken without a space, but capacity and clash checks only work once one is set.
            </p>
            <button onClick={() => setForm({ ...EMPTY })} className={`${PRIMARY} mt-4`}><Plus className="h-4 w-4" />Add the first space</button>
          </div>
        )}
      </main>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4">
          <form onSubmit={save} className="w-full max-w-2xl border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h2 className="font-bold text-gray-900">{form.id ? `Edit ${form.name}` : 'New Event Space'}</h2>
              <button type="button" onClick={() => setForm(null)} className={ICON}><X className="h-4 w-4" /></button>
            </div>
            <div className="grid max-h-[70vh] gap-4 overflow-y-auto p-5 sm:grid-cols-2">
              <F label="Name" required wide>
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Main Garden" className={INPUT} />
              </F>
              <F label="Description" wide>
                <textarea value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="min-h-16 w-full border border-gray-300 p-3 text-sm" />
              </F>
              <F label="Minimum capacity" hint="Below this only warns">
                <input type="number" min="0" step="1" value={form.min_capacity ?? ''}
                  onChange={(e) => setForm({ ...form, min_capacity: e.target.value })} className={INPUT} />
              </F>
              <F label="Maximum capacity" hint="Exceeding this blocks unless overridden">
                <input type="number" min="1" step="1" value={form.max_capacity ?? ''}
                  onChange={(e) => setForm({ ...form, max_capacity: e.target.value })} className={INPUT} />
              </F>
              <F label="Standard venue charge">
                <input type="number" min="0" step="0.01" value={form.standard_charge ?? ''}
                  onChange={(e) => setForm({ ...form, standard_charge: e.target.value })} className={INPUT} />
              </F>
              <F label="Display order">
                <input type="number" step="1" value={form.display_order ?? 0}
                  onChange={(e) => setForm({ ...form, display_order: e.target.value })} className={INPUT} />
              </F>
              <F label="Setup buffer (minutes)" hint="Blocked before the event starts">
                <input type="number" min="0" step="5" value={form.setup_buffer_minutes ?? 0}
                  onChange={(e) => setForm({ ...form, setup_buffer_minutes: e.target.value })} className={INPUT} />
              </F>
              <F label="Cleanup buffer (minutes)" hint="Blocked after the event ends">
                <input type="number" min="0" step="5" value={form.cleanup_buffer_minutes ?? 0}
                  onChange={(e) => setForm({ ...form, cleanup_buffer_minutes: e.target.value })} className={INPUT} />
              </F>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 sm:col-span-2">
                <input type="checkbox" checked={!!form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="h-4 w-4" />
                Active — available for new bookings
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
              <button type="button" onClick={() => setForm(null)} className={BTN}>Cancel</button>
              <button disabled={busy} className={PRIMARY}>{busy ? 'Saving…' : 'Save space'}</button>
            </div>
          </form>
        </div>
      )}

      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4" onClick={() => setViewing(null)}>
          <div className="w-full max-w-2xl border border-gray-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <h2 className="font-bold text-gray-900">{viewing.space.name} — bookings</h2>
                <p className="text-xs text-gray-500">
                  Occupied windows include the {viewing.space.setup_buffer_minutes || 0} min setup and
                  {' '}{viewing.space.cleanup_buffer_minutes || 0} min cleanup buffers.
                </p>
              </div>
              <button onClick={() => setViewing(null)} className={ICON}><X className="h-4 w-4" /></button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>{['Event', 'Date', 'Time', 'Status'].map((h) => <th key={h} className="px-4 py-2 font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {viewing.bookings.map((b) => (
                    <tr key={b.id}>
                      <td className="px-4 py-2">
                        <Link href={`/admin/events/${b.id}`} className="font-medium text-gray-900 hover:underline">{b.event_number}</Link>
                        <p className="text-xs text-gray-500">{b.title || b.event_type}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2">{dateLabel(b.event_date)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-gray-600">{timeRange(b) || '—'}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[b.status]}`}>{b.status.replace('_', ' ')}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!viewing.bookings.length && <p className="py-12 text-center text-sm text-gray-500">No bookings hold this space.</p>}
            </div>
            <div className="flex justify-end border-t border-gray-200 px-5 py-4">
              <button onClick={() => setViewing(null)} className={BTN}>Close</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-3 px-4 py-2">
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-medium text-gray-900">{value}</dd>
    </div>
  );
}

function F({ label, hint, required, wide, children }) {
  return (
    <label className={`text-sm font-medium text-gray-700 ${wide ? 'sm:col-span-2' : ''}`}>
      {label}{required && <span className="text-red-600"> *</span>}
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-xs font-normal text-gray-500">{hint}</p>}
    </label>
  );
}

const BTN = 'inline-flex h-10 items-center justify-center gap-2 border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50';
const PRIMARY = 'inline-flex h-10 items-center justify-center gap-2 border border-gray-950 bg-gray-950 px-4 text-sm font-semibold text-white hover:bg-black disabled:opacity-50 [color:#fff!important]';
const SMALL = 'inline-flex h-8 items-center gap-1 border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 hover:bg-gray-50';
const ICON = 'inline-flex h-9 w-9 items-center justify-center border border-gray-300 text-gray-600 hover:bg-gray-50';
const INPUT = 'h-10 w-full border border-gray-300 bg-white px-3 text-sm text-gray-900';

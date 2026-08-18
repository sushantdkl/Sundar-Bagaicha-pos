'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AdminLayout from '@/components/admin/admin-layout';
import { AlertTriangle, ArrowLeft, Info } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';
import { nepalDateString } from '@/lib/report-dates';
import { useToast } from '@/components/ui/toast';
import { errText } from '../event-ui';

/**
 * Event types are venue vocabulary, not code. These are starting suggestions
 * only — the field accepts anything, and Phase 3+ can move the list into
 * settings without touching this form.
 */
const TYPE_SUGGESTIONS = [
  'Wedding', 'Reception', 'Engagement', 'Birthday Party', 'Anniversary',
  'Conference', 'Corporate Event', 'Seminar', 'DJ Night', 'Bratabandha',
  'Mehendi', 'Get-together', 'Other',
];

export default function NewEventPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const [spaces, setSpaces] = useState([]);
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState(null);
  const [blocked, setBlocked] = useState(null);
  const [form, setForm] = useState({
    event_type: '', title: '', event_date: nepalDateString(), end_date: '',
    start_time: '', end_time: '', space_id: '', expected_guests: '',
    guaranteed_guests: '', contact_name: '', contact_phone: '', contact_email: '',
    notes: '', internal_notes: '', status: 'INQUIRY',
  });

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    apiJson('/api/admin/events/spaces?active=1')
      .then((d) => setSpaces(d.spaces || []))
      .catch((e) => addToast({ type: 'error', title: 'Could not load spaces', description: errText(e) }));
  }, [addToast]);

  /** Live availability probe — the same check the server re-runs on save. */
  const probe = useCallback(async () => {
    if (!form.space_id || !form.event_date) { setCheck(null); return; }
    try {
      const p = new URLSearchParams({
        check: '1', space_id: form.space_id, event_date: form.event_date,
        end_date: form.end_date || '', start_time: form.start_time || '',
        end_time: form.end_time || '', guests: form.expected_guests || '',
      });
      setCheck(await apiJson(`/api/admin/events/spaces?${p}`));
    } catch {
      setCheck(null); // availability is advisory here; save still validates
    }
  }, [form.space_id, form.event_date, form.end_date, form.start_time, form.end_time, form.expected_guests]);

  useEffect(() => {
    const t = setTimeout(probe, 350);
    return () => clearTimeout(t);
  }, [probe]);

  const submit = async (e, override = null) => {
    e?.preventDefault?.();
    setBusy(true);
    try {
      const payload = { ...form, ...(override || {}) };
      for (const k of ['expected_guests', 'guaranteed_guests']) {
        payload[k] = payload[k] === '' ? null : Number(payload[k]);
      }
      const res = await apiJson('/api/admin/events', { method: 'POST', body: JSON.stringify(payload) });
      addToast({
        type: 'success',
        title: `Event ${res.event.event_number} created`,
        description: res.warnings?.length ? res.warnings[0].message : 'No stock was reserved or deducted.',
      });
      router.push(`/admin/events/${res.event.id}`);
    } catch (err) {
      // A blocked save is offered as an explicit, reasoned override rather than
      // a dead end — the server still refuses without a reason.
      if (err.code === 'capacity_exceeded' || err.code === 'space_conflict') {
        setBlocked({ code: err.code, message: err.message });
      } else {
        addToast({ type: 'error', title: 'Could not create the event', description: errText(err) });
      }
      setBusy(false);
    }
  };

  const confirmOverride = async (reason) => {
    const key = blocked.code === 'capacity_exceeded' ? 'capacity_override' : 'conflict_override';
    setBlocked(null);
    await submit(null, { [key]: true, override_reason: reason });
  };

  const blocking = [...(check?.blocking || []), ...(check?.breaches || [])];
  const warnings = check?.warnings || [];

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <Link href="/admin/events" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" />Events
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">New Event</h1>
        <p className="mt-1 text-sm text-gray-500">
          Creating a booking records an enquiry only. It does not reserve or deduct any inventory.
        </p>
      </header>

      <main className="bg-gray-50 p-4 sm:p-6 lg:p-8">
        <form onSubmit={submit} className="mx-auto max-w-4xl space-y-5">
          <Section title="Event">
            <Field label="Event type" required>
              <input
                required list="event-types" value={form.event_type}
                onChange={(e) => set('event_type', e.target.value)}
                placeholder="Wedding, Conference, Birthday…" className={INPUT}
              />
              <datalist id="event-types">
                {TYPE_SUGGESTIONS.map((t) => <option key={t} value={t} />)}
              </datalist>
            </Field>
            <Field label="Title / reference">
              <input value={form.title} onChange={(e) => set('title', e.target.value)}
                placeholder="e.g. Sharma – Thapa Wedding" className={INPUT} />
            </Field>
            <Field label="Starting status">
              <select value={form.status} onChange={(e) => set('status', e.target.value)} className={INPUT}>
                <option value="INQUIRY">Inquiry</option>
                <option value="DRAFT">Draft</option>
              </select>
            </Field>
          </Section>

          <Section title="Schedule">
            <Field label="Event date" required>
              <input required type="date" value={form.event_date}
                onChange={(e) => set('event_date', e.target.value)} className={INPUT} />
            </Field>
            <Field label="End date" hint="Only for events running past midnight">
              <input type="date" value={form.end_date} min={form.event_date}
                onChange={(e) => set('end_date', e.target.value)} className={INPUT} />
            </Field>
            <Field label="Start time">
              <input type="time" value={form.start_time} onChange={(e) => set('start_time', e.target.value)} className={INPUT} />
            </Field>
            <Field label="End time">
              <input type="time" value={form.end_time} onChange={(e) => set('end_time', e.target.value)} className={INPUT} />
            </Field>
          </Section>

          <Section title="Space & guests">
            <Field label="Event space" hint={spaces.length ? undefined : 'No spaces configured yet'}>
              <select value={form.space_id} onChange={(e) => set('space_id', e.target.value)} className={INPUT}>
                <option value="">Not assigned</option>
                {spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.max_capacity ? ` (up to ${s.max_capacity})` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Expected guests">
              <input type="number" min="0" step="1" value={form.expected_guests}
                onChange={(e) => set('expected_guests', e.target.value)} className={INPUT} />
            </Field>
            <Field label="Guaranteed guests" hint="The minimum the client commits to pay for">
              <input type="number" min="0" step="1" value={form.guaranteed_guests}
                onChange={(e) => set('guaranteed_guests', e.target.value)} className={INPUT} />
            </Field>
          </Section>

          {(blocking.length > 0 || warnings.length > 0) && (
            <div className="space-y-2">
              {blocking.map((b) => (
                <Banner key={`b-${b.id}`} tone="error" icon={AlertTriangle}>
                  {b.message} A confirmed booking already holds this space — you can save as an
                  enquiry, but it cannot be confirmed for this slot.
                </Banner>
              ))}
              {warnings.map((w, i) => (
                <Banner key={`w-${i}`} tone="warn" icon={Info}>{w.message}</Banner>
              ))}
            </div>
          )}

          <Section title="Client">
            <Field label="Contact name">
              <input value={form.contact_name} onChange={(e) => set('contact_name', e.target.value)} className={INPUT} />
            </Field>
            <Field label="Phone" hint="Links to an existing customer when it matches">
              <input value={form.contact_phone} onChange={(e) => set('contact_phone', e.target.value)}
                placeholder="98XXXXXXXX" className={INPUT} />
            </Field>
            <Field label="Email">
              <input type="email" value={form.contact_email} onChange={(e) => set('contact_email', e.target.value)} className={INPUT} />
            </Field>
          </Section>

          <Section title="Notes">
            <Field label="Client notes" wide>
              <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)}
                className="min-h-20 w-full border border-gray-300 p-3 text-sm" />
            </Field>
            <Field label="Internal notes" wide hint="Not shown on customer documents">
              <textarea value={form.internal_notes} onChange={(e) => set('internal_notes', e.target.value)}
                className="min-h-20 w-full border border-gray-300 p-3 text-sm" />
            </Field>
          </Section>

          <div className="flex justify-end gap-2">
            <Link href="/admin/events" className={BTN}>Cancel</Link>
            <button disabled={busy} className={PRIMARY}>{busy ? 'Creating…' : 'Create Event'}</button>
          </div>
        </form>
      </main>

      {blocked && <OverrideDialog blocked={blocked} onCancel={() => setBlocked(null)} onConfirm={confirmOverride} />}
    </AdminLayout>
  );
}

/**
 * Manager override. The reason is mandatory here and re-checked on the server,
 * and the resulting booking carries an audit row naming who overrode what.
 */
function OverrideDialog({ blocked, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  const isCapacity = blocked.code === 'capacity_exceeded';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg border border-gray-200 bg-white shadow-xl">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="font-bold text-gray-900">
            {isCapacity ? 'Over capacity' : 'Space already booked'}
          </h2>
          <p className="mt-1 text-sm text-gray-600">{blocked.message}</p>
        </div>
        <div className="space-y-3 p-5">
          <p className="text-sm text-gray-600">
            {isCapacity
              ? 'Only override this if the room genuinely holds the extra guests. The override is recorded against your name.'
              : 'Double-booking a space means two events share it. The override is recorded against your name.'}
          </p>
          <label className="block text-sm font-medium text-gray-700">
            Reason (required)
            <textarea
              value={reason} onChange={(e) => setReason(e.target.value)} autoFocus
              placeholder="e.g. Client accepts standing capacity; extra seating hired"
              className="mt-1 min-h-20 w-full border border-gray-300 p-3 text-sm"
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
          <button type="button" onClick={onCancel} className={BTN}>Go back</button>
          <button
            type="button" disabled={!reason.trim()}
            onClick={() => onConfirm(reason.trim())}
            className="inline-flex h-10 items-center justify-center gap-2 border border-amber-600 bg-amber-600 px-4 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50 [color:#fff!important]"
          >Override and save</button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="border border-gray-200 bg-white">
      <h2 className="border-b border-gray-200 px-5 py-3 text-sm font-bold text-gray-900">{title}</h2>
      <div className="grid gap-4 p-5 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({ label, hint, required, wide, children }) {
  return (
    <label className={`text-sm font-medium text-gray-700 ${wide ? 'sm:col-span-2' : ''}`}>
      {label}{required && <span className="text-red-600"> *</span>}
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-xs font-normal text-gray-500">{hint}</p>}
    </label>
  );
}

function Banner({ tone, icon: Icon, children }) {
  const tones = {
    error: 'border-red-200 bg-red-50 text-red-800',
    warn: 'border-amber-200 bg-amber-50 text-amber-800',
  };
  return (
    <div className={`flex items-start gap-2 border p-3 text-sm ${tones[tone]}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{children}</p>
    </div>
  );
}

const BTN = 'inline-flex h-10 items-center justify-center gap-2 border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50';
const PRIMARY = 'inline-flex h-10 items-center justify-center gap-2 border border-gray-950 bg-gray-950 px-4 text-sm font-semibold text-white hover:bg-black disabled:opacity-50 [color:#fff!important]';
const INPUT = 'h-10 w-full border border-gray-300 bg-white px-3 text-sm text-gray-900';

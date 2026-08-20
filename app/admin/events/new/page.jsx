'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AdminLayout from '@/components/admin/admin-layout';
import { AlertTriangle, ArrowLeft, CheckCircle2, Info } from 'lucide-react';
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
  // Only claim the slot is clear once the probe has actually answered for a
  // chosen space — silence before the first response is not an all-clear.
  const spaceIsFree = Boolean(check) && !blocking.length && !warnings.length;

  return (
    <AdminLayout>
      <div className="evx">
        <header className="headpad" style={{ borderBottom: '1px solid var(--color-divider)', background: 'var(--color-bg)' }}>
          <Link
            href="/admin/events"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--color-neutral-600)', textDecoration: 'none' }}
          >
            <ArrowLeft size={15} />Events
          </Link>
          <h1 style={{ fontSize: 28, margin: '10px 0 6px' }}>New Event</h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-neutral-700)' }}>
            Creating a booking records an enquiry only. It does not reserve or deduct any inventory.
          </p>
        </header>

        <main className="pad">
          <form onSubmit={submit} style={{ maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
            <Section title="Event">
              <Field label="Event type" required>
                <input
                  required list="event-types" value={form.event_type}
                  onChange={(e) => set('event_type', e.target.value)}
                  placeholder="Wedding, Conference, Birthday…" className="input"
                />
                <datalist id="event-types">
                  {TYPE_SUGGESTIONS.map((t) => <option key={t} value={t} />)}
                </datalist>
              </Field>
              <Field label="Title / reference">
                <input value={form.title} onChange={(e) => set('title', e.target.value)}
                  placeholder="e.g. Sharma – Thapa Wedding" className="input" />
              </Field>
              <Field label="Starting status">
                <select value={form.status} onChange={(e) => set('status', e.target.value)} className="input">
                  <option value="INQUIRY">Inquiry</option>
                  <option value="DRAFT">Draft</option>
                </select>
              </Field>
            </Section>

            <Section title="Schedule">
              <Field label="Event date" required>
                <input required type="date" value={form.event_date}
                  onChange={(e) => set('event_date', e.target.value)} className="input" />
              </Field>
              <Field label="End date" hint="Only for events running past midnight">
                <input type="date" value={form.end_date} min={form.event_date}
                  onChange={(e) => set('end_date', e.target.value)} className="input" />
              </Field>
              <Field label="Start time">
                <input type="time" value={form.start_time} onChange={(e) => set('start_time', e.target.value)} className="input" />
              </Field>
              <Field label="End time">
                <input type="time" value={form.end_time} onChange={(e) => set('end_time', e.target.value)} className="input" />
              </Field>
            </Section>

            <Section
              title="Space & guests"
              /* The availability probe reads beside the fields that trigger it,
                 rather than in a banner stack further down the form. */
              footer={(blocking.length > 0 || warnings.length > 0 || spaceIsFree) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {blocking.map((b) => (
                    <Note key={`b-${b.id}`} icon={AlertTriangle} tone="error">
                      {b.message} A confirmed booking already holds this space — you can save as an
                      enquiry, but it cannot be confirmed for this slot.
                    </Note>
                  ))}
                  {warnings.map((w, i) => (
                    <Note key={`w-${i}`} icon={Info}>{w.message}</Note>
                  ))}
                  {spaceIsFree && (
                    <Note icon={CheckCircle2} tone="ok">
                      This space is free for the slot. Setup and cleanup buffers do not clash with
                      any confirmed booking.
                    </Note>
                  )}
                </div>
              )}
            >
              <Field label="Event space" hint={spaces.length ? undefined : 'No spaces configured yet'}>
                <select value={form.space_id} onChange={(e) => set('space_id', e.target.value)} className="input">
                  <option value="">Not assigned</option>
                  {spaces.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name}{sp.max_capacity ? ` (up to ${sp.max_capacity})` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <div />
              <Field label="Expected guests">
                <input type="number" min="0" step="1" value={form.expected_guests}
                  onChange={(e) => set('expected_guests', e.target.value)} className="input" />
              </Field>
              <Field label="Guaranteed guests" hint="The minimum the client commits to pay for">
                <input type="number" min="0" step="1" value={form.guaranteed_guests}
                  onChange={(e) => set('guaranteed_guests', e.target.value)} className="input" />
              </Field>
            </Section>

            <Section title="Client">
              <Field label="Contact name">
                <input value={form.contact_name} onChange={(e) => set('contact_name', e.target.value)} className="input" />
              </Field>
              <Field label="Phone" hint="Links to an existing customer when it matches">
                <input value={form.contact_phone} onChange={(e) => set('contact_phone', e.target.value)}
                  placeholder="98XXXXXXXX" className="input" />
              </Field>
              <Field label="Email">
                <input type="email" value={form.contact_email} onChange={(e) => set('contact_email', e.target.value)} className="input" />
              </Field>
            </Section>

            <Section title="Notes">
              <Field label="Client notes" wide>
                <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} className="input" />
              </Field>
              <Field label="Internal notes" wide hint="Not shown on customer documents">
                <textarea value={form.internal_notes} onChange={(e) => set('internal_notes', e.target.value)} className="input" />
              </Field>
            </Section>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingBottom: 8 }}>
              <Link href="/admin/events" className="btn btn-secondary">Cancel</Link>
              <button type="submit" disabled={busy} className="btn btn-primary">
                {busy ? 'Creating…' : 'Create Event'}
              </button>
            </div>
          </form>
        </main>

        {blocked && <OverrideDialog blocked={blocked} onCancel={() => setBlocked(null)} onConfirm={confirmOverride} />}
      </div>
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
    <div className="evx-backdrop">
      <div className="evx-dialog" style={{ width: 'min(520px, 100%)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-divider)' }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{isCapacity ? 'Over capacity' : 'Space already booked'}</h2>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--color-neutral-700)' }}>{blocked.message}</p>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-neutral-700)' }}>
            {isCapacity
              ? 'Only override this if the room genuinely holds the extra guests. The override is recorded against your name.'
              : 'Double-booking a space means two events share it. The override is recorded against your name.'}
          </p>
          <label style={{ display: 'block' }}>
            <span className="field-label">Reason <span className="req">*</span></span>
            <textarea
              value={reason} onChange={(e) => setReason(e.target.value)} autoFocus
              placeholder="e.g. Client accepts standing capacity; extra seating hired"
              className="input"
            />
          </label>
        </div>
        <div className="evx-dialog-foot">
          <button type="button" onClick={onCancel} className="btn btn-secondary">Go back</button>
          <button
            type="button" disabled={!reason.trim()}
            onClick={() => onConfirm(reason.trim())}
            className="btn btn-primary"
          >
            Override and save
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, footer, children }) {
  return (
    <section className="panel">
      <h2 className="panel-title" style={{ padding: '13px 20px', borderBottom: '1px solid var(--color-divider)' }}>{title}</h2>
      <div className="form-grid">{children}</div>
      {footer && <div style={{ margin: '0 20px 20px' }}>{footer}</div>}
    </section>
  );
}

function Field({ label, hint, required, wide, children }) {
  return (
    <label style={{ display: 'block' }} className={wide ? 'wide' : undefined}>
      <span className="field-label">{label}{required && <span className="req"> *</span>}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** tone: warning (default) | error | ok — the app's existing banner colours. */
function Note({ icon: Icon, tone, children }) {
  return (
    <div className={`note${tone ? ` note-${tone}` : ''}`}>
      <Icon size={16} />
      <p style={{ margin: 0 }}>{children}</p>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AdminLayout from '@/components/admin/admin-layout';
import { AlertTriangle, ArrowLeft, Calculator, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { money, errText } from '../event-ui';

const POLICY_LABEL = {
  whole_party: 'Whole-party tier',
  progressive: 'Progressive (slab)',
  manual: 'Manually negotiated',
};
const POLICY_HELP = {
  whole_party: 'Every guest pays the rate of the tier the total falls into. Simple to explain, but it can make a bigger party cheaper than a smaller one.',
  progressive: 'Guests are charged per band they fall into, like tax slabs. The total always rises with the head count.',
  manual: 'Tiers are advisory only; a negotiated per-guest rate is entered on each event.',
};

const EMPTY = {
  name: '', code: '', description: '', pricing_policy: 'whole_party',
  base_price_per_guest: '', min_guests: '', display_order: '0', is_active: true,
  tiers: [{ min_guests: 1, max_guests: 50, price_per_guest: '' }],
};

export default function EventPackagesPage() {
  const { addToast } = useToast();
  const confirm = useConfirm();
  const [packages, setPackages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);
  const [calc, setCalc] = useState(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const d = await apiJson('/api/admin/events/packages');
      setPackages(d.packages || []);
    } catch (e) {
      addToast({ type: 'error', title: 'Could not load packages', description: errText(e) });
    } finally {
      setBusy(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        ...form,
        base_price_per_guest: form.base_price_per_guest === '' ? null : Number(form.base_price_per_guest),
        min_guests: form.min_guests === '' ? null : Number(form.min_guests),
        display_order: Number(form.display_order || 0),
        tiers: (form.tiers || [])
          .filter((t) => t.price_per_guest !== '' && t.price_per_guest != null)
          .map((t) => ({
            min_guests: Number(t.min_guests),
            max_guests: t.max_guests === '' || t.max_guests == null ? null : Number(t.max_guests),
            price_per_guest: Number(t.price_per_guest),
          })),
      };
      const res = form.id
        ? await apiJson(`/api/admin/events/packages/${form.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : await apiJson('/api/admin/events/packages', { method: 'POST', body: JSON.stringify(body) });
      addToast({ type: 'success', title: res.message });
      setForm(null);
      await load();
    } catch (err) {
      addToast({ type: 'error', title: 'Could not save the package', description: errText(err) });
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (pkg) => {
    if (pkg.is_active) {
      const ok = await confirm({
        title: `Deactivate ${pkg.name}?`,
        message: 'Existing quotations keep their prices. It just stops appearing on new ones.',
      });
      if (!ok) return;
    }
    try {
      const res = pkg.is_active
        ? await apiJson(`/api/admin/events/packages/${pkg.id}`, { method: 'DELETE' })
        : await apiJson(`/api/admin/events/packages/${pkg.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: true }) });
      addToast({ type: 'success', title: res.message });
      await load();
    } catch (e) {
      addToast({ type: 'error', title: 'Could not change the package', description: errText(e) });
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
            <h1 className="text-2xl font-bold text-gray-900">Event Packages</h1>
            <p className="mt-1 max-w-3xl text-sm text-gray-500">
              Per-guest catering offers and their price tiers. Prices are configuration — nothing is
              fixed in code. Choose how tiers apply: whole-party pricing is simpler to quote,
              progressive pricing guarantees a bigger party never costs less.
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={load} className={BTN}><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Refresh</button>
            <button onClick={() => setForm({ ...EMPTY, tiers: [...EMPTY.tiers] })} className={PRIMARY}>
              <Plus className="h-4 w-4" />New Package
            </button>
          </div>
        </div>
      </header>

      <main className="bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {packages.map((p) => (
            <article key={p.id} className={`border bg-white ${p.is_active ? 'border-gray-200' : 'border-dashed border-gray-300 opacity-70'}`}>
              <div className="flex items-start justify-between gap-2 border-b border-gray-100 p-4">
                <div>
                  <h2 className="font-bold text-gray-900">{p.name}</h2>
                  <p className="mt-0.5 text-xs text-gray-500">{POLICY_LABEL[p.pricing_policy]}</p>
                  {p.description && <p className="mt-1 text-xs text-gray-500">{p.description}</p>}
                </div>
                <span className={`shrink-0 px-2 py-1 text-xs font-semibold ${p.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                  {p.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr><th className="px-4 py-2 font-semibold">Guests</th><th className="px-4 py-2 text-right font-semibold">Per guest</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(p.tiers || []).map((t) => (
                    <tr key={t.id}>
                      <td className="px-4 py-2 text-gray-700">{t.max_guests == null ? `${t.min_guests}+` : `${t.min_guests}–${t.max_guests}`}</td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums">{money(t.price_per_guest)}</td>
                    </tr>
                  ))}
                  {!(p.tiers || []).length && (
                    <tr><td colSpan={2} className="px-4 py-3 text-xs text-gray-500">
                      {p.base_price_per_guest != null ? `Flat ${money(p.base_price_per_guest)} per guest` : 'No tiers set'}
                    </td></tr>
                  )}
                </tbody>
              </table>

              {(p.cliffs || []).map((c) => (
                <div key={c.at} className="flex items-start gap-2 border-t border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span><b>Pricing cliff.</b> {c.message} Switch to progressive pricing if that is not intended.</span>
                </div>
              ))}

              <div className="flex flex-wrap gap-2 border-t border-gray-100 p-3">
                <button onClick={() => setCalc({ pkg: p, guests: 100, result: null, manualRate: '' })} className={SMALL}>
                  <Calculator className="h-3.5 w-3.5" />Calculator
                </button>
                <button
                  onClick={() => setForm({
                    ...p,
                    is_active: !!p.is_active,
                    base_price_per_guest: p.base_price_per_guest ?? '',
                    min_guests: p.min_guests ?? '',
                    tiers: (p.tiers || []).map((t) => ({
                      min_guests: t.min_guests, max_guests: t.max_guests ?? '', price_per_guest: t.price_per_guest,
                    })),
                  })}
                  className={SMALL}
                ><Pencil className="h-3.5 w-3.5" />Edit</button>
                <button onClick={() => toggleActive(p)} className={SMALL}>{p.is_active ? 'Deactivate' : 'Reactivate'}</button>
              </div>
            </article>
          ))}
        </div>

        {!busy && !packages.length && (
          <div className="border border-dashed border-gray-300 bg-white py-16 text-center">
            <p className="text-sm text-gray-500">No packages yet.</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-gray-400">
              Add your buffet offers and their per-guest tiers — for example up to 50 guests at one
              rate and above 50 at another.
            </p>
            <button onClick={() => setForm({ ...EMPTY, tiers: [...EMPTY.tiers] })} className={`${PRIMARY} mt-4`}>
              <Plus className="h-4 w-4" />Add the first package
            </button>
          </div>
        )}
      </main>

      {form && <PackageForm form={form} setForm={setForm} onSave={save} onClose={() => setForm(null)} busy={busy} addToast={addToast} />}
      {calc && <CalculatorDialog calc={calc} setCalc={setCalc} onClose={() => setCalc(null)} addToast={addToast} />}
    </AdminLayout>
  );
}

function PackageForm({ form, setForm, onSave, onClose, busy, addToast }) {
  const [preview, setPreview] = useState(null);
  const [previewGuests, setPreviewGuests] = useState(100);

  const setTier = (i, key, value) => {
    setForm((f) => {
      const tiers = [...f.tiers];
      tiers[i] = { ...tiers[i], [key]: value };
      return { ...f, tiers };
    });
  };
  const addTier = () => setForm((f) => {
    const last = f.tiers[f.tiers.length - 1];
    const nextMin = last && last.max_guests ? Number(last.max_guests) + 1 : 1;
    return { ...f, tiers: [...f.tiers, { min_guests: nextMin, max_guests: '', price_per_guest: '' }] };
  });
  const removeTier = (i) => setForm((f) => ({ ...f, tiers: f.tiers.filter((_, x) => x !== i) }));

  /** Preview the unsaved draft, so tiers can be checked before committing. */
  const runPreview = async () => {
    try {
      const draft = {
        name: form.name || 'Draft package',
        pricing_policy: form.pricing_policy,
        base_price_per_guest: form.base_price_per_guest === '' ? null : Number(form.base_price_per_guest),
        min_guests: form.min_guests === '' ? null : Number(form.min_guests),
        tiers: (form.tiers || [])
          .filter((t) => t.price_per_guest !== '' && t.price_per_guest != null)
          .map((t) => ({
            min_guests: Number(t.min_guests),
            max_guests: t.max_guests === '' || t.max_guests == null ? null : Number(t.max_guests),
            price_per_guest: Number(t.price_per_guest),
          })),
      };
      setPreview(await apiJson('/api/admin/events/packages/preview', {
        method: 'POST',
        body: JSON.stringify({ draft, guests: previewGuests }),
      }));
    } catch (e) {
      setPreview(null);
      addToast({ type: 'error', title: 'Preview failed', description: errText(e) });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <form onSubmit={onSave} className="my-8 w-full max-w-3xl border border-gray-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="font-bold text-gray-900">{form.id ? `Edit ${form.name}` : 'New Event Package'}</h2>
          <button type="button" onClick={onClose} className={ICON}><X className="h-4 w-4" /></button>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <F label="Package name" required>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Chicken Buffet" className={INPUT} />
          </F>
          <F label="Short code">
            <input value={form.code || ''} onChange={(e) => setForm({ ...form, code: e.target.value })} className={INPUT} />
          </F>
          <F label="Description" wide>
            <textarea value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="min-h-16 w-full border border-gray-300 p-3 text-sm" />
          </F>

          <F label="Pricing policy" wide hint={POLICY_HELP[form.pricing_policy]}>
            <select value={form.pricing_policy} onChange={(e) => setForm({ ...form, pricing_policy: e.target.value })} className={INPUT}>
              {Object.entries(POLICY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </F>

          <F label="Minimum guests" hint="Below this only warns">
            <input type="number" min="0" step="1" value={form.min_guests ?? ''}
              onChange={(e) => setForm({ ...form, min_guests: e.target.value })} className={INPUT} />
          </F>
          <F label="Base price per guest" hint="Used when no tier matches">
            <input type="number" min="0" step="0.01" value={form.base_price_per_guest ?? ''}
              onChange={(e) => setForm({ ...form, base_price_per_guest: e.target.value })} className={INPUT} />
          </F>
        </div>

        <div className="border-t border-gray-200 px-5 py-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900">Price tiers</h3>
            <button type="button" onClick={addTier} className={SMALL}><Plus className="h-3.5 w-3.5" />Add tier</button>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Bands must run continuously with no gaps or overlaps. Leave the last “to” empty for “and above”.
          </p>
          <div className="mt-3 space-y-2">
            {(form.tiers || []).map((t, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1.2fr_auto] items-end gap-2">
                <label className="text-xs text-gray-600">From
                  <input type="number" min="1" step="1" value={t.min_guests}
                    onChange={(e) => setTier(i, 'min_guests', e.target.value)} className={`${INPUT} mt-1`} />
                </label>
                <label className="text-xs text-gray-600">To
                  <input type="number" min="1" step="1" value={t.max_guests ?? ''} placeholder="and above"
                    onChange={(e) => setTier(i, 'max_guests', e.target.value)} className={`${INPUT} mt-1`} />
                </label>
                <label className="text-xs text-gray-600">Price per guest
                  <input type="number" min="0" step="0.01" value={t.price_per_guest}
                    onChange={(e) => setTier(i, 'price_per_guest', e.target.value)} className={`${INPUT} mt-1`} />
                </label>
                <button type="button" onClick={() => removeTier(i)} className={`${ICON} mb-0`} aria-label="Remove tier">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-gray-200 bg-gray-50 px-5 py-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-medium text-gray-600">Preview for
              <input type="number" min="1" step="1" value={previewGuests}
                onChange={(e) => setPreviewGuests(e.target.value)} className={`${INPUT} mt-1 w-32`} />
            </label>
            <button type="button" onClick={runPreview} className={BTN}><Calculator className="h-4 w-4" />Preview price</button>
          </div>
          {preview && <PreviewTable preview={preview} />}
        </div>

        <label className="flex items-center gap-2 border-t border-gray-200 px-5 py-4 text-sm font-medium text-gray-700">
          <input type="checkbox" checked={!!form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="h-4 w-4" />
          Active — offered on new quotations
        </label>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
          <button type="button" onClick={onClose} className={BTN}>Cancel</button>
          <button disabled={busy} className={PRIMARY}>{busy ? 'Saving…' : 'Save package'}</button>
        </div>
      </form>
    </div>
  );
}

function CalculatorDialog({ calc, setCalc, onClose, addToast }) {
  const run = async () => {
    try {
      const result = await apiJson('/api/admin/events/packages/preview', {
        method: 'POST',
        body: JSON.stringify({
          package_id: calc.pkg.id,
          guests: calc.guests,
          manual_rate: calc.manualRate === '' ? null : Number(calc.manualRate),
        }),
      });
      setCalc((c) => ({ ...c, result }));
    } catch (e) {
      addToast({ type: 'error', title: 'Could not calculate', description: errText(e) });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-8 w-full max-w-2xl border border-gray-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="font-bold text-gray-900">{calc.pkg.name} — price calculator</h2>
            <p className="text-xs text-gray-500">Compare how each policy prices the same head count.</p>
          </div>
          <button onClick={onClose} className={ICON}><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-wrap items-end gap-2 p-5">
          <label className="text-xs font-medium text-gray-600">Guests
            <input type="number" min="1" step="1" value={calc.guests}
              onChange={(e) => setCalc((c) => ({ ...c, guests: e.target.value }))} className={`${INPUT} mt-1 w-32`} />
          </label>
          <label className="text-xs font-medium text-gray-600">Negotiated rate
            <input type="number" min="0" step="0.01" value={calc.manualRate}
              onChange={(e) => setCalc((c) => ({ ...c, manualRate: e.target.value }))}
              placeholder="optional" className={`${INPUT} mt-1 w-40`} />
          </label>
          <button onClick={run} className={PRIMARY}><Calculator className="h-4 w-4" />Calculate</button>
        </div>
        {calc.result && <div className="px-5 pb-5"><PreviewTable preview={calc.result} /></div>}
        <div className="flex justify-end border-t border-gray-200 px-5 py-4">
          <button onClick={onClose} className={BTN}>Close</button>
        </div>
      </div>
    </div>
  );
}

function PreviewTable({ preview }) {
  const rows = Object.entries(preview.policies || {});
  return (
    <div className="mt-3 space-y-3">
      <table className="w-full border border-gray-200 bg-white text-left text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="px-3 py-2 font-semibold">Policy</th>
            <th className="px-3 py-2 text-right font-semibold">Per guest</th>
            <th className="px-3 py-2 text-right font-semibold">Total for {preview.guests}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(([policy, r]) => (
            <tr key={policy}>
              <td className="px-3 py-2">
                {POLICY_LABEL[policy] || policy}
                {r.breakdown && (
                  <p className="text-xs text-gray-500">{r.breakdown.map((b) => b.label).join(' + ')}</p>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{r.error ? '—' : money(r.effective_per_guest)}</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">
                {r.error ? <span className="text-xs text-red-600">{r.error}</span> : money(r.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {(preview.cliffs || []).map((c) => (
        <div key={c.at} className="flex items-start gap-2 border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span><b>Pricing cliff at {c.at} guests.</b> {c.message}</span>
        </div>
      ))}

      {rows.flatMap(([policy, r]) => (r.warnings || []).map((w, i) => (
        <p key={`${policy}-${i}`} className="text-xs text-amber-700">{w}</p>
      )))}
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

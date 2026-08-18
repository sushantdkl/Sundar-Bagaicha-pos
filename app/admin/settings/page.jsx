'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AdminLayout from '@/components/admin/admin-layout';
import {
  Save, Store, Receipt, CreditCard, QrCode, Upload, Loader2, Shield, Percent,
  CalendarClock, Utensils, ExternalLink, KeyRound, ScanLine, Truck, Plus, Trash2,
} from 'lucide-react';
import { PRIMARY_ROUTE } from '@/lib/deployment';

// Everything here maps to a system_settings key the app actually reads.
const TABS = [
  { id: 'business', label: 'Business', icon: Store },
  { id: 'billing', label: 'Billing & Tax', icon: Percent },
  { id: 'delivery', label: 'Delivery pricing', icon: Truck },
  { id: 'reservations', label: 'Reservations', icon: CalendarClock },
  { id: 'receipt', label: 'Receipt', icon: Receipt },
  { id: 'ordering', label: 'Ordering', icon: ScanLine },
  { id: 'payments', label: 'Payments & QR', icon: CreditCard },
  { id: 'shortcuts', label: 'More config', icon: ExternalLink },
  { id: 'account', label: 'Account', icon: Shield },
];

const RES_FIELDS = [
  ['reservation_hold_minutes', 'Reservation hold (min)', 30],
  ['reservation_grace_minutes', 'No-show grace (min)', 20],
  ['reservation_dining_minutes', 'Dining duration (min)', 90],
  ['reservation_cleaning_minutes', 'Table cleaning (min)', 10],
  ['reservation_auto_cancel_minutes', 'Auto-cancel after (min)', 20],
  ['reservation_min_lead_minutes', 'Minimum lead time (min)', 60],
];

const SHORTCUTS = [
  { href: '/admin/table-management', label: 'Tables, floors & QR codes' },
  { href: '/admin/categories', label: 'Menu categories' },
  { href: '/admin/inventory-categories', label: 'Inventory categories' },
  { href: '/admin/unit-conversion', label: 'Units & conversions' },
  { href: '/admin/chart-of-accounts', label: 'Chart of accounts' },
  { href: '/admin/bank', label: 'Bank accounts' },
  { href: '/admin/cash-drawer', label: 'Cash drawers' },
  { href: '/admin/settlements', label: 'Payment settlement' },
  { href: '/admin/employees', label: 'Employees & payroll' },
  { href: '/admin/expense-categories', label: 'Expense categories' },
];

export default function SettingsPage() {
  const router = useRouter();
  const [forcePin, setForcePin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('business');
  const [message, setMessage] = useState({ type: '', text: '' });
  const [currentUser, setCurrentUser] = useState(null);
  const [showCredentials, setShowCredentials] = useState(false);
  const [pw, setPw] = useState({ username: '', currentPassword: '', newPassword: '', confirmPassword: '' });

  const [s, setS] = useState({
    restaurant_name: '', legal_name: '', owner_name: '', restaurant_phone: '', restaurant_email: '',
    website: '', vat_number: '', pan_number: '', registration_number: '', restaurant_address: '',
    vat_percentage: 13, service_charge_percentage: 10,
    receipt_footer: '', receipt_paper_size: '80', qr_ordering_enabled: true,
    kitchen_printing_enabled: false,
    delivery_pricing_enabled: false, delivery_pricing_mode: 'fixed', delivery_fixed_fee: 0,
    delivery_distance_bands: [], delivery_per_km_rate: 0, delivery_minimum_fee: 0, delivery_max_distance_km: 0,
    bank_qr_image: '', esewa_qr_image: '',
    ...Object.fromEntries(RES_FIELDS.map(([k, , d]) => [k, d])),
  });
  const set = (patch) => setS((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    const u = JSON.parse(localStorage.getItem('pos_user') || '{}');
    setCurrentUser(u);
    const forced = typeof window !== 'undefined'
      && (new URLSearchParams(window.location.search).get('changePin') === '1' || !!u.must_change_password);
    setForcePin(forced);
    if (forced) {
      setTab('account');
      setShowCredentials(true);
      setPw((p) => ({ ...p, username: u.username || 'admin' }));
      setMessage({ type: 'error', text: 'Please change the default admin PIN before using the system.' });
    }
    (async () => {
      try {
        const token = localStorage.getItem('pos_token');
        const res = await fetch('/api/admin/settings', { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const d = (await res.json()).settings || {};
          let deliveryBands = [];
          try { deliveryBands = JSON.parse(d.delivery_distance_bands || '[]'); } catch { deliveryBands = []; }
          set({
            restaurant_name: d.restaurant_name || '', legal_name: d.legal_name || '', owner_name: d.owner_name || '',
            restaurant_phone: d.restaurant_phone || '', restaurant_email: d.restaurant_email || '', website: d.website || '',
            vat_number: d.vat_number || '', pan_number: d.pan_number || '', registration_number: d.registration_number || '',
            restaurant_address: d.restaurant_address || '',
            vat_percentage: Number(d.vat_percentage ?? 13), service_charge_percentage: Number(d.service_charge_percentage ?? 10),
            receipt_footer: d.receipt_footer || '', receipt_paper_size: d.receipt_paper_size || '80', qr_ordering_enabled: String(d.qr_ordering_enabled ?? 'true') !== 'false',
            kitchen_printing_enabled: String(d.kitchen_printing_enabled ?? 'false') === 'true',
            bank_qr_image: d.bank_qr_image || '', esewa_qr_image: d.esewa_qr_image || '',
            delivery_pricing_enabled: String(d.delivery_pricing_enabled ?? 'false') === 'true',
            delivery_pricing_mode: d.delivery_pricing_mode || 'fixed',
            delivery_fixed_fee: Number(d.delivery_fixed_fee || 0),
            delivery_distance_bands: Array.isArray(deliveryBands) ? deliveryBands : [],
            delivery_per_km_rate: Number(d.delivery_per_km_rate || 0),
            delivery_minimum_fee: Number(d.delivery_minimum_fee || 0),
            delivery_max_distance_km: Number(d.delivery_max_distance_km || 0),
            ...Object.fromEntries(RES_FIELDS.map(([k, , dv]) => [k, Number(d[k] ?? dv)])),
          });
        }
      } catch { setMessage({ type: 'error', text: 'Failed to load settings' }); }
      finally { setLoading(false); }
    })();
  }, []);

  const uploadQR = (e, which) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) { setMessage({ type: 'error', text: 'Please choose an image.' }); return; }
    const reader = new FileReader();
    reader.onload = (ev) => { set({ [which === 'bank' ? 'bank_qr_image' : 'esewa_qr_image']: ev.target.result }); };
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setSaving(true);
    setMessage({ type: '', text: '' });
    try {
      const token = localStorage.getItem('pos_token');
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...s,
          vat_percentage: Number(s.vat_percentage) || 0,
          service_charge_percentage: Number(s.service_charge_percentage) || 0,
          qr_ordering_enabled: s.qr_ordering_enabled ? 'true' : 'false',
          kitchen_printing_enabled: s.kitchen_printing_enabled ? 'true' : 'false',
          delivery_pricing_enabled: s.delivery_pricing_enabled ? 'true' : 'false',
          delivery_distance_bands: JSON.stringify(s.delivery_distance_bands || []),
          ...Object.fromEntries(RES_FIELDS.map(([k]) => [k, Number(s[k]) || 0])),
        }),
      });
      if (res.ok) { setMessage({ type: 'success', text: 'Settings saved.' }); setTimeout(() => setMessage({ type: '', text: '' }), 2500); }
      else { const d = await res.json().catch(() => ({})); setMessage({ type: 'error', text: d.error || 'Failed to save.' }); }
    } catch { setMessage({ type: 'error', text: 'Connection error.' }); }
    finally { setSaving(false); }
  };

  const changeCredentials = async (e) => {
    e.preventDefault();
    if ((pw.username || '').trim().length < 3) { setMessage({ type: 'error', text: 'Username must be at least 3 characters.' }); return; }
    if ((pw.newPassword || pw.confirmPassword) && pw.newPassword !== pw.confirmPassword) { setMessage({ type: 'error', text: 'Passwords do not match.' }); return; }
    setSaving(true);
    try {
      const token = localStorage.getItem('pos_token');
      const res = await fetch('/api/auth/change-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentUsername: currentUser?.username, newUsername: pw.username, currentPassword: pw.currentPassword, newPassword: pw.newPassword || null }),
      });
      const d = await res.json();
      if (res.ok) {
        setMessage({ type: 'success', text: d.message || 'Credentials updated.' });
        const u = { ...(currentUser || {}), ...(d.user || {}), username: pw.username, must_change_password: false };
        localStorage.setItem('pos_user', JSON.stringify(u)); setCurrentUser(u);
        setPw({ username: pw.username, currentPassword: '', newPassword: '', confirmPassword: '' }); setShowCredentials(false);
        if (forcePin) router.replace(PRIMARY_ROUTE);
      } else setMessage({ type: 'error', text: d.error || 'Failed to update credentials.' });
    } catch { setMessage({ type: 'error', text: 'Connection error.' }); }
    finally { setSaving(false); }
  };

  if (loading) return <AdminLayout><div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-500" /></div></AdminLayout>;

  return (
    <AdminLayout>
      {message.text && (
        <div className="fixed right-4 top-16 z-[60]">
          <div className={`rounded-lg px-5 py-3 text-sm font-semibold text-white shadow-xl ${message.type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'}`}>{message.text}</div>
        </div>
      )}

      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Configuration Center</h1>
        <p className="mt-1 text-sm text-gray-500">Every setting here changes real behaviour. Structural config (tables, accounts, staff) lives in its own module.</p>
      </header>

      <div className="bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 lg:flex-row">
          <nav className="flex gap-1 overflow-x-auto lg:w-56 lg:flex-col">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium ${tab === t.id ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'}`}>
                <t.icon className="h-4 w-4" /> {t.label}
              </button>
            ))}
          </nav>

          <div className="min-w-0 flex-1 space-y-5">
            {tab === 'business' && (
              <Panel title="Business information" hint="Prints on receipts and the public menu where shown.">
                <Grid>
                  <Field label="Business name"><input value={s.restaurant_name} onChange={(e) => set({ restaurant_name: e.target.value })} className={INPUT} /></Field>
                  <Field label="Legal / registered name"><input value={s.legal_name} onChange={(e) => set({ legal_name: e.target.value })} className={INPUT} /></Field>
                  <Field label="Owner"><input value={s.owner_name} onChange={(e) => set({ owner_name: e.target.value })} className={INPUT} /></Field>
                  <Field label="Phone"><input value={s.restaurant_phone} onChange={(e) => set({ restaurant_phone: e.target.value })} className={INPUT} /></Field>
                  <Field label="Email"><input value={s.restaurant_email} onChange={(e) => set({ restaurant_email: e.target.value })} className={INPUT} /></Field>
                  <Field label="Website"><input value={s.website} onChange={(e) => set({ website: e.target.value })} className={INPUT} placeholder="prints on receipt" /></Field>
                  <Field label="VAT number"><input value={s.vat_number} onChange={(e) => set({ vat_number: e.target.value })} className={INPUT} /></Field>
                  <Field label="PAN number"><input value={s.pan_number} onChange={(e) => set({ pan_number: e.target.value })} className={INPUT} /></Field>
                  <Field label="Registration number"><input value={s.registration_number} onChange={(e) => set({ registration_number: e.target.value })} className={INPUT} /></Field>
                </Grid>
                <Field label="Address"><textarea rows={2} value={s.restaurant_address} onChange={(e) => set({ restaurant_address: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></Field>
              </Panel>
            )}

            {tab === 'billing' && (
              <Panel title="Billing & tax" hint="Applied to every bill total (exclusive tax + service charge).">
                <Grid>
                  <Field label="VAT rate (%)"><input type="number" step="any" value={s.vat_percentage} onChange={(e) => set({ vat_percentage: e.target.value })} className={INPUT} /></Field>
                  <Field label="Service charge (%)"><input type="number" step="any" value={s.service_charge_percentage} onChange={(e) => set({ service_charge_percentage: e.target.value })} className={INPUT} /></Field>
                </Grid>
                <p className="text-xs text-gray-400">Payment methods, cash drawers and digital-wallet settlement are configured under Payments &amp; QR and their own modules.</p>
              </Panel>
            )}

            {tab === 'reservations' && (
              <Panel title="Reservations & tables" hint="Drives the host desk hold, grace, dining and cleaning timers.">
                <Grid>
                  {RES_FIELDS.map(([k, label]) => (
                    <Field key={k} label={label}><input type="number" value={s[k]} onChange={(e) => set({ [k]: e.target.value })} className={INPUT} /></Field>
                  ))}
                </Grid>
              </Panel>
            )}

            {tab === 'delivery' && (
              <Panel title="Delivery pricing" hint="Shown at website checkout and saved on the order and bill. Pickup remains free.">
                <label className="flex items-center justify-between rounded-lg border border-gray-200 p-4">
                  <span><span className="block text-sm font-medium text-gray-800">Charge for delivery</span><span className="mt-0.5 block text-xs text-gray-500">Turn off to show delivery as free.</span></span>
                  <input type="checkbox" checked={s.delivery_pricing_enabled} onChange={(e) => set({ delivery_pricing_enabled: e.target.checked })} className="h-5 w-5 rounded border-gray-300" />
                </label>
                {s.delivery_pricing_enabled && <>
                  <Field label="How is the fee calculated?">
                    <select value={s.delivery_pricing_mode} onChange={(e) => set({ delivery_pricing_mode: e.target.value })} className={INPUT}>
                      <option value="fixed">One fixed fee</option>
                      <option value="distance_bands">Fee by distance range</option>
                      <option value="per_km">Price per kilometre</option>
                    </select>
                  </Field>
                  {s.delivery_pricing_mode === 'fixed' && <Field label="Fixed delivery fee (Rs)"><input type="number" min="0" step="0.01" value={s.delivery_fixed_fee} onChange={(e) => set({ delivery_fixed_fee: e.target.value })} className={INPUT} /></Field>}
                  {s.delivery_pricing_mode === 'distance_bands' && <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium text-gray-800">Distance ranges</p><p className="text-xs text-gray-500">Customers choose the range that contains their address.</p></div><button type="button" onClick={() => set({ delivery_distance_bands: [...s.delivery_distance_bands, { id: globalThis.crypto?.randomUUID?.() || `band-${Date.now()}`, maxKm: '', fee: '' }] })} className="inline-flex h-10 items-center gap-2 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-700 active:scale-[0.97]"><Plus className="h-4 w-4" />Add range</button></div>
                    {s.delivery_distance_bands.map((band, index) => <div key={band.id || index} className="grid grid-cols-[1fr_1fr_auto] gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <Field label="Up to (km)"><input type="number" min="0.1" step="0.1" value={band.maxKm ?? band.max_km ?? ''} onChange={(e) => set({ delivery_distance_bands: s.delivery_distance_bands.map((row, i) => i === index ? { ...row, maxKm: e.target.value } : row) })} className={INPUT} /></Field>
                      <Field label="Fee (Rs)"><input type="number" min="0" step="0.01" value={band.fee ?? ''} onChange={(e) => set({ delivery_distance_bands: s.delivery_distance_bands.map((row, i) => i === index ? { ...row, fee: e.target.value } : row) })} className={INPUT} /></Field>
                      <button type="button" aria-label="Remove range" onClick={() => set({ delivery_distance_bands: s.delivery_distance_bands.filter((_, i) => i !== index) })} className="mt-6 flex h-11 w-11 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50 active:scale-[0.97]"><Trash2 className="h-4 w-4" /></button>
                    </div>)}
                    {!s.delivery_distance_bands.length && <p className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500">Add at least one distance range before using this mode.</p>}
                  </div>}
                  {s.delivery_pricing_mode === 'per_km' && <Grid>
                    <Field label="Price per km (Rs)"><input type="number" min="0" step="0.01" value={s.delivery_per_km_rate} onChange={(e) => set({ delivery_per_km_rate: e.target.value })} className={INPUT} /></Field>
                    <Field label="Minimum fee (Rs)"><input type="number" min="0" step="0.01" value={s.delivery_minimum_fee} onChange={(e) => set({ delivery_minimum_fee: e.target.value })} className={INPUT} /></Field>
                    <Field label="Maximum delivery distance (km)"><input type="number" min="0" step="0.1" value={s.delivery_max_distance_km} onChange={(e) => set({ delivery_max_distance_km: e.target.value })} className={INPUT} /></Field>
                  </Grid>}
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Distance is entered or selected by the customer and should be confirmed against the address before accepting the order.</p>
                </>}
              </Panel>
            )}

            {tab === 'receipt' && (
              <Panel title="Receipt" hint="Business name, VAT/PAN, website and this footer all print on the customer receipt.">
                <Grid>
                  <Field label="Thermal paper size">
                    <select value={s.receipt_paper_size} onChange={(e) => set({ receipt_paper_size: e.target.value })} className={INPUT}>
                      <option value="80">80mm (standard)</option>
                      <option value="58">58mm (compact)</option>
                    </select>
                  </Field>
                  <Field label="Receipt footer message"><input value={s.receipt_footer} onChange={(e) => set({ receipt_footer: e.target.value })} className={INPUT} placeholder="Thank you for your visit!" /></Field>
                </Grid>
                <p className="text-xs text-gray-400">Receipts print through the shared thermal system and re-format automatically for the selected width.</p>
                <label className="mt-4 flex items-center justify-between rounded-lg border border-gray-200 p-4">
                  <span className="flex items-center gap-2 text-sm font-medium text-gray-800"><Receipt className="h-4 w-4 text-gray-500" /> Auto-print kitchen tickets (KOT)</span>
                  <input type="checkbox" checked={s.kitchen_printing_enabled} onChange={(e) => set({ kitchen_printing_enabled: e.target.checked })} className="h-5 w-5 rounded border-gray-300" />
                </label>
                <p className="text-xs text-gray-400">
                  Enable only on devices physically connected to the kitchen printer (waiter tablet or POS PC in the kitchen). When on, KOTs print automatically as soon as they&apos;re sent — new, additional and cancellation tickets. When off, staff still see the ticket on the Kitchen display and can print any KOT manually from KOT history. Uses the thermal paper size above.
                </p>
              </Panel>
            )}

            {tab === 'ordering' && (
              <Panel title="Customer / QR ordering" hint="Controls the table-QR self-ordering flow.">
                <label className="flex items-center justify-between rounded-lg border border-gray-200 p-4">
                  <span className="flex items-center gap-2 text-sm font-medium text-gray-800"><Utensils className="h-4 w-4 text-gray-500" /> Self QR ordering enabled</span>
                  <input type="checkbox" checked={s.qr_ordering_enabled} onChange={(e) => set({ qr_ordering_enabled: e.target.checked })} className="h-5 w-5 rounded border-gray-300" />
                </label>
                <p className="text-xs text-gray-400">When off, scanning a table QR still shows the menu but ordering is paused (staff take orders). Print QR codes from Table Management.</p>
              </Panel>
            )}

            {tab === 'payments' && (
              <Panel title="Payment QR codes" hint="Shown to customers at checkout for digital payment.">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <QrUpload label="eSewa / Fonepay QR" value={s.esewa_qr_image} onUpload={(e) => uploadQR(e, 'esewa')} onClear={() => set({ esewa_qr_image: '' })} />
                  <QrUpload label="Bank QR" value={s.bank_qr_image} onUpload={(e) => uploadQR(e, 'bank')} onClear={() => set({ bank_qr_image: '' })} />
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  <Shortcut href="/admin/bank" label="Bank accounts" />
                  <Shortcut href="/admin/cash-drawer" label="Cash drawers" />
                  <Shortcut href="/admin/settlements" label="Settlement" />
                </div>
              </Panel>
            )}

            {tab === 'shortcuts' && (
              <Panel title="More configuration" hint="These have dedicated screens — settings here would only duplicate them.">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {SHORTCUTS.map((sc) => <Shortcut key={sc.href} href={sc.href} label={sc.label} block />)}
                </div>
              </Panel>
            )}

            {tab === 'account' && (
              <Panel title="Your account" hint="Change your own username / password.">
                <div className="flex items-center justify-between rounded-lg border border-gray-200 p-4">
                  <div><p className="text-sm font-medium text-gray-900">{currentUser?.full_name || currentUser?.username}</p><p className="text-xs text-gray-500 capitalize">{currentUser?.role}</p></div>
                  <button onClick={() => { setPw((p) => ({ ...p, username: currentUser?.username || '' })); setShowCredentials(true); }} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><KeyRound className="h-4 w-4" /> Change credentials</button>
                </div>
                <p className="text-xs text-gray-400">Staff accounts, roles and PINs are managed in Employees.</p>
              </Panel>
            )}

            {tab !== 'shortcuts' && tab !== 'account' && (
              <div className="sticky bottom-4 flex justify-end">
                <button disabled={saving} onClick={save} className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-6 py-3 text-sm font-semibold text-white shadow-lg hover:bg-gray-800 disabled:opacity-50">
                  <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save settings'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {showCredentials && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={changeCredentials} className="w-full max-w-md rounded-2xl bg-white p-6 sm:p-8">
            <h3 className="mb-2 text-lg font-bold text-gray-900">{forcePin ? 'Set a new admin PIN' : 'Change credentials'}</h3>
            {forcePin && (
              <p className="mb-4 text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                Default seed PIN must be changed before going live.
              </p>
            )}
            <div className="space-y-3">
              <Field label="Username"><input value={pw.username} onChange={(e) => setPw({ ...pw, username: e.target.value })} className={INPUT} /></Field>
              <Field label="Current password"><input type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} className={INPUT} required /></Field>
              <Field label={forcePin ? 'New PIN (required)' : 'New password (optional)'}><input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} className={INPUT} required={forcePin} /></Field>
              <Field label="Confirm new password"><input type="password" value={pw.confirmPassword} onChange={(e) => setPw({ ...pw, confirmPassword: e.target.value })} className={INPUT} required={forcePin} /></Field>
            </div>
            <div className="mt-6 flex gap-3">
              <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">Save</button>
              {!forcePin && (
                <button type="button" onClick={() => setShowCredentials(false)} className="flex-1 rounded-lg bg-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-300">Cancel</button>
              )}
            </div>
          </form>
        </div>
      )}
    </AdminLayout>
  );
}

const INPUT = 'h-11 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-900';
function Panel({ title, hint, children }) {
  return <section className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6"><h2 className="text-base font-semibold text-gray-900">{title}</h2>{hint && <p className="mb-4 mt-0.5 text-xs text-gray-500">{hint}</p>}<div className="space-y-4">{children}</div></section>;
}
function Grid({ children }) { return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>; }
function Field({ label, children }) { return <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>{children}</label>; }
function Shortcut({ href, label, block }) {
  return <Link href={href} className={`inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 ${block ? 'justify-between' : ''}`}>{label}<ExternalLink className="h-4 w-4 text-gray-400" /></Link>;
}
function QrUpload({ label, value, onUpload, onClear }) {
  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <p className="mb-2 text-sm font-medium text-gray-700">{label}</p>
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt={label} className="mx-auto h-32 w-32 rounded object-contain" />
      ) : (
        <div className="mx-auto flex h-32 w-32 items-center justify-center rounded bg-gray-100 text-gray-300"><QrCode className="h-8 w-8" /></div>
      )}
      <div className="mt-3 flex gap-2">
        <label className="inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50">
          <Upload className="h-3.5 w-3.5" /> Upload<input type="file" accept="image/*" className="hidden" onChange={onUpload} />
        </label>
        {value && <button type="button" onClick={onClear} className="rounded-lg px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50">Remove</button>}
      </div>
    </div>
  );
}

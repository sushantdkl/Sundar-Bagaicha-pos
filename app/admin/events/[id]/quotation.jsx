'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Plus, Trash2, X } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';
import { money, errText } from '../event-ui';

const LINE_TYPES = [
  ['package', 'Catering package'],
  ['menu_item', 'Restaurant menu item'],
  ['custom_food', 'Custom dish'],
  ['beverage', 'Beverage'],
  ['venue', 'Venue charge'],
  ['service', 'Service (DJ, decoration, staff)'],
  ['equipment', 'Equipment hire'],
  ['misc', 'Other charge'],
  ['complimentary', 'Complimentary'],
];

const EMPTY = {
  line_type: 'package', package_id: '', menu_item_id: '', recipe_id: '',
  item_name: '', description: '', quantity: 1, unit_price: '',
  consumes_inventory: true, override_reason: '',
};

/**
 * Quotation builder. Prices are resolved server-side and stored as snapshots,
 * so what a client is quoted cannot drift with the restaurant menu.
 */
export default function Quotation({ event, lines, onChanged, addToast }) {
  const [packages, setPackages] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [charges, setCharges] = useState({
    discount_amount: event.discount_amount ?? 0,
    discount_reason: event.discount_reason ?? '',
    tax_percent: event.tax_percent ?? 0,
    service_charge_percent: event.service_charge_percent ?? 0,
  });

  useEffect(() => {
    Promise.all([
      apiJson('/api/admin/events/packages?active=1').catch(() => ({ packages: [] })),
      apiJson('/api/admin/products?page_size=500').catch(() => ({ products: [] })),
      apiJson('/api/admin/recipes').catch(() => ({ recipes: [] })),
    ]).then(([p, m, r]) => {
      setPackages(p.packages || []);
      setMenuItems(m.products || m.items || m.data || []);
      setRecipes(r.recipes || r.data || []);
    });
  }, []);

  const locked = ['CONFIRMED', 'PLANNING', 'FINALIZED', 'IN_PROGRESS'].includes(event.status);
  const closed = ['COMPLETED', 'CANCELLED'].includes(event.status);

  const send = async (fn, successTitle) => {
    setBusy(true);
    try {
      const res = await fn();
      addToast({ type: 'success', title: successTitle || res.message });
      setForm(null);
      onChanged();
    } catch (e) {
      // A locked quotation can still be changed with a stated reason.
      if (e.code === 'quote_locked') {
        const reason = window.prompt(
          `${event.event_number} is ${event.status} and its quotation is locked.\n\nWhy is it being changed? (recorded in the audit trail)`
        );
        if (reason && reason.trim()) {
          setBusy(false);
          return send(() => fn(reason.trim()), successTitle);
        }
      } else if (e.code === 'override_reason_required') {
        addToast({
          type: 'error',
          title: 'A reason is required',
          description: e.standard_price != null
            ? `The standard price is ${money(e.standard_price)}. Enter a reason to charge something else.`
            : e.error,
        });
      } else {
        addToast({ type: 'error', title: 'Could not update the quotation', description: errText(e) });
      }
    } finally {
      setBusy(false);
    }
  };

  const addLine = (changeReason) => send(
    () => apiJson(`/api/admin/events/${event.id}/lines`, {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        package_id: form.package_id || null,
        menu_item_id: form.menu_item_id || null,
        recipe_id: form.recipe_id || null,
        quantity: Number(form.quantity),
        unit_price: form.unit_price === '' ? undefined : Number(form.unit_price),
        change_reason: changeReason,
      }),
    }),
    'Line added'
  );

  const removeLine = (line) => send(
    (changeReason) => apiJson(`/api/admin/events/${event.id}/lines/${line.id}`, {
      method: 'DELETE',
      body: JSON.stringify({ change_reason: changeReason }),
    }),
    'Line removed'
  );

  const saveCharges = () => send(
    (changeReason) => apiJson(`/api/admin/events/${event.id}/charges`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...charges,
        discount_amount: Number(charges.discount_amount || 0),
        tax_percent: Number(charges.tax_percent || 0),
        service_charge_percent: Number(charges.service_charge_percent || 0),
        change_reason: changeReason,
      }),
    }),
    'Charges updated'
  );

  return (
    <section className="border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Quotation</h2>
          <p className="text-xs text-gray-500">
            Prices are snapshots taken when each line is added — later menu changes cannot move them.
          </p>
        </div>
        {!closed && (
          <button onClick={() => setForm({ ...EMPTY })} className={SMALL}><Plus className="h-3.5 w-3.5" />Add line</button>
        )}
      </div>

      {locked && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>This event is {event.status}. Changing the quotation asks for a reason and is recorded.</span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2 font-semibold">Item</th>
              <th className="px-4 py-2 text-right font-semibold">Qty</th>
              <th className="px-4 py-2 text-right font-semibold">Unit</th>
              <th className="px-4 py-2 text-right font-semibold">Amount</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2">
                  <span className="font-medium text-gray-900">{l.item_name}</span>
                  {l.is_complimentary === 1 && <span className="ml-2 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">FREE</span>}
                  <span className="block text-xs text-gray-500">
                    {LINE_TYPES.find(([v]) => v === l.line_type)?.[1] || l.line_type}
                    {l.description ? ` · ${l.description}` : ''}
                  </span>
                  {l.price_overridden === 1 && (
                    <span className="mt-0.5 block text-xs text-amber-700">
                      Price overridden{l.list_price != null ? ` from ${money(l.list_price)}` : ''}
                      {l.override_reason ? ` — “${l.override_reason}”` : ''}
                      {l.overridden_by_name ? ` (${l.overridden_by_name})` : ''}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{Number(l.quantity)}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {money(l.unit_price)}
                  {l.list_price != null && Number(l.list_price) !== Number(l.unit_price) && (
                    <span className="block text-xs text-gray-400 line-through">{money(l.list_price)}</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right font-semibold tabular-nums">{money(l.line_total)}</td>
                <td className="px-2 py-2">
                  {!closed && (
                    <button onClick={() => removeLine(l)} className={ICON} aria-label="Remove line">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!lines.length && <p className="py-10 text-center text-sm text-gray-500">No lines yet. Add a package or a charge.</p>}
      </div>

      <div className="grid gap-4 border-t border-gray-200 p-4 lg:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase text-gray-500">Charges</h3>
          <div className="grid grid-cols-2 gap-2">
            <L label="Discount (Rs)">
              <input type="number" min="0" step="0.01" value={charges.discount_amount}
                onChange={(e) => setCharges({ ...charges, discount_amount: e.target.value })} className={INPUT} />
            </L>
            <L label="Discount reason">
              <input value={charges.discount_reason || ''}
                onChange={(e) => setCharges({ ...charges, discount_reason: e.target.value })} className={INPUT} />
            </L>
            <L label="Service charge %">
              <input type="number" min="0" step="0.1" value={charges.service_charge_percent}
                onChange={(e) => setCharges({ ...charges, service_charge_percent: e.target.value })} className={INPUT} />
            </L>
            <L label="VAT / tax %">
              <input type="number" min="0" step="0.1" value={charges.tax_percent}
                onChange={(e) => setCharges({ ...charges, tax_percent: e.target.value })} className={INPUT} />
            </L>
          </div>
          {!closed && <button onClick={saveCharges} disabled={busy} className={SMALL}>Save charges</button>}
        </div>

        <dl className="space-y-1 text-sm">
          <Total label="Subtotal" value={money(event.subtotal)} />
          <Total label="Discount" value={`− ${money(event.discount_amount)}`} />
          <Total label={`Service charge (${Number(event.service_charge_percent || 0)}%)`} value={money(event.service_charge_amount)} />
          <Total label={`VAT (${Number(event.tax_percent || 0)}%)`} value={money(event.tax_amount)} />
          <Total label="Total" value={money(event.total_amount)} strong />
          <Total label="Deposits received" value={`− ${money(event.deposit_total)}`} />
          <Total label="Outstanding" value={money(event.outstanding_amount)} strong />
        </dl>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="my-8 w-full max-w-2xl border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h2 className="font-bold text-gray-900">Add a quotation line</h2>
              <button onClick={() => setForm(null)} className={ICON}><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <L label="Line type" wide>
                <select value={form.line_type} onChange={(e) => setForm({ ...EMPTY, line_type: e.target.value })} className={INPUT}>
                  {LINE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </L>

              {form.line_type === 'package' && (
                <L label="Package" wide hint="Quantity is the number of guests taking this package">
                  <select value={form.package_id} onChange={(e) => setForm({ ...form, package_id: e.target.value })} className={INPUT}>
                    <option value="">Choose a package</option>
                    {packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </L>
              )}

              {(form.line_type === 'menu_item' || form.line_type === 'beverage') && (
                <L label="Menu item" wide>
                  <select value={form.menu_item_id} onChange={(e) => setForm({ ...form, menu_item_id: e.target.value })} className={INPUT}>
                    <option value="">Not linked (enter a name below)</option>
                    {menuItems.map((m) => <option key={m.id} value={m.id}>{m.name} — {money(m.base_price)}</option>)}
                  </select>
                </L>
              )}

              {form.line_type === 'custom_food' && (
                <>
                  <L label="Recipe" hint="Links food cost to the BOM">
                    <select value={form.recipe_id} onChange={(e) => setForm({ ...form, recipe_id: e.target.value })} className={INPUT}>
                      <option value="">No recipe</option>
                      {recipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </L>
                  <label className="flex items-end gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={form.consumes_inventory}
                      onChange={(e) => setForm({ ...form, consumes_inventory: e.target.checked })} className="mb-3 h-4 w-4" />
                    <span className="mb-2">Uses inventory</span>
                  </label>
                </>
              )}

              <L label="Name" wide hint={form.line_type === 'package' ? 'Defaults to the package name' : undefined}>
                <input value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} className={INPUT} />
              </L>
              <L label="Quantity">
                <input type="number" min="0.01" step="1" value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })} className={INPUT} />
              </L>
              <L label="Unit price" hint="Leave blank to use the standard price">
                <input type="number" min="0" step="0.01" value={form.unit_price}
                  onChange={(e) => setForm({ ...form, unit_price: e.target.value })} className={INPUT} />
              </L>
              <L label="Reason for a different price" wide hint="Required when charging other than the standard price">
                <input value={form.override_reason} onChange={(e) => setForm({ ...form, override_reason: e.target.value })} className={INPUT} />
              </L>
              <L label="Description / note" wide>
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={INPUT} />
              </L>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
              <button onClick={() => setForm(null)} className={BTN}>Cancel</button>
              <button onClick={() => addLine()} disabled={busy} className={PRIMARY}>{busy ? 'Adding…' : 'Add line'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Total({ label, value, strong }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? 'border-t border-gray-200 pt-1' : ''}`}>
      <dt className={strong ? 'font-bold text-gray-900' : 'text-gray-500'}>{label}</dt>
      <dd className={`tabular-nums ${strong ? 'font-bold text-gray-900' : 'text-gray-800'}`}>{value}</dd>
    </div>
  );
}

function L({ label, hint, wide, children }) {
  return (
    <label className={`text-xs font-medium text-gray-600 ${wide ? 'sm:col-span-2' : ''}`}>
      {label}
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-0.5 text-[11px] font-normal text-gray-400">{hint}</p>}
    </label>
  );
}

const BTN = 'inline-flex h-10 items-center justify-center gap-2 border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50';
const PRIMARY = 'inline-flex h-10 items-center justify-center gap-2 border border-gray-950 bg-gray-950 px-4 text-sm font-semibold text-white hover:bg-black disabled:opacity-50 [color:#fff!important]';
const SMALL = 'inline-flex h-8 items-center gap-1 border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 hover:bg-gray-50';
const ICON = 'inline-flex h-8 w-8 items-center justify-center border border-gray-300 text-gray-600 hover:bg-gray-50';
const INPUT = 'h-10 w-full border border-gray-300 bg-white px-3 text-sm text-gray-900';

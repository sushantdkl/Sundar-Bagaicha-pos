'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Info, Plus, Trash2, X } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';
import { money, errText } from '../event-ui';

/**
 * Package menu builder.
 *
 * Components reference the restaurant's existing menu items and recipes —
 * nothing is copied, so a recipe change flows through to every package that
 * serves it. Cost is derived from the BOM; price comes from the package tiers.
 * The two are shown together but never derived from one another.
 */
export default function ComponentsEditor({ pkg, onClose, addToast }) {
  const [rows, setRows] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [cost, setCost] = useState(null);
  const [guests, setGuests] = useState(100);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, m, r] = await Promise.all([
          apiJson(`/api/admin/events/packages/${pkg.id}/components`),
          apiJson('/api/admin/products?page_size=500'),
          apiJson('/api/admin/recipes'),
        ]);
        if (cancelled) return;
        setRows((c.components || []).map((x) => ({
          component_name: x.component_name,
          menu_item_id: x.menu_item_id ?? '',
          recipe_id: x.recipe_id ?? '',
          quantity_per_guest: x.quantity_per_guest,
          unit: x.unit ?? '',
          is_optional: !!x.is_optional,
          consumes_inventory: x.consumes_inventory === undefined ? true : !!x.consumes_inventory,
          notes: x.notes ?? '',
        })));
        setMenuItems(m.products || m.items || m.data || []);
        setRecipes(r.recipes || r.data || []);
        setLoaded(true);
      } catch (e) {
        if (!cancelled) addToast({ type: 'error', title: 'Could not load the package menu', description: errText(e) });
      }
    })();
    return () => { cancelled = true; };
  }, [pkg.id, addToast]);

  const refreshCost = useCallback(async () => {
    try {
      setCost(await apiJson(`/api/admin/events/packages/${pkg.id}/cost?guests=${Number(guests) || 1}`));
    } catch (e) {
      addToast({ type: 'error', title: 'Could not cost the package', description: errText(e) });
    }
  }, [pkg.id, guests, addToast]);

  useEffect(() => { if (loaded) refreshCost(); }, [loaded, refreshCost]);

  const setRow = (i, key, value) => setRows((rs) => rs.map((r, x) => (x === i ? { ...r, [key]: value } : r)));
  const addRow = () => setRows((rs) => [...rs, {
    component_name: '', menu_item_id: '', recipe_id: '', quantity_per_guest: 1,
    unit: '', is_optional: false, consumes_inventory: true, notes: '',
  }]);
  const removeRow = (i) => setRows((rs) => rs.filter((_, x) => x !== i));

  const save = async () => {
    setBusy(true);
    try {
      const components = rows.map((r, i) => ({
        component_name: r.component_name,
        menu_item_id: r.menu_item_id === '' ? null : Number(r.menu_item_id),
        recipe_id: r.recipe_id === '' ? null : Number(r.recipe_id),
        quantity_per_guest: Number(r.quantity_per_guest),
        unit: r.unit || null,
        is_optional: !!r.is_optional,
        consumes_inventory: !!r.consumes_inventory,
        notes: r.notes || null,
        sort_order: i,
      }));
      const res = await apiJson(`/api/admin/events/packages/${pkg.id}/components`, {
        method: 'PUT',
        body: JSON.stringify({ components }),
      });
      addToast({ type: 'success', title: res.message, description: 'No stock was reserved or moved.' });
      await refreshCost();
    } catch (e) {
      addToast({ type: 'error', title: 'Could not save the package menu', description: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const margin = cost?.margin;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-8 w-full max-w-5xl border border-gray-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="font-bold text-gray-900">{pkg.name} — package menu</h2>
            <p className="text-xs text-gray-500">
              Link each dish to an existing menu item or recipe. Recipes are referenced, not copied.
            </p>
          </div>
          <button onClick={onClose} className={ICON}><X className="h-4 w-4" /></button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-5">
          <div className="space-y-3">
            {rows.map((r, i) => (
              <div key={i} className="border border-gray-200 p-3">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <L label="Dish / component">
                    <input value={r.component_name} onChange={(e) => setRow(i, 'component_name', e.target.value)}
                      placeholder="e.g. Chicken Curry" className={INPUT} />
                  </L>
                  <L label="Menu item" hint={r.recipe_id ? 'Cleared while a recipe is linked' : undefined}>
                    <select value={r.menu_item_id} disabled={!!r.recipe_id}
                      onChange={(e) => setRow(i, 'menu_item_id', e.target.value)} className={INPUT}>
                      <option value="">Not linked</option>
                      {menuItems.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}{m.is_available ? '' : ' (unavailable)'}</option>
                      ))}
                    </select>
                  </L>
                  <L label="or Recipe" hint={r.menu_item_id ? 'Cleared while a menu item is linked' : undefined}>
                    <select value={r.recipe_id} disabled={!!r.menu_item_id}
                      onChange={(e) => setRow(i, 'recipe_id', e.target.value)} className={INPUT}>
                      <option value="">Not linked</option>
                      {recipes.map((x) => (
                        <option key={x.id} value={x.id}>{x.name}{x.type === 'sub_recipe' ? ' (sub-recipe)' : ''}</option>
                      ))}
                    </select>
                  </L>
                  <L label="Per guest" hint="In recipe yields (portions)">
                    <input type="number" min="0.0001" step="0.05" value={r.quantity_per_guest}
                      onChange={(e) => setRow(i, 'quantity_per_guest', e.target.value)} className={INPUT} />
                  </L>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-xs text-gray-700">
                    <input type="checkbox" checked={r.is_optional}
                      onChange={(e) => setRow(i, 'is_optional', e.target.checked)} className="h-3.5 w-3.5" />
                    Optional
                  </label>
                  <label className="flex items-center gap-2 text-xs text-gray-700">
                    <input type="checkbox" checked={r.consumes_inventory}
                      onChange={(e) => setRow(i, 'consumes_inventory', e.target.checked)} className="h-3.5 w-3.5" />
                    Uses inventory
                  </label>
                  <input value={r.notes} onChange={(e) => setRow(i, 'notes', e.target.value)}
                    placeholder="Kitchen note (optional)" className="h-8 flex-1 border border-gray-300 px-2 text-xs" />
                  <button onClick={() => removeRow(i)} className={ICON} aria-label="Remove component">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button onClick={addRow} className={`${BTN} mt-3`}><Plus className="h-4 w-4" />Add component</button>

          {!rows.length && loaded && (
            <p className="mt-4 text-sm text-gray-500">
              No components yet. Add the dishes this package serves — rice, dal, a curry, salad, dessert.
            </p>
          )}
        </div>

        <div className="border-t border-gray-200 bg-gray-50 px-5 py-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-medium text-gray-600">Cost for
              <input type="number" min="1" step="1" value={guests}
                onChange={(e) => setGuests(e.target.value)} className={`${INPUT} mt-1 w-28`} />
            </label>
            <button onClick={refreshCost} className={BTN}>Recalculate</button>
          </div>

          {cost && (
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="border border-gray-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Component</th>
                      <th className="px-3 py-2 text-right font-semibold">Cost / guest</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(cost.cost?.components || []).map((c) => (
                      <tr key={c.component_id}>
                        <td className="px-3 py-2">
                          {c.name}
                          <span className="block text-xs text-gray-500">
                            {c.source === 'unknown' ? 'no recipe linked'
                              : c.source === 'non_stock' ? 'not stock-backed'
                              : `${c.recipe_name} × ${c.quantity_per_guest}`}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {c.cost_per_guest == null ? <span className="text-amber-700">unknown</span> : money(c.cost_per_guest)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-2">
                <div className="border border-gray-200 bg-white p-4">
                  <Row label="Selling price / guest" value={margin?.selling_price_per_guest != null ? money(margin.selling_price_per_guest) : '—'} />
                  <Row label="Food cost / guest" value={money(cost.cost?.food_cost_per_guest)} />
                  <Row label="Food cost %" value={margin?.food_cost_percent != null ? `${margin.food_cost_percent}%` : '—'} />
                  <Row label={`Contribution (${cost.cost?.guests} guests)`} value={margin?.contribution != null ? money(margin.contribution) : '—'} strong />
                </div>

                {cost.cost?.uncosted?.length > 0 && (
                  <div className="flex items-start gap-2 border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      <b>Food cost is incomplete.</b> {cost.cost.uncosted.map((u) => u.name).join(', ')}
                      {' '}cannot be costed ({cost.cost.uncosted[0].reason}) — the real cost is higher than shown.
                    </span>
                  </div>
                )}

                {margin?.unavailable && (
                  <div className="flex items-start gap-2 border border-gray-200 bg-white p-3 text-xs text-gray-600">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>Margin unavailable: {margin.unavailable}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
          <button onClick={onClose} className={BTN}>Close</button>
          <button onClick={save} disabled={busy} className={PRIMARY}>{busy ? 'Saving…' : 'Save package menu'}</button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong }) {
  return (
    <div className="flex justify-between gap-3 border-b border-gray-50 py-2 text-sm last:border-0">
      <span className="text-gray-500">{label}</span>
      <span className={strong ? 'font-bold text-gray-900' : 'text-gray-900'}>{value}</span>
    </div>
  );
}

function L({ label, hint, children }) {
  return (
    <label className="text-xs font-medium text-gray-600">
      {label}
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-0.5 text-[11px] font-normal text-gray-400">{hint}</p>}
    </label>
  );
}

const BTN = 'inline-flex h-10 items-center justify-center gap-2 border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50';
const PRIMARY = 'inline-flex h-10 items-center justify-center gap-2 border border-gray-950 bg-gray-950 px-4 text-sm font-semibold text-white hover:bg-black disabled:opacity-50 [color:#fff!important]';
const ICON = 'inline-flex h-9 w-9 items-center justify-center border border-gray-300 text-gray-600 hover:bg-gray-50';
const INPUT = 'h-10 w-full border border-gray-300 bg-white px-3 text-sm text-gray-900';

'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Plus, Trash2, X } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';
import { useConfirm } from '@/components/ui/confirm';
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
 *
 * Quantity and unit price are edited in place, as the redesign specifies. That
 * is presentation only — every keystroke still goes through the same PATCH the
 * old dialog used, so the rules it enforces are untouched: a locked quotation
 * demands a change reason, and moving a price off its snapshot demands an
 * override reason and the events.discount permission. Both are asked for and
 * the edit is retried, rather than the change being silently dropped.
 */
export default function Quotation({ event, lines, onChanged, addToast }) {
  const { prompt } = useConfirm();
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

  /**
   * Run a quotation mutation, asking for whichever reason the server demands
   * and retrying once with it. `build` receives the extra fields to merge into
   * its request body.
   */
  const send = async (build, successTitle, extra = {}) => {
    setBusy(true);
    try {
      const res = await build(extra);
      addToast({ type: 'success', title: successTitle || res.message });
      setForm(null);
      await onChanged();
      return true;
    } catch (e) {
      if (e.code === 'quote_locked' && !extra.change_reason) {
        const reason = await prompt({
          title: `${event.event_number} is ${event.status.replace('_', ' ').toLowerCase()}`,
          message: 'Its quotation is locked. Why is it being changed? This is recorded in the audit trail.',
          label: 'Reason',
          required: true,
        });
        if (reason?.trim()) {
          setBusy(false);
          return send(build, successTitle, { ...extra, change_reason: reason.trim() });
        }
      } else if (e.code === 'override_reason_required' && !extra.override_reason) {
        const reason = await prompt({
          title: 'Charging a different price',
          message: e.standard_price != null
            ? `The standard price is ${money(e.standard_price)}. Why is this line priced differently?`
            : 'Why is this line priced differently? This is recorded in the audit trail.',
          label: 'Reason',
          required: true,
        });
        if (reason?.trim()) {
          setBusy(false);
          return send(build, successTitle, { ...extra, override_reason: reason.trim() });
        }
      } else {
        addToast({ type: 'error', title: 'Could not update the quotation', description: errText(e) });
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addLine = () => send(
    (extra) => apiJson(`/api/admin/events/${event.id}/lines`, {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        package_id: form.package_id || null,
        menu_item_id: form.menu_item_id || null,
        recipe_id: form.recipe_id || null,
        quantity: Number(form.quantity),
        unit_price: form.unit_price === '' ? undefined : Number(form.unit_price),
        ...extra,
      }),
    }),
    'Line added'
  );

  const removeLine = (line) => send(
    (extra) => apiJson(`/api/admin/events/${event.id}/lines/${line.id}`, {
      method: 'DELETE',
      body: JSON.stringify(extra),
    }),
    'Line removed'
  );

  const updateLine = (line, patch) => send(
    (extra) => apiJson(`/api/admin/events/${event.id}/lines/${line.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...patch, ...extra }),
    }),
    'Line updated'
  );

  const saveCharges = () => send(
    (extra) => apiJson(`/api/admin/events/${event.id}/charges`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...charges,
        discount_amount: Number(charges.discount_amount || 0),
        tax_percent: Number(charges.tax_percent || 0),
        service_charge_percent: Number(charges.service_charge_percent || 0),
        ...extra,
      }),
    }),
    'Charges updated'
  );

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Quotation</h2>
          <p className="panel-sub">Prices are snapshots taken when each line is added.</p>
        </div>
        {!closed && (
          <button type="button" onClick={() => setForm({ ...EMPTY })} className="btn btn-secondary btn-sm">
            <Plus size={14} />Add line
          </button>
        )}
      </div>

      {locked && (
        <div className="note" style={{ border: 0, borderBottom: '1px solid var(--color-divider)' }}>
          <AlertTriangle size={16} />
          <p style={{ margin: 0 }}>
            This event is {event.status.replace('_', ' ').toLowerCase()}. Changing the quotation asks
            for a reason and is recorded.
          </p>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num" style={{ width: 88 }}>Qty</th>
              <th className="num" style={{ width: 120 }}>Unit</th>
              <th className="num" style={{ width: 120 }}>Amount</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <LineRow
                /* The server's figures are baked into the key, so a line that
                   comes back changed remounts with them instead of an effect
                   syncing prop into state behind the user's back. */
                key={`${l.id}:${l.quantity}:${l.unit_price}`}
                line={l}
                closed={closed}
                busy={busy}
                onCommit={(patch) => updateLine(l, patch)}
                onRemove={() => removeLine(l)}
              />
            ))}
          </tbody>
        </table>
        {!lines.length && (
          <p style={{ padding: '40px 16px', textAlign: 'center', fontSize: 13, color: 'var(--color-neutral-600)', margin: 0 }}>
            No lines yet. Add a package or a charge.
          </p>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '1px solid var(--color-divider)' }}>
        <div style={{ padding: 16, borderRight: '1px solid var(--color-divider)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-neutral-600)' }}>
            Charges
          </p>
          <label style={{ display: 'block' }}>
            <span className="field-label">Discount (Rs)</span>
            <input
              className="input" type="number" min="0" step="0.01" disabled={closed}
              value={charges.discount_amount}
              onChange={(e) => setCharges({ ...charges, discount_amount: e.target.value })}
            />
          </label>
          <label style={{ display: 'block' }}>
            <span className="field-label">Discount reason</span>
            <input
              className="input" disabled={closed} value={charges.discount_reason || ''}
              onChange={(e) => setCharges({ ...charges, discount_reason: e.target.value })}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ display: 'block' }}>
              <span className="field-label">Service charge %</span>
              <input
                className="input" type="number" min="0" step="0.1" disabled={closed}
                value={charges.service_charge_percent}
                onChange={(e) => setCharges({ ...charges, service_charge_percent: e.target.value })}
              />
            </label>
            <label style={{ display: 'block' }}>
              <span className="field-label">VAT %</span>
              <input
                className="input" type="number" min="0" step="0.1" disabled={closed}
                value={charges.tax_percent}
                onChange={(e) => setCharges({ ...charges, tax_percent: e.target.value })}
              />
            </label>
          </div>
          {!closed && (
            <button type="button" onClick={saveCharges} disabled={busy} className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}>
              Save charges
            </button>
          )}
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14 }}>
          <TotalRow label="Subtotal" value={money(event.subtotal)} />
          <TotalRow label="Discount" value={`− ${money(event.discount_amount)}`} />
          <TotalRow label={`Service charge (${Number(event.service_charge_percent || 0)}%)`} value={money(event.service_charge_amount)} />
          <TotalRow label={`VAT (${Number(event.tax_percent || 0)}%)`} value={money(event.tax_amount)} />
          <div
            style={{
              display: 'flex', justifyContent: 'space-between',
              borderTop: '1px solid var(--color-divider)', paddingTop: 8, marginTop: 2,
              fontWeight: 800, fontSize: 15,
            }}
          >
            <span>Total</span>
            <span className="num">{money(event.total_amount)}</span>
          </div>
        </div>
      </div>

      {form && (
        <AddLineDialog
          form={form} setForm={setForm} busy={busy} onAdd={addLine}
          packages={packages} menuItems={menuItems} recipes={recipes}
        />
      )}
    </section>
  );
}

/**
 * One quotation line. Its inputs are uncontrolled between commits: the row
 * holds the typed text locally and only PATCHes on blur or Enter, so a
 * half-typed "12" on the way to "120" never reaches the server.
 */
function LineRow({ line, closed, busy, onCommit, onRemove }) {
  // Seeded from the line and owned by the row until it commits. The parent
  // remounts this component whenever the server's figures move, so there is
  // nothing to re-sync.
  const [qty, setQty] = useState(String(Number(line.quantity)));
  const [unit, setUnit] = useState(String(Number(line.unit_price)));

  const commitQty = async () => {
    const next = Number(qty);
    if (!Number.isFinite(next) || next <= 0 || next === Number(line.quantity)) {
      setQty(String(Number(line.quantity)));
      return;
    }
    const ok = await onCommit({ quantity: next });
    if (!ok) setQty(String(Number(line.quantity)));
  };

  const commitUnit = async () => {
    const next = Number(unit);
    if (!Number.isFinite(next) || next < 0 || next === Number(line.unit_price)) {
      setUnit(String(Number(line.unit_price)));
      return;
    }
    const ok = await onCommit({ unit_price: next });
    if (!ok) setUnit(String(Number(line.unit_price)));
  };

  // Enter commits by blurring (the blur handler owns the PATCH); Escape puts
  // the stored figures back and gets out of the way.
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
    if (e.key === 'Escape') {
      setQty(String(Number(line.quantity)));
      setUnit(String(Number(line.unit_price)));
      e.currentTarget.blur();
    }
  };

  return (
    <tr>
      <td style={{ padding: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>
          {line.item_name}
          {line.is_complimentary === 1 && (
            <span className="tag-neutral" style={{ marginLeft: 8 }}>FREE</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>
          {LINE_TYPES.find(([v]) => v === line.line_type)?.[1] || line.line_type}
          {line.description ? ` · ${line.description}` : ''}
        </div>
        {line.price_overridden === 1 && (
          <div style={{ fontSize: 12, color: 'var(--color-due)' }}>
            Price overridden{line.list_price != null ? ` from ${money(line.list_price)}` : ''}
            {line.override_reason ? ` — “${line.override_reason}”` : ''}
            {line.overridden_by_name ? ` (${line.overridden_by_name})` : ''}
          </div>
        )}
      </td>
      <td style={{ padding: 8 }}>
        <input
          className="lineinput" type="number" min="0" step="1" disabled={closed || busy}
          value={qty} onChange={(e) => setQty(e.target.value)}
          onBlur={commitQty} onKeyDown={onKey}
          aria-label={`Quantity for ${line.item_name}`}
        />
      </td>
      <td style={{ padding: 8 }}>
        <input
          className="lineinput" type="number" min="0" step="0.01" disabled={closed || busy}
          value={unit} onChange={(e) => setUnit(e.target.value)}
          onBlur={commitUnit} onKeyDown={onKey}
          aria-label={`Unit price for ${line.item_name}`}
        />
      </td>
      <td className="num" style={{ padding: 8, fontWeight: 700 }}>{money(line.line_total)}</td>
      <td style={{ padding: 8, textAlign: 'center' }}>
        {!closed && (
          <button type="button" onClick={onRemove} disabled={busy} className="btn-square" title="Remove" aria-label={`Remove ${line.item_name}`}>
            <Trash2 size={14} />
          </button>
        )}
      </td>
    </tr>
  );
}

function AddLineDialog({ form, setForm, busy, onAdd, packages, menuItems, recipes }) {
  return (
    <div className="evx-backdrop">
      <div className="evx-dialog evx-dialog-wide" style={{ margin: '32px 0' }}>
        <div className="evx-dialog-head">
          <h2 style={{ margin: 0, fontSize: 18 }}>Add a quotation line</h2>
          <button type="button" onClick={() => setForm(null)} className="btn-square btn-square-lg" aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <div className="form-grid">
          <Field label="Line type" wide>
            <select value={form.line_type} onChange={(e) => setForm({ ...EMPTY, line_type: e.target.value })} className="input">
              {LINE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>

          {form.line_type === 'package' && (
            <Field label="Package" wide hint="Quantity is the number of guests taking this package">
              <select value={form.package_id} onChange={(e) => setForm({ ...form, package_id: e.target.value })} className="input">
                <option value="">Choose a package</option>
                {packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          )}

          {(form.line_type === 'menu_item' || form.line_type === 'beverage') && (
            <Field label="Menu item" wide>
              <select value={form.menu_item_id} onChange={(e) => setForm({ ...form, menu_item_id: e.target.value })} className="input">
                <option value="">Not linked (enter a name below)</option>
                {menuItems.map((m) => <option key={m.id} value={m.id}>{m.name} — {money(m.base_price)}</option>)}
              </select>
            </Field>
          )}

          {form.line_type === 'custom_food' && (
            <>
              <Field label="Recipe" hint="Links food cost to the BOM">
                <select value={form.recipe_id} onChange={(e) => setForm({ ...form, recipe_id: e.target.value })} className="input">
                  <option value="">No recipe</option>
                  {recipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </Field>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'end', paddingBottom: 8, fontSize: 14 }}>
                <input
                  type="checkbox" checked={form.consumes_inventory}
                  onChange={(e) => setForm({ ...form, consumes_inventory: e.target.checked })}
                  style={{ width: 16, height: 16 }}
                />
                Uses inventory
              </label>
            </>
          )}

          <Field label="Name" wide hint={form.line_type === 'package' ? 'Defaults to the package name' : undefined}>
            <input value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} className="input" />
          </Field>
          <Field label="Quantity">
            <input type="number" min="0.01" step="1" value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="input" />
          </Field>
          <Field label="Unit price" hint="Leave blank to use the standard price">
            <input type="number" min="0" step="0.01" value={form.unit_price}
              onChange={(e) => setForm({ ...form, unit_price: e.target.value })} className="input" />
          </Field>
          <Field label="Reason for a different price" wide hint="Required when charging other than the standard price">
            <input value={form.override_reason} onChange={(e) => setForm({ ...form, override_reason: e.target.value })} className="input" />
          </Field>
          <Field label="Description / note" wide>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input" />
          </Field>
        </div>

        <div className="evx-dialog-foot">
          <button type="button" onClick={() => setForm(null)} className="btn btn-secondary">Cancel</button>
          <button type="button" onClick={onAdd} disabled={busy} className="btn btn-primary">
            {busy ? 'Adding…' : 'Add line'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TotalRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: 'var(--color-neutral-600)' }}>{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}

function Field({ label, hint, wide, children }) {
  return (
    <label style={{ display: 'block' }} className={wide ? 'wide' : undefined}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

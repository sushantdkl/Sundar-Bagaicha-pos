'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Bike, Loader2 } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { friendlyFromError } from '@/lib/friendly-message';

const LABEL = { AVAILABLE: 'Available', BUSY: 'Busy', OFF_DUTY: 'Off duty' };
const TONE = {
  AVAILABLE: 'bg-emerald-50 text-emerald-700',
  BUSY: 'bg-amber-50 text-amber-700',
  OFF_DUTY: 'bg-gray-100 text-gray-600',
};

/**
 * Assign a delivery order to an executive.
 *
 * Attribution only — this writes one column on the order. The bill, the stock
 * and the revenue are untouched, so nothing here can change sales totals.
 *
 * The server owns the rules (off duty, already assigned, closed order); this
 * component's job is to surface the refusal and offer the deliberate override
 * rather than to re-implement the checks and risk disagreeing with them.
 */
export default function AssignDelivery({ order, onAssigned }) {
  const { addToast } = useToast();
  const { confirm } = useConfirm();
  const [executives, setExecutives] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await apiJson('/api/admin/delivery-executives');
      setExecutives(d.executives || []);
    } catch (e) {
      // A cashier without delivery_executives.view simply does not get the
      // picker; the order screen still works.
      setError(e?.status === 403 ? 'no-permission' : (e?.error || e?.message || 'Could not load executives.'));
      setExecutives([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const assign = async (executiveId, extra = {}) => {
    setBusy(true);
    try {
      await apiJson(`/api/admin/orders/${order.id}/delivery-executive`, {
        method: 'PATCH',
        body: JSON.stringify({ delivery_executive_id: executiveId || null, ...extra }),
      });
      addToast({ type: 'success', title: executiveId ? 'Delivery assigned.' : 'Assignment cleared.' });
      await onAssigned?.();
      await load();
    } catch (e) {
      // Both refusals are recoverable with an explicit confirmation.
      if (e?.code === 'off_duty') {
        const ok = await confirm({
          title: 'Assign an off-duty executive?',
          message: 'They are marked off duty. Assigning anyway is recorded on the order and does not put them back on duty.',
          tone: 'warning',
        });
        if (ok) { setBusy(false); return assign(executiveId, { ...extra, allow_off_duty: true }); }
      } else if (e?.code === 'already_assigned') {
        const ok = await confirm({
          title: 'Take this delivery from another executive?',
          message: 'This order is already assigned. Reassigning moves it, and frees the previous executive if they have nothing else.',
          tone: 'warning',
        });
        if (ok) { setBusy(false); return assign(executiveId, { ...extra, reassign: true }); }
      } else {
        addToast(friendlyFromError(e, 'save_failed'));
      }
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  if (error === 'no-permission') return null;

  const current = executives?.find((e) => Number(e.id) === Number(order.delivery_executive_id));
  const closed = ['completed', 'cancelled'].includes(String(order.status || '').toLowerCase());

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="mb-4 flex items-center gap-2">
        <Bike className="h-5 w-5 text-orange-600" />
        <h3 className="text-lg font-bold text-gray-900">Delivery executive</h3>
      </div>

      {executives === null ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />Loading…
        </div>
      ) : (
        <div className="space-y-3">
          {current ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                <Link
                  href={`/admin/delivery-executives/${current.id}`}
                  className="font-medium text-gray-900 hover:underline"
                >
                  {current.name}
                </Link>
                <div className="text-sm text-gray-500">{current.phone}</div>
              </div>
              <span className={`px-2 py-1 text-xs font-semibold ${TONE[current.status] || TONE.OFF_DUTY}`}>
                {LABEL[current.status] || current.status}
              </span>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Not assigned yet.</p>
          )}

          {!closed && (
            <>
              <select
                disabled={busy}
                value={order.delivery_executive_id || ''}
                onChange={(e) => assign(e.target.value || null)}
                className="h-10 w-full border border-gray-300 bg-white px-3 text-sm text-gray-900 disabled:opacity-50"
                aria-label="Assign delivery executive"
              >
                <option value="">Unassigned</option>
                {executives.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} — {LABEL[e.status] || e.status}
                    {e.active_deliveries ? ` (${e.active_deliveries} on the road)` : ''}
                  </option>
                ))}
              </select>
              {!executives.length && (
                <p className="text-xs text-gray-500">
                  No executives yet.{' '}
                  <Link href="/admin/delivery-executives" className="font-medium text-gray-900 underline">
                    Add one
                  </Link>
                  .
                </p>
              )}
            </>
          )}

          {closed && !current && (
            <p className="text-xs text-gray-500">This order is closed and was never assigned.</p>
          )}
        </div>
      )}
    </div>
  );
}

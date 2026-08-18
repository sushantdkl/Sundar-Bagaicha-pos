'use client';

/**
 * Read-only recent wastage list, shared by the waiter and cashier stations so
 * they can view what has been logged without reaching the admin analytics page.
 * `request(url, options)` is the caller's fetch wrapper (same contract as
 * WastageModal), so it works with whatever auth each station already holds.
 */

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { WASTAGE_REASON_LABELS } from '@/components/inventory/wastage-modal';
import { formatNepalDate } from '@/lib/time-utils';

const reasonLabel = (r) => WASTAGE_REASON_LABELS[r] || String(r || 'other').replace(/_/g, ' ');

export default function WastageHistoryModal({ request, onClose }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await request('/api/admin/wastage?page_size=30&sort=created_at&dir=desc');
        const data = await res.json();
        setEntries(data.entries || []);
      } catch {
        /* leave empty */
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent onClose={onClose} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Recent wastage</DialogTitle>
        </DialogHeader>
        <div className="mt-3 max-h-[60vh] overflow-y-auto">
          {loading ? (
            <p className="py-8 text-center text-sm text-gray-500">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">Nothing logged yet.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {entries.map((e) => (
                <div key={e.id} className="flex items-center gap-3 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">{e.raw_material_name || e.recipe_name || 'Unknown item'}</p>
                    <p className="text-xs text-gray-500">
                      {Number(e.quantity)} {e.unit || ''} · {reasonLabel(e.reason)}
                      {e.employee_name ? ` · ${e.employee_name}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-900">Rs {Number(e.total_cost || 0).toFixed(2)}</p>
                    <p className="text-xs text-gray-400">{formatNepalDate(e.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

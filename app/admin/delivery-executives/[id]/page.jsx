'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import AdminLayout from '@/components/admin/admin-layout';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { apiJson } from '@/lib/authed-fetch';
import { formatCurrency } from '@/lib/currency';

const STATUS_LABEL = { AVAILABLE: 'Available', BUSY: 'Busy', OFF_DUTY: 'Off duty' };
const STATUS_TONE = {
  AVAILABLE: 'bg-emerald-50 text-emerald-700',
  BUSY: 'bg-amber-50 text-amber-700',
  OFF_DUTY: 'bg-gray-100 text-gray-600',
};
const ORDER_TONE = {
  completed: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-red-50 text-red-700',
};

const INPUT = 'h-10 w-full border border-gray-300 bg-white px-3 text-sm text-gray-900';

/**
 * One executive: who they are, what they are carrying now, and what they have
 * delivered. Every figure is read from the existing orders and bills, so this
 * page attributes sales rather than adding any.
 */
export default function DeliveryExecutiveDetailPage() {
  const { id } = useParams();
  const { addToast } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ from: '', to: '', status: '' });

  const load = useCallback(async () => {
    try {
      setError(null);
      const params = new URLSearchParams();
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      if (filters.status) params.set('status', filters.status);
      const qs = params.toString();
      setData(await apiJson(`/api/admin/delivery-executives/${id}${qs ? `?${qs}` : ''}`));
    } catch (e) {
      setError(e?.error || e?.message || 'Request failed.');
    } finally {
      setLoading(false);
    }
  }, [id, filters]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <AdminLayout>
        <main className="flex min-h-[50vh] items-center justify-center bg-gray-50">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </main>
      </AdminLayout>
    );
  }

  if (error) {
    return (
      <AdminLayout>
        <main className="bg-gray-50 p-8">
          <Link href="/admin/delivery-executives" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
            <ArrowLeft className="h-4 w-4" />Delivery Executives
          </Link>
          <div className="mt-4 border border-red-200 bg-red-50 p-6 text-sm text-red-800">
            <p className="font-semibold">Could not load this executive.</p>
            <p className="mt-1">{error}</p>
          </div>
        </main>
      </AdminLayout>
    );
  }

  const { executive, deliveries = [], summary = {} } = data || {};
  void addToast;

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <Link href="/admin/delivery-executives" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" />Delivery Executives
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{executive.name}</h1>
              <span className={`px-2 py-1 text-xs font-semibold ${STATUS_TONE[executive.status] || STATUS_TONE.OFF_DUTY}`}>
                {STATUS_LABEL[executive.status] || executive.status}
              </span>
              {!executive.is_active && (
                <span className="bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-600">Deactivated</span>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-600">
              {executive.phone}
              {executive.email ? ` · ${executive.email}` : ''}
              {executive.user_full_name ? ` · staff: ${executive.user_full_name}` : ''}
            </p>
          </div>
        </div>
      </header>

      <main className="space-y-5 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Currently carrying" value={summary.active_deliveries ?? 0} sub="Assigned and not yet closed" />
          <Metric label="Completed deliveries" value={summary.completed_deliveries ?? 0} sub="In the selected range" />
          <Metric label="Cancelled" value={summary.cancelled_deliveries ?? 0} sub="Not counted as delivered" />
          <Metric
            label="Delivered sales"
            value={formatCurrency(summary.delivered_amount || 0)}
            sub="Already counted once in the Sales Report"
            tone="text-emerald-700"
          />
        </section>

        <section className="border border-gray-200 bg-white">
          <div className="grid gap-3 border-b border-gray-200 p-4 md:grid-cols-4">
            <label className="text-xs font-medium text-gray-600">
              From
              <input
                type="date" value={filters.from} className={`${INPUT} mt-1`}
                onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
              />
            </label>
            <label className="text-xs font-medium text-gray-600">
              To
              <input
                type="date" value={filters.to} className={`${INPUT} mt-1`}
                onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
              />
            </label>
            <label className="text-xs font-medium text-gray-600">
              Status
              <select
                value={filters.status} className={`${INPUT} mt-1`}
                onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
              >
                <option value="">All deliveries</option>
                <option value="active">Currently carrying</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
          </div>

          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <h2 className="text-sm font-bold text-gray-900">Delivery history</h2>
            <span className="text-xs text-gray-500">{deliveries.length} orders</span>
          </div>

          {!deliveries.length ? (
            <div className="px-6 py-14 text-center">
              <p className="text-sm font-semibold text-gray-900">No deliveries in this view</p>
              <p className="mt-1 text-sm text-gray-500">
                Assign a delivery order to {executive.name} and it will appear here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Order</th>
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Customer</th>
                    <th className="px-4 py-3 text-right font-semibold">Amount</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {deliveries.map((d) => (
                    <tr key={d.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link href={`/admin/orders/${d.id}`} className="font-semibold text-gray-900 hover:underline">
                          {d.order_number}
                        </Link>
                        {d.bill_number && <div className="text-xs text-gray-500">{d.bill_number}</div>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                        {String(d.created_at || '').slice(0, 10)}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {d.customer_name || <span className="text-gray-400">Walk-in</span>}
                        {d.delivery_address && (
                          <div className="max-w-xs truncate text-xs text-gray-500">{d.delivery_address}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        {d.grand_total != null ? formatCurrency(d.grand_total) : <span className="text-gray-400">Not billed</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block whitespace-nowrap px-2 py-1 text-xs font-semibold ${
                          ORDER_TONE[String(d.status || '').toLowerCase()] || 'bg-sky-50 text-sky-700'
                        }`}>
                          {String(d.status || '').replace(/_/g, ' ')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </AdminLayout>
  );
}

function Metric({ label, value, sub, tone = 'text-gray-950' }) {
  return (
    <div className="border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${tone}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

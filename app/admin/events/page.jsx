'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AdminLayout from '@/components/admin/admin-layout';
import { CalendarRange, Plus, RefreshCw, Search, Users } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';
import { nepalDateString } from '@/lib/report-dates';
import { useToast } from '@/components/ui/toast';
import { EVENT_STATUSES, STATUS_TONE, money, dateLabel, timeRange, guestLabel , errText} from './event-ui';

export default function EventsPage() {
  const { addToast } = useToast();
  const [dash, setDash] = useState(null);
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState({ search: '', status: 'all', range: 'upcoming', page: 1, pageSize: 25 });

  const query = useMemo(() => {
    const today = nepalDateString();
    const p = new URLSearchParams({ status: filter.status, page: String(filter.page), page_size: String(filter.pageSize) });
    if (filter.search.trim()) p.set('search', filter.search.trim());
    if (filter.range === 'upcoming') p.set('from', today);
    if (filter.range === 'past') p.set('to', today);
    return p.toString();
  }, [filter]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [d, l] = await Promise.all([
        apiJson('/api/admin/events/dashboard'),
        apiJson(`/api/admin/events?${query}`),
      ]);
      setDash(d);
      setList(l);
    } catch (e) {
      addToast({ type: 'error', title: 'Could not load events', description: errText(e) });
    } finally {
      setBusy(false);
    }
  }, [query, addToast]);

  useEffect(() => { load(); }, [load]);

  const rows = list?.rows || [];

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-fuchsia-700">Events & Banquets</p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900">Events Dashboard</h1>
            <p className="mt-1 max-w-3xl text-sm text-gray-500">
              Bookings, guest numbers and committed value. Booking an event never touches stock —
              inventory moves only when production is released.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={load} className={BTN}>
              <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Refresh
            </button>
            <Link href="/admin/events/calendar" className={BTN}><CalendarRange className="h-4 w-4" />Calendar</Link>
            <Link href="/admin/events/new" className={PRIMARY}><Plus className="h-4 w-4" />New Event</Link>
          </div>
        </div>
      </header>

      <main className="space-y-5 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Events today" value={dash?.events_today ?? '—'} sub={`${dash?.guests_today ?? 0} guests expected`} />
          <Metric label="Upcoming events" value={dash?.upcoming_events ?? '—'} sub="Confirmed and beyond" />
          <Metric label="This month" value={dash?.events_this_month ?? '—'} sub="Excluding cancelled" />
          <Metric label="Expected guests" value={dash?.expected_guests ?? '—'} sub="Across committed events" />
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Confirmed event value" value={money(dash?.confirmed_value)} sub="Not yet recognised as sales" tone="text-indigo-700" />
          <Metric label="Deposits received" value={money(dash?.deposits_received)} sub="Held as customer advances" tone="text-emerald-700" />
          <Metric label="Outstanding balance" value={money(dash?.outstanding_balance)} sub="Across committed events" tone="text-amber-700" />
          <Metric label="Completed revenue" value={money(dash?.completed_revenue)} sub={`${dash?.completed_events ?? 0} completed events`} tone="text-gray-900" />
        </section>

        <section className="border border-gray-200 bg-white">
          <div className="border-b border-gray-200 p-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <input
                  value={filter.search}
                  onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value, page: 1 }))}
                  placeholder="Search number, title, client, phone"
                  className={`${INPUT} pl-9`}
                />
              </label>
              <Select
                label="Status" value={filter.status}
                set={(v) => setFilter((f) => ({ ...f, status: v, page: 1 }))}
                options={[['all', 'All statuses'], ...EVENT_STATUSES.map((s) => [s, s.replace('_', ' ')])]}
              />
              <Select
                label="When" value={filter.range}
                set={(v) => setFilter((f) => ({ ...f, range: v, page: 1 }))}
                options={[['upcoming', 'Today and upcoming'], ['past', 'Past'], ['all', 'All dates']]}
              />
            </div>
          </div>

          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <div>
              <h2 className="text-sm font-bold text-gray-900">Bookings</h2>
              <p className="text-xs text-gray-500">{list?.pagination?.total ?? 0} events</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  {['Event', 'Date & time', 'Space', 'Client', 'Guests', 'Status', 'Payment', 'Total'].map((h) => (
                    <th key={h} className="px-4 py-3 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link href={`/admin/events/${r.id}`} className="font-semibold text-gray-900 hover:underline">
                        {r.event_number}
                      </Link>
                      <p className="text-xs text-gray-500">{r.title || r.event_type}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {dateLabel(r.event_date)}
                      <p className="text-xs text-gray-500">{timeRange(r) || 'Time not set'}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{r.space_name || <span className="text-gray-400">Not assigned</span>}</td>
                    <td className="px-4 py-3">
                      {r.customer_name || r.contact_name || <span className="text-gray-400">—</span>}
                      {r.contact_phone && <p className="text-xs text-gray-500">{r.contact_phone}</p>}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-gray-700">{guestLabel(r)}</td>
                    <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                    <td className="px-4 py-3"><span className="text-xs font-medium text-gray-600">{r.payment_status.replace('_', ' ')}</span></td>
                    <td className="px-4 py-3 font-semibold tabular-nums">{money(r.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!busy && !rows.length && (
              <div className="py-16 text-center">
                <Users className="mx-auto h-8 w-8 text-gray-300" />
                <p className="mt-3 text-sm text-gray-500">No events match these filters.</p>
                <Link href="/admin/events/new" className="mt-4 inline-flex text-sm font-semibold text-gray-900 underline">
                  Create the first event
                </Link>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 text-sm text-gray-600">
            <span>Page {list?.pagination?.page || 1} of {list?.pagination?.pages || 1}</span>
            <div className="flex gap-2">
              <button disabled={filter.page <= 1} onClick={() => setFilter((f) => ({ ...f, page: f.page - 1 }))} className={PAGE}>Previous</button>
              <button disabled={filter.page >= (list?.pagination?.pages || 1)} onClick={() => setFilter((f) => ({ ...f, page: f.page + 1 }))} className={PAGE}>Next</button>
            </div>
          </div>
        </section>
      </main>
    </AdminLayout>
  );
}

export function StatusPill({ status }) {
  return (
    <span className={`inline-block whitespace-nowrap px-2 py-1 text-xs font-semibold ${STATUS_TONE[status] || 'bg-gray-100 text-gray-600'}`}>
      {String(status || '').replace('_', ' ')}
    </span>
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

function Select({ label, value, set, options }) {
  return (
    <label className="text-xs font-medium text-gray-600">
      {label}
      <select value={value} onChange={(e) => set(e.target.value)} className={`${INPUT} mt-1`}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

const BTN = 'inline-flex h-10 items-center justify-center gap-2 border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';
const PRIMARY = 'inline-flex h-10 items-center justify-center gap-2 border border-gray-950 bg-gray-950 px-4 text-sm font-semibold text-white hover:bg-black disabled:opacity-50 [color:#fff!important]';
const INPUT = 'h-10 w-full border border-gray-300 bg-white px-3 text-sm text-gray-900';
const PAGE = 'border border-gray-300 px-3 py-1.5 disabled:opacity-40';

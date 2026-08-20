'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AdminLayout from '@/components/admin/admin-layout';
import { ChevronLeft, ChevronRight, Plus, RefreshCw } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';
import { nepalDateString } from '@/lib/report-dates';
import { useToast } from '@/components/ui/toast';
import { STATUS_TONE, clockLabel, dateLabel, guestLabel, errText, useEventsBasePath } from '../event-ui';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Month grid built from plain date arithmetic on Nepal wall-clock dates.
 * Event dates are stored as YYYY-MM-DD with no zone, so no UTC conversion
 * happens anywhere here — that is what keeps a 10pm event on the right day.
 */
function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  const startOffset = first.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(ymd(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function EventsCalendarPage() {
  const eventsBase = useEventsBasePath();
  const { addToast } = useToast();
  const today = nepalDateString();
  const [cursor, setCursor] = useState(() => {
    const [y, m] = today.split('-').map(Number);
    return { year: y, month: m - 1 };
  });
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [spaceFilter, setSpaceFilter] = useState('all');
  const [selected, setSelected] = useState(null);

  const cells = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const range = useMemo(() => {
    const days = cells.filter(Boolean);
    return { from: days[0], to: days[days.length - 1] };
  }, [cells]);

  const load = useCallback(async () => {
    if (!range.from || !range.to) return;
    setBusy(true);
    try {
      setData(await apiJson(`/api/admin/events/calendar?from=${range.from}&to=${range.to}`));
    } catch (e) {
      addToast({ type: 'error', title: 'Could not load the calendar', description: errText(e) });
    } finally {
      setBusy(false);
    }
  }, [range.from, range.to, addToast]);

  useEffect(() => { load(); }, [load]);

  const byDate = useMemo(() => {
    const map = {};
    for (const e of data?.events || []) {
      if (spaceFilter !== 'all' && String(e.space_id || '') !== spaceFilter) continue;
      // A multi-day booking appears on every day it spans.
      const start = e.event_date.slice(0, 10);
      const end = (e.end_date || e.event_date).slice(0, 10);
      for (const day of cells.filter(Boolean)) {
        if (day >= start && day <= end) (map[day] ||= []).push(e);
      }
    }
    return map;
  }, [data, cells, spaceFilter]);

  const monthName = new Date(Date.UTC(cursor.year, cursor.month, 1))
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const shift = (delta) => setCursor(({ year, month }) => {
    const m = month + delta;
    return { year: year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
  });

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-fuchsia-700">Events & Banquets</p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900">Booking Calendar</h1>
            <p className="mt-1 text-sm text-gray-500">Bookings by date, time, space and status. Cancelled events are hidden.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={load} className={BTN}><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Refresh</button>
            <Link href={eventsBase} className={BTN}>List view</Link>
            <Link href={`${eventsBase}/new`} className={PRIMARY}><Plus className="h-4 w-4" />New Event</Link>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <button onClick={() => shift(-1)} className={ICON} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
            <span className="min-w-44 text-center text-sm font-bold text-gray-900">{monthName}</span>
            <button onClick={() => shift(1)} className={ICON} aria-label="Next month"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <button
            onClick={() => { const [y, m] = today.split('-').map(Number); setCursor({ year: y, month: m - 1 }); }}
            className={BTN}
          >Today</button>
          <label className="text-xs font-medium text-gray-600">
            Space
            <select value={spaceFilter} onChange={(e) => setSpaceFilter(e.target.value)} className="ml-2 h-9 border border-gray-300 px-2 text-sm">
              <option value="all">All spaces</option>
              {(data?.spaces || []).map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
            </select>
          </label>
        </div>
      </header>

      <main className="bg-gray-50 p-4 sm:p-6 lg:p-8">
        {/* Desktop month grid */}
        <div className="hidden overflow-hidden border border-gray-200 bg-white sm:block">
          <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-2 py-2 text-center text-xs font-semibold uppercase text-gray-500">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((day, i) => (
              <div
                key={day || `pad-${i}`}
                className={`min-h-28 border-b border-r border-gray-100 p-1.5 ${day === today ? 'bg-amber-50' : ''} ${!day ? 'bg-gray-50/60' : ''}`}
              >
                {day && (
                  <>
                    <div className="mb-1 flex items-center justify-between">
                      <span className={`text-xs font-semibold ${day === today ? 'text-amber-800' : 'text-gray-500'}`}>
                        {Number(day.slice(-2))}
                      </span>
                      {(byDate[day]?.length || 0) > 0 && (
                        <span className="text-[10px] font-medium text-gray-400">{byDate[day].length}</span>
                      )}
                    </div>
                    <div className="space-y-1">
                      {(byDate[day] || []).slice(0, 3).map((e) => (
                        <button
                          key={`${day}-${e.id}`}
                          onClick={() => setSelected(e)}
                          className={`block w-full truncate px-1.5 py-1 text-left text-[11px] font-medium ${STATUS_TONE[e.status] || 'bg-gray-100 text-gray-700'}`}
                          title={`${e.event_number} · ${e.title || e.event_type}`}
                        >
                          {e.start_time ? `${clockLabel(e.start_time)} ` : ''}{e.title || e.event_type}
                        </button>
                      ))}
                      {(byDate[day]?.length || 0) > 3 && (
                        <span className="block px-1.5 text-[10px] text-gray-500">+{byDate[day].length - 3} more</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Mobile agenda — a 7-column grid is unusable on a phone */}
        <div className="space-y-3 sm:hidden">
          {cells.filter((d) => d && (byDate[d]?.length || 0) > 0).map((day) => (
            <section key={day} className="border border-gray-200 bg-white">
              <h2 className={`border-b border-gray-200 px-3 py-2 text-sm font-bold ${day === today ? 'bg-amber-50 text-amber-900' : 'text-gray-900'}`}>
                {dateLabel(day)}
              </h2>
              <ul className="divide-y divide-gray-100">
                {(byDate[day] || []).map((e) => (
                  <li key={`${day}-${e.id}`}>
                    <button onClick={() => setSelected(e)} className="flex w-full items-start justify-between gap-2 px-3 py-2.5 text-left">
                      <span>
                        <span className="text-sm font-semibold text-gray-900">{e.title || e.event_type}</span>
                        <span className="block text-xs text-gray-500">
                          {clockLabel(e.start_time) || 'Time not set'}{e.space_name ? ` · ${e.space_name}` : ''}
                        </span>
                      </span>
                      <span className={`shrink-0 px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_TONE[e.status]}`}>
                        {e.status.replace('_', ' ')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {!cells.some((d) => d && byDate[d]?.length) && (
            <p className="py-16 text-center text-sm text-gray-500">No events this month.</p>
          )}
        </div>

        {!busy && !(data?.events || []).length && (
          <p className="hidden py-10 text-center text-sm text-gray-500 sm:block">No events in {monthName}.</p>
        )}
      </main>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelected(null)}>
          <div className="w-full max-w-md border border-gray-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-gray-200 px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-bold text-gray-900">{selected.event_number}</h2>
                <span className={`px-2 py-1 text-xs font-semibold ${STATUS_TONE[selected.status]}`}>
                  {selected.status.replace('_', ' ')}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-600">{selected.title || selected.event_type}</p>
            </div>
            <dl className="divide-y divide-gray-100 text-sm">
              <Row label="Date" value={dateLabel(selected.event_date)} />
              <Row label="Time" value={[clockLabel(selected.start_time), clockLabel(selected.end_time)].filter(Boolean).join(' – ') || 'Not set'} />
              <Row label="Space" value={selected.space_name || 'Not assigned'} />
              <Row label="Client" value={selected.customer_name || '—'} />
              <Row label="Guests" value={guestLabel(selected)} />
            </dl>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
              <button onClick={() => setSelected(null)} className={BTN}>Close</button>
              <Link href={`${eventsBase}/${selected.id}`} className={PRIMARY}>Open event</Link>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4 px-5 py-2.5">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right font-medium text-gray-900">{value}</dd>
    </div>
  );
}

const BTN = 'inline-flex h-10 items-center justify-center gap-2 border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50';
const PRIMARY = 'inline-flex h-10 items-center justify-center gap-2 border border-gray-950 bg-gray-950 px-4 text-sm font-semibold text-white hover:bg-black [color:#fff!important]';
const ICON = 'inline-flex h-9 w-9 items-center justify-center border border-gray-300 text-gray-600 hover:bg-gray-50';

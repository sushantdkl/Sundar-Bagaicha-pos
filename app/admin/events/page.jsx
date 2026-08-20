'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AdminLayout from '@/components/admin/admin-layout';
import { CalendarRange, Plus, RefreshCw, Search, TrendingUp, Users } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';
import { nepalDateString } from '@/lib/report-dates';
import { useToast } from '@/components/ui/toast';
import {
  EVENT_STATUSES, money, moneyShort, dateLabel, timeRange, guestLabel,
  errText, pillClass, statusText, useEventsBasePath,
} from './event-ui';

/**
 * Events dashboard — Modernist layout from the Claude Design redesign.
 *
 * The eight KPIs are one ruled block rather than eight cards: the grid's own
 * 2px gaps show the divider colour through, which is the system's way of
 * grouping figures that are read together.
 */
export default function EventsPage() {
  const router = useRouter();
  const eventsBase = useEventsBasePath();
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
  const pages = list?.pagination?.pages || 1;

  return (
    <AdminLayout>
      <div className="evx">
        <header
          className="headpad"
          style={{
            borderBottom: '1px solid var(--color-divider)',
            background: 'var(--color-bg)',
            display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start',
            justifyContent: 'space-between', gap: 16,
          }}
        >
          <div>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--color-accent-700)' }}>
              Events &amp; Banquets
            </p>
            <h1 style={{ fontSize: 30, margin: '6px 0' }}>Events Dashboard</h1>
            <p style={{ margin: 0, maxWidth: 640, fontSize: 13, color: 'var(--color-neutral-700)' }}>
              Bookings, guest numbers and committed value. Booking an event never touches stock —
              inventory moves only when production is released.
            </p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" onClick={load} disabled={busy} className="btn btn-secondary">
              <RefreshCw size={15} className={busy ? 'animate-spin' : undefined} />Refresh
            </button>
            <Link href={`${eventsBase}/calendar`} className="btn btn-secondary"><CalendarRange size={15} />Calendar</Link>
            <Link href={`${eventsBase}/reports`} className="btn btn-secondary"><TrendingUp size={15} />Reports</Link>
            <Link href={`${eventsBase}/new`} className="btn btn-primary"><Plus size={15} />New Event</Link>
          </div>
        </header>

        <main className="pad" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <section className="kpi-grid">
            <Kpi label="Events today" value={dash?.events_today ?? '—'} sub={`${dash?.guests_today ?? 0} guests expected`} />
            <Kpi label="Upcoming events" value={dash?.upcoming_events ?? '—'} sub="Confirmed and beyond" />
            <Kpi label="This month" value={dash?.events_this_month ?? '—'} sub="Excluding cancelled" />
            <Kpi label="Expected guests" value={dash?.expected_guests ?? '—'} sub="Across committed events" />
            <Kpi label="Confirmed event value" value={moneyShort(dash?.confirmed_value)} sub="Not yet recognised as sales" tone="committed" />
            <Kpi label="Deposits received" value={moneyShort(dash?.deposits_received)} sub="Held as customer advances" tone="received" />
            <Kpi label="Outstanding balance" value={moneyShort(dash?.outstanding_balance)} sub="Across committed events" tone="due" />
            <Kpi label="Completed revenue" value={moneyShort(dash?.completed_revenue)} sub={`${dash?.completed_events ?? 0} completed events`} />
          </section>

          <section className="panel">
            <div className="filter-grid" style={{ padding: 16, borderBottom: '1px solid var(--color-divider)' }}>
              <label style={{ position: 'relative', display: 'block' }}>
                <span className="field-label">Search</span>
                <Search size={16} style={{ position: 'absolute', left: 10, top: 33, color: 'var(--color-neutral-500)' }} />
                <input
                  className="input"
                  style={{ paddingLeft: 34 }}
                  value={filter.search}
                  onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value, page: 1 }))}
                  placeholder="Number, title, client, phone"
                />
              </label>
              <Select
                label="Status" value={filter.status}
                set={(v) => setFilter((f) => ({ ...f, status: v, page: 1 }))}
                options={[['all', 'All statuses'], ...EVENT_STATUSES.map((s) => [s, statusText(s)])]}
              />
              <Select
                label="When" value={filter.range}
                set={(v) => setFilter((f) => ({ ...f, range: v, page: 1 }))}
                options={[['upcoming', 'Today and upcoming'], ['past', 'Past'], ['all', 'All dates']]}
              />
            </div>

            <div className="panel-head" style={{ alignItems: 'baseline' }}>
              <div>
                <h2 className="panel-title">Bookings</h2>
                <p className="panel-sub">{list?.pagination?.total ?? 0} events</p>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Date &amp; time</th>
                    <th>Space</th>
                    <th>Client</th>
                    <th className="num">Guests</th>
                    <th>Status</th>
                    <th>Payment</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const detailHref = `${eventsBase}/${r.id}`;
                    return (
                    <tr
                      key={r.id}
                      className="event-list-row"
                      onClick={(event) => {
                        const interactive = event.target.closest('a, button, input, select, textarea, [role="button"]');
                        if (!interactive) router.push(detailHref);
                      }}
                    >
                      <td style={{ padding: '12px 8px' }}>
                        <Link
                          href={detailHref}
                          className="rowlink"
                        >
                          {r.event_number}
                        </Link>
                        <div style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>{r.title || r.event_type}</div>
                      </td>
                      <td style={{ padding: '12px 8px', whiteSpace: 'nowrap' }}>
                        {dateLabel(r.event_date)}
                        <div style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>{timeRange(r) || 'Time not set'}</div>
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        {r.space_name || <span style={{ color: 'var(--color-neutral-500)' }}>Not assigned</span>}
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        {r.customer_name || r.contact_name || <span style={{ color: 'var(--color-neutral-500)' }}>—</span>}
                        {r.contact_phone && (
                          <div style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>{r.contact_phone}</div>
                        )}
                      </td>
                      <td className="num" style={{ padding: '12px 8px' }}>{guestLabel(r)}</td>
                      <td style={{ padding: '12px 8px' }}>
                        <span className={pillClass(r.status)}>{statusText(r.status)}</span>
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        <span className={pillClass(r.payment_status)}>{statusText(r.payment_status)}</span>
                      </td>
                      <td className="num" style={{ padding: '12px 8px', fontWeight: 700 }}>{money(r.total_amount)}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>

              {!busy && !rows.length && (
                <div style={{ padding: '64px 16px', textAlign: 'center' }}>
                  <Users size={32} style={{ margin: '0 auto', color: 'var(--color-neutral-400)' }} />
                  <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--color-neutral-600)' }}>
                    No events match these filters.
                  </p>
                  <Link href={`${eventsBase}/new`} className="btn btn-secondary" style={{ marginTop: 16 }}>
                    Create the first event
                  </Link>
                </div>
              )}
            </div>

            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 16px', borderTop: '1px solid var(--color-divider)',
                fontSize: 13, color: 'var(--color-neutral-700)',
              }}
            >
              <span>Page {list?.pagination?.page || 1} of {pages}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button" className="btn btn-secondary btn-sm" disabled={filter.page <= 1}
                  onClick={() => setFilter((f) => ({ ...f, page: f.page - 1 }))}
                >
                  Previous
                </button>
                <button
                  type="button" className="btn btn-secondary btn-sm" disabled={filter.page >= pages}
                  onClick={() => setFilter((f) => ({ ...f, page: f.page + 1 }))}
                >
                  Next
                </button>
              </div>
            </div>
          </section>
        </main>
      </div>
    </AdminLayout>
  );
}

/** tone: committed | received | due — the money colours from event-ui's palette. */
function Kpi({ label, value, sub, tone }) {
  return (
    <div className="kpi-cell">
      <p className="kpi-label">{label}</p>
      <p className="kpi-value" style={tone ? { color: `var(--color-${tone})` } : undefined}>{value}</p>
      {sub && <p className="kpi-sub">{sub}</p>}
    </div>
  );
}

function Select({ label, value, set, options }) {
  return (
    <label style={{ display: 'block' }}>
      <span className="field-label">{label}</span>
      <select className="input" value={value} onChange={(e) => set(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

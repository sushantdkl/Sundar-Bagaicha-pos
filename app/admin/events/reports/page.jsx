'use client';

/**
 * Consolidated reporting.
 *
 * The three figures on this screen are deliberately kept apart, because
 * conflating them is how a banquet business ends up reporting money it has not
 * earned:
 *
 *   sales      restaurant bills + event revenue recognised at settlement
 *   committed  quotations for events that have not happened yet
 *   deposits   advances held — a liability, owed back until the event runs
 *
 * Only the first is revenue. The other two are shown beside it, labelled.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AdminLayout from '@/components/admin/admin-layout';
import { ArrowLeft, RefreshCw, TrendingUp, Wallet, PieChart } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';
import { useToast } from '@/components/ui/toast';
import { money, dateLabel, errText } from '../event-ui';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' });
const monthStart = () => `${today().slice(0, 7)}-01`;

function Stat({ label, value, hint, tone = 'text-gray-900' }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${tone}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-gray-500">{hint}</div> : null}
    </div>
  );
}

function Section({ icon: Icon, title, note, children }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <header className="flex items-start gap-3 border-b border-gray-100 px-4 py-3">
        <Icon className="mt-0.5 h-4 w-4 text-gray-500" />
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          {note ? <p className="mt-0.5 text-xs text-gray-500">{note}</p> : null}
        </div>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export default function EventReportsPage() {
  const { addToast } = useToast();
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (start, end) => {
    setBusy(true);
    try {
      const d = await apiJson(`/api/admin/events/reports?report=all&from=${start}&to=${end}`);
      setData(d);
    } catch (e) {
      addToast({ type: 'error', title: 'Could not build the report', description: errText(e) });
    } finally {
      setBusy(false);
    }
  }, [addToast]);

  useEffect(() => { load(monthStart(), today()); }, [load]);

  const ch = data?.channels;
  const ev = data?.events;
  const pf = data?.profitability;

  return (
    <AdminLayout>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link href="/admin/events" className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Event reporting</h1>
              <p className="text-xs text-gray-500">
                Restaurant and event sales side by side. Existing restaurant reports remain the source of truth.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-gray-600">
              From
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                className="ml-2 rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
            </label>
            <label className="text-xs text-gray-600">
              To
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                className="ml-2 rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
            </label>
            <button type="button" onClick={() => load(from, to)} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
              Run
            </button>
          </div>
        </div>

        <Section
          icon={TrendingUp}
          title="Sales by channel"
          note={ch?.note}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Restaurant sales" value={money(ch?.restaurant_sales)}
              hint={`${ch?.restaurant_bills ?? 0} paid bills`} />
            <Stat label="Event sales" value={money(ch?.event_sales)}
              hint={`${ch?.events_settled ?? 0} events settled`} />
            <Stat label="Total sales" value={money(ch?.total_sales)} tone="text-emerald-700"
              hint="Restaurant + events, counted once" />
          </div>
        </Section>

        <Section
          icon={Wallet}
          title="Events"
          note="Committed value and deposits held are shown apart from sales — neither is earned revenue."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Events in range" value={ev?.events ?? 0}
              hint={`${ev?.completed_events ?? 0} completed · ${ev?.cancelled_events ?? 0} cancelled`} />
            <Stat label="Revenue per event" value={money(ev?.revenue_per_event)}
              hint={`${money(ev?.average_spend_per_guest)} per guest`} />
            <Stat label="Committed, not yet earned" value={money(ev?.upcoming_committed?.value)} tone="text-amber-700"
              hint={`${ev?.upcoming_committed?.events ?? 0} upcoming events`} />
            <Stat label="Deposits held" value={money(ev?.deposits_held)} tone="text-sky-700"
              hint="A liability until the event runs" />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Package mix</h3>
              {ev?.package_mix?.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-gray-500">
                      <tr><th className="py-1">Package</th><th className="py-1 text-right">Sold</th>
                        <th className="py-1 text-right">Guests</th><th className="py-1 text-right">Value</th></tr>
                    </thead>
                    <tbody>
                      {ev.package_mix.map((m) => (
                        <tr key={m.package} className="border-t border-gray-100">
                          <td className="py-1.5">{m.package}</td>
                          <td className="py-1.5 text-right">{m.times_sold}</td>
                          <td className="py-1.5 text-right">{m.guests}</td>
                          <td className="py-1.5 text-right">{money(m.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-sm text-gray-500">No packages sold in this range.</p>}
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Event types</h3>
              {ev?.event_types?.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-gray-500">
                      <tr><th className="py-1">Type</th><th className="py-1 text-right">Count</th>
                        <th className="py-1 text-right">Value</th></tr>
                    </thead>
                    <tbody>
                      {ev.event_types.map((t) => (
                        <tr key={t.type} className="border-t border-gray-100">
                          <td className="py-1.5">{t.type}</td>
                          <td className="py-1.5 text-right">{t.count}</td>
                          <td className="py-1.5 text-right">{money(t.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-sm text-gray-500">No events in this range.</p>}
            </div>
          </div>
        </Section>

        <Section
          icon={PieChart}
          title="Profitability"
          note="Completed events only. Revenue is what settlement recognised; food cost is what the stock ledger says was consumed."
        >
          {pf?.events?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-gray-500">
                  <tr>
                    <th className="py-1">Event</th><th className="py-1">Date</th>
                    <th className="py-1 text-right">Guests</th><th className="py-1 text-right">Revenue</th>
                    <th className="py-1 text-right">Food cost</th><th className="py-1 text-right">Expenses</th>
                    <th className="py-1 text-right">Contribution</th><th className="py-1 text-right">%</th>
                  </tr>
                </thead>
                <tbody>
                  {pf.events.map((e) => (
                    <tr key={e.event_id} className="border-t border-gray-100">
                      <td className="py-1.5">
                        <Link href={`/admin/events/${e.event_id}`} className="font-medium text-gray-900 hover:underline">
                          {e.event_number}
                        </Link>
                        <div className="text-xs text-gray-500">{e.title}</div>
                      </td>
                      <td className="py-1.5">{dateLabel(e.event_date)}</td>
                      <td className="py-1.5 text-right">{e.guests}</td>
                      <td className="py-1.5 text-right">{money(e.revenue)}</td>
                      <td className="py-1.5 text-right">{money(e.food_cost)}</td>
                      <td className="py-1.5 text-right">{money(e.event_expenses)}</td>
                      <td className={`py-1.5 text-right font-medium ${e.contribution < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                        {money(e.contribution)}
                      </td>
                      <td className="py-1.5 text-right">{e.contribution_percent == null ? '—' : `${e.contribution_percent}%`}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 font-semibold">
                    <td className="py-2" colSpan={3}>Total</td>
                    <td className="py-2 text-right">{money(pf.totals?.revenue)}</td>
                    <td className="py-2 text-right">{money(pf.totals?.food_cost)}</td>
                    <td className="py-2 text-right">{money(pf.totals?.event_expenses)}</td>
                    <td className="py-2 text-right">{money(pf.totals?.contribution)}</td>
                    <td className="py-2 text-right">
                      {pf.totals?.contribution_percent == null ? '—' : `${pf.totals.contribution_percent}%`}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : <p className="text-sm text-gray-500">No completed events in this range.</p>}
        </Section>
      </div>
    </AdminLayout>
  );
}

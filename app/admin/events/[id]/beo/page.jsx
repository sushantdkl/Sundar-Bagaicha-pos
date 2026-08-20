'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import AdminLayout from '@/components/admin/admin-layout';
import { ArrowLeft, FileCheck2, History, Printer } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';
import { useToast } from '@/components/ui/toast';
import { money, dateLabel, clockLabel, errText, useEventsBasePath } from '../../event-ui';

const AUDIENCES = [
  ['customer', 'Customer quotation', 'Prices, terms and cancellation policy.'],
  ['internal', 'Internal BEO', 'Everything, including internal notes and operations.'],
  ['kitchen', 'Kitchen production', 'Dishes and counts only — no prices.'],
];

export default function BeoPage() {
  const { id } = useParams();
  const eventsBase = useEventsBasePath();
  const { addToast } = useToast();
  const [audience, setAudience] = useState('customer');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await apiJson(`/api/admin/events/${id}/beo?audience=${audience}`));
    } catch (e) {
      addToast({ type: 'error', title: 'Could not build the document', description: errText(e) });
    } finally {
      setBusy(false);
    }
  }, [id, audience, addToast]);

  useEffect(() => { load(); }, [load]);

  const issue = async () => {
    const reason = window.prompt('What changed in this revision? (recorded with the snapshot)');
    if (reason === null) return;
    try {
      const res = await apiJson(`/api/admin/events/${id}/beo`, {
        method: 'POST',
        body: JSON.stringify({ audience, reason: reason.trim() || null }),
      });
      addToast({ type: 'success', title: res.message, description: 'The previous revision is kept in full.' });
      await load();
    } catch (e) {
      addToast({ type: 'error', title: 'Could not issue the revision', description: errText(e) });
    }
  };

  const doc = data?.document;
  const showPrices = audience !== 'kitchen';

  if (!doc) {
    return <AdminLayout><main className="p-8 text-sm text-gray-500">{busy ? 'Building document…' : 'Not found.'}</main></AdminLayout>;
  }

  return (
    <AdminLayout>
      <header className="print:hidden border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <Link href={`${eventsBase}/${id}`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" />Back to event
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Banquet Event Order</h1>
            <p className="mt-1 text-sm text-gray-500">
              {doc.event.event_number} · Revision {doc.revision}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setShowHistory((v) => !v)} className={BTN}>
              <History className="h-4 w-4" />Revisions ({data.revisions.length})
            </button>
            <button onClick={issue} className={BTN}><FileCheck2 className="h-4 w-4" />Issue revision</button>
            <button onClick={() => window.print()} className={PRIMARY}><Printer className="h-4 w-4" />Print</button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {AUDIENCES.map(([v, label, hint]) => (
            <button
              key={v} onClick={() => setAudience(v)} title={hint}
              className={`border px-3 py-2 text-left text-xs ${audience === v ? 'border-gray-950 bg-gray-950 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
            >
              <span className="block font-semibold">{label}</span>
              <span className={`block ${audience === v ? 'text-gray-300' : 'text-gray-500'}`}>{hint}</span>
            </button>
          ))}
        </div>

        {showHistory && (
          <div className="mt-4 border border-gray-200 bg-white">
            <h2 className="border-b border-gray-200 px-4 py-2 text-sm font-bold text-gray-900">Revision history</h2>
            <ul className="divide-y divide-gray-100">
              {data.revisions.map((r) => (
                <li key={r.id} className="px-4 py-2 text-sm">
                  <span className="font-semibold text-gray-900">Revision {r.revision}</span>
                  {r.final && <span className="ml-2 bg-gray-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">FINAL</span>}
                  <span className="ml-2 text-xs text-gray-500">
                    {r.audience} · {r.issued_by || 'system'} · {new Date(r.issued_at).toLocaleString('en-GB', { timeZone: 'Asia/Kathmandu' })}
                  </span>
                  {r.reason && <p className="text-xs text-gray-600">“{r.reason}”</p>}
                  {r.snapshot?.totals && (
                    <p className="text-xs text-gray-500">Total at that revision: {money(r.snapshot.totals.total)}</p>
                  )}
                </li>
              ))}
              {!data.revisions.length && <li className="px-4 py-6 text-center text-sm text-gray-500">No revisions issued yet.</li>}
            </ul>
          </div>
        )}
      </header>

      <main className="bg-gray-50 p-4 sm:p-6 lg:p-8 print:bg-white print:p-0">
        <article className="mx-auto max-w-4xl border border-gray-200 bg-white p-8 print:border-0 print:p-0">
          <div className="flex items-start justify-between gap-6 border-b-2 border-gray-900 pb-4">
            <div>
              <h1 className="text-xl font-bold text-gray-950">{doc.business.name}</h1>
              <p className="text-xs text-gray-600">{doc.business.address}</p>
              <p className="text-xs text-gray-600">{doc.business.phone}{doc.business.email ? ` · ${doc.business.email}` : ''}</p>
              {(doc.business.vat_number || doc.business.pan_number) && (
                <p className="text-xs text-gray-600">
                  {doc.business.vat_number ? `VAT ${doc.business.vat_number}` : ''}
                  {doc.business.pan_number ? ` PAN ${doc.business.pan_number}` : ''}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-sm font-bold uppercase tracking-wide text-gray-900">
                {audience === 'customer' ? 'Event Quotation' : audience === 'kitchen' ? 'Kitchen Production Sheet' : 'Banquet Event Order'}
              </p>
              <p className="text-xs text-gray-600">{doc.event.event_number}</p>
              <p className="text-xs text-gray-600">Revision {doc.revision}</p>
              <p className="text-xs text-gray-600">{new Date(doc.generated_at).toLocaleDateString('en-GB', { timeZone: 'Asia/Kathmandu' })}</p>
            </div>
          </div>

          <section className="mt-5 grid gap-5 sm:grid-cols-2">
            <div>
              <H>Client</H>
              <P>{doc.client.name || '—'}</P>
              {doc.client.phone && <P>{doc.client.phone}</P>}
              {doc.client.email && <P>{doc.client.email}</P>}
            </div>
            <div>
              <H>Event</H>
              <P>{doc.event.title || doc.event.event_type}</P>
              <P>{doc.event.event_type}</P>
              <P>{dateLabel(doc.event.event_date)}{doc.event.end_date ? ` → ${dateLabel(doc.event.end_date)}` : ''}</P>
              <P>{[clockLabel(doc.event.start_time), clockLabel(doc.event.end_time)].filter(Boolean).join(' – ') || 'Time to be confirmed'}</P>
              <P>{doc.event.space || 'Space not assigned'}</P>
            </div>
          </section>

          <section className="mt-5">
            <H>Guests</H>
            <p className="text-sm text-gray-800">
              Expected {doc.guests.expected ?? '—'} · Guaranteed {doc.guests.guaranteed ?? '—'} · Actual {doc.guests.actual ?? '—'}
            </p>
            <p className="text-sm font-semibold text-gray-900">Billable: {doc.guests.billable ?? '—'}</p>
            <p className="text-xs text-gray-500">{doc.guests.basis}</p>
            {doc.guests.allocation?.length > 0 && (
              <p className="mt-1 text-xs text-gray-600">
                {doc.guests.allocation.map((a) => `${a.guests} × ${a.name}`).join(' · ')}
              </p>
            )}
            {doc.guests.allocation_warnings?.map((w, i) => (
              <p key={i} className="mt-1 text-xs text-amber-700">{w.message}</p>
            ))}
          </section>

          <section className="mt-5">
            <H>{audience === 'kitchen' ? 'To produce' : 'Items'}</H>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-300 text-xs uppercase text-gray-500">
                <tr>
                  <th className="py-2 font-semibold">Item</th>
                  <th className="py-2 text-right font-semibold">Qty</th>
                  {showPrices && <th className="py-2 text-right font-semibold">Unit</th>}
                  {showPrices && <th className="py-2 text-right font-semibold">Amount</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {doc.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2">
                      {l.name}
                      {l.complimentary && <span className="ml-2 text-xs font-semibold text-emerald-700">COMPLIMENTARY</span>}
                      {l.description && <span className="block text-xs text-gray-500">{l.description}</span>}
                    </td>
                    <td className="py-2 text-right tabular-nums">{l.quantity}</td>
                    {showPrices && <td className="py-2 text-right tabular-nums">{money(l.unit_price)}</td>}
                    {showPrices && <td className="py-2 text-right font-semibold tabular-nums">{money(l.line_total)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {!doc.lines.length && <p className="py-4 text-sm text-gray-500">Nothing quoted yet.</p>}
          </section>

          {showPrices && doc.totals && (
            <section className="mt-5 flex justify-end">
              <dl className="w-full max-w-xs space-y-1 text-sm">
                <T label="Subtotal" value={money(doc.totals.subtotal)} />
                {doc.totals.discount > 0 && <T label={`Discount${doc.totals.discount_reason ? ` (${doc.totals.discount_reason})` : ''}`} value={`− ${money(doc.totals.discount)}`} />}
                {doc.totals.service_charge > 0 && <T label={`Service charge ${doc.totals.service_charge_percent}%`} value={money(doc.totals.service_charge)} />}
                {doc.totals.tax > 0 && <T label={`VAT ${doc.totals.tax_percent}%`} value={money(doc.totals.tax)} />}
                <T label="Total" value={money(doc.totals.total)} strong />
                {doc.totals.deposits_received > 0 && <T label="Deposits received" value={`− ${money(doc.totals.deposits_received)}`} />}
                <T label="Balance due" value={money(doc.totals.outstanding)} strong />
              </dl>
            </section>
          )}

          {doc.notes.client && (
            <section className="mt-5"><H>Notes</H><P>{doc.notes.client}</P></section>
          )}
          {doc.notes.internal && (
            <section className="mt-5 border border-dashed border-gray-300 p-3">
              <H>Internal notes — not for the client</H><P>{doc.notes.internal}</P>
            </section>
          )}

          {doc.operations?.tasks?.length > 0 && (
            <section className="mt-5">
              <H>Operations</H>
              <ul className="list-disc pl-5 text-sm text-gray-800">
                {doc.operations.tasks.map((t, i) => (
                  <li key={i}>{t.title}{t.category ? ` (${t.category})` : ''} — {t.status}</li>
                ))}
              </ul>
            </section>
          )}

          {showPrices && doc.terms && (
            <section className="mt-6 border-t border-gray-200 pt-4">
              <H>Terms</H>
              <ol className="list-decimal pl-5 text-xs text-gray-700">
                {doc.terms.map((t, i) => <li key={i}>{t}</li>)}
              </ol>
              <H className="mt-3">Cancellation</H>
              <ol className="list-decimal pl-5 text-xs text-gray-700">
                {doc.cancellation_terms.map((t, i) => <li key={i}>{t}</li>)}
              </ol>
            </section>
          )}

          {audience === 'kitchen' && (
            <p className="mt-6 border-t border-gray-200 pt-3 text-xs text-gray-500">
              Production sheet — prices are deliberately omitted.
            </p>
          )}
        </article>
      </main>
    </AdminLayout>
  );
}

function H({ children, className = '' }) {
  return <h2 className={`text-xs font-bold uppercase tracking-wide text-gray-500 ${className}`}>{children}</h2>;
}
function P({ children }) { return <p className="text-sm text-gray-800">{children}</p>; }
function T({ label, value, strong }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? 'border-t border-gray-300 pt-1' : ''}`}>
      <dt className={strong ? 'font-bold text-gray-900' : 'text-gray-600'}>{label}</dt>
      <dd className={`tabular-nums ${strong ? 'font-bold text-gray-900' : 'text-gray-800'}`}>{value}</dd>
    </div>
  );
}

const BTN = 'inline-flex h-10 items-center justify-center gap-2 border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50';
const PRIMARY = 'inline-flex h-10 items-center justify-center gap-2 border border-gray-950 bg-gray-950 px-4 text-sm font-semibold text-white hover:bg-black [color:#fff!important]';

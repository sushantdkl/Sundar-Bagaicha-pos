'use client';

import { formatNepalDate } from '@/lib/time-utils';

/**
 * Debit/credit table with a running balance, shared by the General Ledger,
 * Cash Book and Bank Book. `lines` are oldest-first; the balance runs down.
 * `debitNormal` flips the sign so asset/expense books read naturally.
 */

export function money(n) {
  const v = Number(n || 0);
  return `Rs ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Pure: attach a running balance to each line. Kept out of the component body
// so there is no across-render mutation for the compiler to flag.
function withRunningBalance(lines, debitNormal, opening) {
  let bal = Number(opening) || 0;
  const rows = lines.map((l) => {
    bal += debitNormal ? Number(l.debit || 0) - Number(l.credit || 0) : Number(l.credit || 0) - Number(l.debit || 0);
    return { ...l, _balance: bal };
  });
  return { rows, closing: bal };
}

export default function LedgerTable({ lines = [], debitNormal = true, opening = 0, loading = false, empty = 'No entries.' }) {
  const { rows, closing: bal } = withRunningBalance(lines, debitNormal, opening);
  const totalDr = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCr = lines.reduce((s, l) => s + Number(l.credit || 0), 0);

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Date</th>
              <th className="px-4 py-3 font-semibold">Details</th>
              <th className="px-4 py-3 text-right font-semibold">Debit</th>
              <th className="px-4 py-3 text-right font-semibold">Credit</th>
              <th className="px-4 py-3 text-right font-semibold">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {opening !== 0 && (
              <tr className="bg-gray-50/60 text-gray-500">
                <td className="px-4 py-2" colSpan={4}>Opening balance</td>
                <td className="px-4 py-2 text-right tabular-nums">{money(opening)}</td>
              </tr>
            )}
            {rows.map((l, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-gray-600">{l.entry_date ? formatNepalDate(l.entry_date) : '—'}</td>
                <td className="px-4 py-2">
                  <span className="text-gray-900">{l.memo || l.line_memo || '—'}</span>
                  {l.source_type && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-500">{l.source_type}</span>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-900">{Number(l.debit) ? money(l.debit) : ''}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-900">{Number(l.credit) ? money(l.credit) : ''}</td>
                <td className="px-4 py-2 text-right tabular-nums font-medium text-gray-900">{money(l._balance)}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-500">{empty}</td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t border-gray-200 bg-gray-50 font-semibold text-gray-900">
              <tr>
                <td className="px-4 py-3" colSpan={2}>Totals</td>
                <td className="px-4 py-3 text-right tabular-nums">{money(totalDr)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{money(totalCr)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{money(bal)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

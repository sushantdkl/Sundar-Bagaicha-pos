'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles, MapPin } from 'lucide-react';
import { parsePartySize, parsePreferences } from '@/lib/reservation-core';

function bucketTables(tables, reservation) {
  const party = parsePartySize(reservation?.guests, reservation?.party_size);
  const available = [];
  const reservedSoon = [];
  const occupied = [];
  const cleaning = [];
  const unavailable = [];

  for (const t of tables || []) {
    const status = t.status || 'available';
    const row = {
      ...t,
      id: t.table_id || t.id,
      fit: !t.capacity || Number(t.capacity) >= party,
    };
    if (['reserved', 'reserved_arrived'].includes(status)) reservedSoon.push(row);
    else if (['cooking', 'ready', 'dining', 'awaiting_payment', 'occupied'].includes(status) || t.current_order_id) {
      occupied.push(row);
    } else if (status === 'cleaning') cleaning.push(row);
    else if (status === 'available') available.push(row);
    else unavailable.push(row);
  }

  const prefs = parsePreferences(reservation?.preferences);
  const score = (t) => {
    let s = 0;
    if (t.fit) s += 10;
    if (t.capacity && party) s += Math.max(0, 5 - Math.abs(Number(t.capacity) - party));
    if (prefs.outdoor && /outdoor|patio|garden|terrace/i.test(`${t.section || ''} ${t.floor || ''}`)) {
      s += 5;
    }
    return s;
  };

  const recommended = [...available].filter((t) => t.fit).sort((a, b) => score(b) - score(a))[0] || null;

  return { available, reservedSoon, occupied, cleaning, unavailable, recommended, party };
}

/**
 * Smart table picker for assign / change table.
 */
export default function AssignTableDialog({
  open,
  reservation,
  tables = [],
  busy = false,
  error = '',
  alternatives = [],
  onClose,
  onConfirm,
}) {
  const [mounted, setMounted] = useState(false);
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open || !reservation) return;
    const { recommended } = bucketTables(tables, reservation);
    setSelectedId(
      reservation.table_id
        ? String(reservation.table_id)
        : recommended
          ? String(recommended.id)
          : ''
    );
  }, [open, reservation, tables]);

  const buckets = useMemo(() => bucketTables(tables, reservation), [tables, reservation]);

  if (!open || !mounted || !reservation) return null;

  const Group = ({ title, items, tone }) => {
    if (!items.length) return null;
    return (
      <div className="space-y-1.5">
        <p className={`text-[11px] font-semibold uppercase tracking-wide ${tone}`}>{title}</p>
        <div className="grid grid-cols-2 gap-1.5">
          {items.map((t) => {
            const id = String(t.id);
            const active = selectedId === id;
            return (
              <button
                key={id}
                type="button"
                disabled={
                  busy ||
                  (Boolean(t.current_order_id) &&
                    Number(t.id) !== Number(reservation.table_id) &&
                    ['occupied', 'cooking', 'ready', 'dining', 'awaiting_payment'].includes(t.status))
                }
                onClick={() => setSelectedId(id)}
                className={`text-left rounded-xl border px-2.5 py-2 text-sm ${
                  active
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-800'
                } disabled:opacity-40`}
              >
                <span className="font-semibold">T{t.table_number}</span>
                <span className={`block text-[10px] ${active ? 'text-slate-300' : 'text-slate-500'}`}>
                  {t.capacity ? `${t.capacity} seats` : '—'}
                  {!t.fit ? ' · tight' : ''}
                  {t.status === 'reserved' ? ' · held' : ''}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-[190] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button type="button" className="absolute inset-0 bg-black/45" aria-label="Close" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-100 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide">Assign table</p>
            <h3 className="font-semibold text-slate-900">
              {reservation.name} · {buckets.party} guests
            </h3>
          </div>
          <button type="button" onClick={onClose} className="h-9 w-9 rounded-xl flex items-center justify-center hover:bg-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {buckets.recommended && (
            <button
              type="button"
              onClick={() => setSelectedId(String(buckets.recommended.id))}
              className={`w-full text-left rounded-xl border px-3 py-2.5 flex items-center gap-2 ${
                selectedId === String(buckets.recommended.id)
                  ? 'border-emerald-600 bg-emerald-50'
                  : 'border-emerald-200 bg-emerald-50/60'
              }`}
            >
              <Sparkles className="w-4 h-4 text-emerald-700 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-emerald-900">
                  Recommended: Table {buckets.recommended.table_number}
                </p>
                <p className="text-[11px] text-emerald-800">
                  Best fit for {buckets.party} guests
                  {buckets.recommended.capacity ? ` (${buckets.recommended.capacity} seats)` : ''}
                </p>
              </div>
            </button>
          )}

          <Group title="Available" items={buckets.available} tone="text-emerald-700" />
          <Group title="Reserved soon" items={buckets.reservedSoon} tone="text-yellow-800" />
          <Group title="Occupied" items={buckets.occupied} tone="text-orange-700" />
          <Group title="Cleaning" items={buckets.cleaning} tone="text-slate-600" />
          <Group title="Other" items={buckets.unavailable} tone="text-slate-500" />

          {error && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
              <p className="font-semibold">{error}</p>
              {alternatives.length > 0 && (
                <p className="mt-1">Try: {alternatives.map((a) => `T${a.table_number}`).join(', ')}</p>
              )}
            </div>
          )}

          <button
            type="button"
            disabled={busy || !selectedId}
            onClick={() => onConfirm?.(Number(selectedId))}
            className="w-full h-12 rounded-xl bg-slate-900 text-white font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
          >
            <MapPin className="w-4 h-4" />
            {busy ? 'Saving…' : 'Confirm table'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

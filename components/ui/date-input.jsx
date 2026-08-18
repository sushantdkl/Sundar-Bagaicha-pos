'use client';

import { useEffect, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';

// Native <input type="date"> renders in whatever format the OS/browser locale
// uses (usually mm/dd/yyyy on US-locale Windows) — the page's `lang` attribute
// does NOT override it in Chromium/Firefox, verified empirically. This is a
// plain masked text input instead, so the displayed format is fully ours —
// with a popup calendar (react-day-picker) on click, since dd/mm/yyyy-by-hand
// isn't how anyone expects a date field to work.

function isoToDisplay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function displayToIso(display) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(display);
  if (!m) return null;
  const [, d, mo, y] = m;
  const day = Number(d);
  const month = Number(mo);
  const year = Number(y);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > new Date(year, month, 0).getDate()) return null;
  return `${y}-${mo}-${d}`;
}

// Local-time construction on purpose — parsing an ISO string with `new Date(iso)`
// reads it as UTC midnight, which can roll back a day once displayed in a
// negative-UTC-offset browser. Building from parts sidesteps that entirely.
function isoToDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
}

function dateToIso(date) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

// Auto-insert slashes as digits are typed: 16082026 -> 16/08/2026
function maskInput(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  let out = digits.slice(0, 2);
  if (digits.length > 2) out += `/${digits.slice(2, 4)}`;
  if (digits.length > 4) out += `/${digits.slice(4, 8)}`;
  return out;
}

/**
 * Controlled dd/mm/yyyy date input with a click-to-open calendar. `value`/
 * `onChange` are ISO yyyy-mm-dd strings, same contract as the native
 * `<input type="date">` it replaces. Optional `min`/`max` (ISO strings)
 * reject/disable an out-of-range date the same way a native input would.
 */
export default function DateInput({ value, onChange, min, max, className = '', 'aria-label': ariaLabel, placeholder = 'dd/mm/yyyy', ...rest }) {
  const [display, setDisplay] = useState(() => isoToDisplay(value));
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    setDisplay(isoToDisplay(value));
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleChange = (e) => {
    const masked = maskInput(e.target.value);
    setDisplay(masked);
    if (masked === '') { onChange(''); return; }
    const iso = displayToIso(masked);
    if (!iso) return;
    if (min && iso < min) return;
    if (max && iso > max) return;
    onChange(iso);
  };

  const handleDaySelect = (date) => {
    if (!date) return;
    onChange(dateToIso(date));
    setOpen(false);
  };

  const disabledMatchers = [
    min ? { before: isoToDate(min) } : null,
    max ? { after: isoToDate(max) } : null,
  ].filter(Boolean);

  return (
    <div ref={wrapRef} className="relative inline-block">
      <input
        type="text"
        inputMode="numeric"
        value={display}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        maxLength={10}
        aria-label={ariaLabel}
        className={className}
        {...rest}
      />
      {open && (
        <div className="absolute z-50 mt-1 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
          <DayPicker
            mode="single"
            selected={isoToDate(value)}
            onSelect={handleDaySelect}
            defaultMonth={isoToDate(value) || new Date()}
            disabled={disabledMatchers.length ? disabledMatchers : undefined}
          />
        </div>
      )}
    </div>
  );
}

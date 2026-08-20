/**
 * Shared presentation helpers for the Events screens.
 *
 * Status vocabulary is re-exported from lib/events/constants.js so the UI can
 * never drift from what the database actually accepts.
 */
export { EVENT_STATUSES, EVENT_STATUS, EVENT_PAYMENT_STATUSES } from '@/lib/events/constants.js';

export const STATUS_TONE = {
  INQUIRY: 'bg-slate-100 text-slate-700',
  DRAFT: 'bg-gray-100 text-gray-700',
  QUOTED: 'bg-amber-50 text-amber-700',
  CONFIRMED: 'bg-emerald-50 text-emerald-700',
  PLANNING: 'bg-sky-50 text-sky-700',
  FINALIZED: 'bg-indigo-50 text-indigo-700',
  IN_PROGRESS: 'bg-fuchsia-50 text-fuchsia-700',
  COMPLETED: 'bg-gray-900 text-white',
  CANCELLED: 'bg-red-50 text-red-700',
};

export const money = (n) =>
  `Rs ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Dates are plain YYYY-MM-DD wall-clock; pin to midday NPT so no zone shifts the day. */
export const dateLabel = (s) => {
  if (!s) return '—';
  const d = new Date(`${String(s).slice(0, 10)}T12:00:00+05:45`);
  return Number.isNaN(d.getTime())
    ? String(s)
    : d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kathmandu', day: '2-digit', month: 'short', year: 'numeric' });
};

export const dayLabel = (s) => {
  if (!s) return '';
  const d = new Date(`${String(s).slice(0, 10)}T12:00:00+05:45`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kathmandu', weekday: 'short' });
};

/** 24h "18:00" → "6:00 PM"; the venue's staff read a 12-hour clock. */
export const clockLabel = (t) => {
  if (!t || !/^\d{2}:\d{2}/.test(t)) return '';
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
};

export const timeRange = (e) => {
  const start = clockLabel(e?.start_time);
  const end = clockLabel(e?.end_time);
  if (start && end) return `${start} – ${end}`;
  return start || end || '';
};

/**
 * Guests shown as guaranteed/expected — the two numbers a banquet actually
 * plans against. Actual replaces expected once the event has run.
 */
export const guestLabel = (e) => {
  if (e?.actual_guests != null) return `${e.actual_guests} actual`;
  if (e?.guaranteed_guests != null) return `${e.guaranteed_guests} guaranteed`;
  if (e?.expected_guests != null) return `${e.expected_guests} expected`;
  return '—';
};

/**
 * apiJson throws the API's JSON body, which uses `error` (see clientError in
 * lib/logger.js). Falling back through message/status keeps a toast readable
 * whatever failed.
 */
export const errText = (err) =>
  err?.error || err?.message || (err?.status ? `Request failed (${err.status})` : 'Request failed.');

/* ────────────────────────────────────────────────────────────────────────────
 * Modernist presentation helpers.
 *
 * Used by the three screens the Claude Design redesign covers (dashboard,
 * detail, new). STATUS_TONE above is the older Tailwind palette and is still
 * what Calendar, Spaces, Packages and Reports render with — leaving it in place
 * is what keeps those pages looking exactly as they did.
 * ──────────────────────────────────────────────────────────────────────────── */

/** "PARTIALLY_PAID" → "Partially paid". Sentence case, not Title Case. */
export const statusText = (s) => {
  const flat = String(s || '').replace(/_/g, ' ').toLowerCase().trim();
  return flat ? flat.charAt(0).toUpperCase() + flat.slice(1) : '—';
};

/**
 * Pill class for an event or payment status. Falls back to the INQUIRY tone
 * rather than rendering an unstyled pill if the vocabulary ever grows.
 */
export const pillClass = (s) => {
  const key = String(s || '').toUpperCase();
  const known = [
    'INQUIRY', 'DRAFT', 'QUOTED', 'CONFIRMED', 'PLANNING', 'FINALIZED',
    'IN_PROGRESS', 'COMPLETED', 'CANCELLED',
    'UNPAID', 'DEPOSIT_DUE', 'PARTIALLY_PAID', 'PARTIAL', 'PAID', 'REFUNDED',
  ];
  return `pill pill-${known.includes(key) ? key : 'INQUIRY'}`;
};

/** The happy path, in order. CANCELLED is a departure from it, not a step on it. */
export const LIFECYCLE = [
  'INQUIRY', 'DRAFT', 'QUOTED', 'CONFIRMED', 'PLANNING', 'FINALIZED', 'IN_PROGRESS', 'COMPLETED',
];

/** Rs 1,45,000 — no decimals, for figures that only ever need their magnitude. */
export const moneyShort = (n) =>
  `Rs ${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

/**
 * Payment methods the accounting layer can post. Mirrors PAYMENT_ACCOUNT in
 * lib/accounting.js — an unmapped method throws there rather than silently
 * landing in Cash, so the picker must not offer one.
 */
export const PAYMENT_METHODS = [
  ['cash', 'Cash'],
  ['bank_transfer', 'Bank transfer'],
  ['cheque', 'Cheque'],
  ['card', 'Card'],
  ['esewa', 'eSewa'],
  ['khalti', 'Khalti'],
  ['qr', 'QR / Fonepay'],
];

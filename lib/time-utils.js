// Nepal timezone utilities
// SQLite CURRENT_TIMESTAMP is UTC without a Z suffix — parse carefully.

export function parseDbDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const s = String(value).trim();
  if (!s) return null;

  // Already ISO with timezone
  if (/Z$/i.test(s) || /[+-]\d{2}:\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // "2026-07-18 15:30:00" or "2026-07-18T15:30:00" → treat as UTC (SQLite default)
  const normalized = s.includes('T') ? s : s.replace(' ', 'T');
  const d = new Date(`${normalized}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function getNepaliDateTime(inputDate = null) {
  const d = inputDate ? parseDbDate(inputDate) || new Date(inputDate) : new Date();
  if (Number.isNaN(d.getTime())) return 'N/A';
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Kathmandu' }).replace(' ', 'T');
}

export function getNepaliDateString(inputDate = null) {
  const d = inputDate ? parseDbDate(inputDate) || new Date(inputDate) : new Date();
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' });
}

export function getNepaliNow() {
  return new Date();
}

export function formatNepalTime(dateString) {
  if (!dateString) return 'N/A';
  const date = parseDbDate(dateString) || new Date(dateString);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString('en-US', {
    timeZone: 'Asia/Kathmandu',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatNepalDate(dateString) {
  if (!dateString) return '—';
  const date = parseDbDate(dateString) || new Date(dateString);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', {
    timeZone: 'Asia/Kathmandu',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatNepalClock(dateString) {
  if (!dateString) return '—';
  const date = parseDbDate(dateString) || new Date(dateString);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('en-US', {
    timeZone: 'Asia/Kathmandu',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

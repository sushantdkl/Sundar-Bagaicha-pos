/**
 * Nepal (Asia/Kathmandu) date helpers for reports/dashboard filters.
 */

export function nepalDateString(input = new Date()) {
  const d = input instanceof Date ? input : new Date(input);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kathmandu',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function formatNepalDisplay(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(`${dateStr}T12:00:00+05:45`);
    return d.toLocaleDateString('en-GB', {
      timeZone: 'Asia/Kathmandu',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export function formatNepalDateTime(value) {
  if (!value) return '—';
  // Prefer UTC-aware SQLite parsing so KTM clock is accurate.
  try {
    // Dynamic import avoided — keep sync for UI; inline the UTC-Z rule.
    const s = String(value).trim();
    let d;
    if (/Z$/i.test(s) || /[+-]\d{2}:\d{2}$/.test(s)) {
      d = new Date(s);
    } else if (s.includes('T') || s.includes(' ')) {
      const normalized = s.includes('T') ? s : s.replace(' ', 'T');
      d = new Date(`${normalized}Z`);
    } else {
      d = new Date(`${s}T00:00:00+05:45`);
    }
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('en-GB', {
      timeZone: 'Asia/Kathmandu',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return String(value);
  }
}

/**
 * Resolve a report/dashboard period into { start, end, label }.
 * start/end are YYYY-MM-DD in Nepal calendar.
 */
export function resolvePeriodRange(period = 'today', startDate = null, endDate = null) {
  const today = nepalDateString(new Date());

  const shifted = (date, days) => {
    const cursor = new Date(`${date}T12:00:00+05:45`);
    cursor.setDate(cursor.getDate() + days);
    return nepalDateString(cursor);
  };

  const rolling = (days, label, id) => ({
    start: shifted(today, -(days - 1)),
    end: today,
    label: `${label} · ${formatNepalDisplay(shifted(today, -(days - 1)))} – ${formatNepalDisplay(today)}`,
    period: id,
  });

  if (period === 'custom' && startDate && endDate) {
    const start = startDate <= endDate ? startDate : endDate;
    const end = startDate <= endDate ? endDate : startDate;
    return {
      start,
      end,
      label: `${formatNepalDisplay(start)} – ${formatNepalDisplay(end)}`,
      period: 'custom',
    };
  }

  if (period === 'yesterday') {
    const y = new Date(`${today}T12:00:00+05:45`);
    y.setDate(y.getDate() - 1);
    const yStr = nepalDateString(y);
    return {
      start: yStr,
      end: yStr,
      label: `Yesterday · ${formatNepalDisplay(yStr)}`,
      period: 'yesterday',
    };
  }

  if (period === 'last3') return rolling(3, 'Last 3 days', 'last3');
  if (period === 'last7') return rolling(7, 'Last 7 days', 'last7');
  if (period === 'last30') return rolling(30, 'Last 30 days', 'last30');

  if (period === 'this_week') {
    const cursor = new Date(`${today}T12:00:00+05:45`);
    const mondayOffset = (cursor.getDay() + 6) % 7;
    const start = shifted(today, -mondayOffset);
    return {
      start,
      end: today,
      label: `This week · ${formatNepalDisplay(start)} – ${formatNepalDisplay(today)}`,
      period: 'this_week',
    };
  }

  if (period === 'this_month') {
    const start = `${today.slice(0, 7)}-01`;
    return {
      start,
      end: today,
      label: `This month · ${formatNepalDisplay(start)} – ${formatNepalDisplay(today)}`,
      period: 'this_month',
    };
  }

  if (period === 'last_month') {
    const firstThisMonth = new Date(`${today.slice(0, 7)}-01T12:00:00+05:45`);
    const end = nepalDateString(new Date(firstThisMonth.getTime() - 86400000));
    const start = `${end.slice(0, 7)}-01`;
    return {
      start,
      end,
      label: `Last month · ${formatNepalDisplay(start)} – ${formatNepalDisplay(end)}`,
      period: 'last_month',
    };
  }

  if (period === 'year') {
    // Calendar year to date in Nepal
    const [y] = today.split('-').map(Number);
    const startStr = `${y}-01-01`;
    return {
      start: startStr,
      end: today,
      label: `This year · ${formatNepalDisplay(startStr)} – ${formatNepalDisplay(today)}`,
      period: 'year',
    };
  }

  if (period === 'week') {
    // Last 7 days including today
    const end = new Date(`${today}T12:00:00+05:45`);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    const startStr = nepalDateString(start);
    return {
      start: startStr,
      end: today,
      label: `This week · ${formatNepalDisplay(startStr)} – ${formatNepalDisplay(today)}`,
      period: 'week',
    };
  }

  if (period === 'month') {
    // Calendar month in Nepal
    const [y, m] = today.split('-').map(Number);
    const startStr = `${y}-${String(m).padStart(2, '0')}-01`;
    return {
      start: startStr,
      end: today,
      label: `This month · ${formatNepalDisplay(startStr)} – ${formatNepalDisplay(today)}`,
      period: 'month',
    };
  }

  // today (default)
  return {
    start: today,
    end: today,
    label: `Today · ${formatNepalDisplay(today)}`,
    period: 'today',
  };
}

/** SQL DATE() comparison params for a range (inclusive). */
export function dateParams(range) {
  return [range.start, range.end];
}

/**
 * Inclusive Nepal calendar day(s) → exclusive UTC datetime window.
 * Use for queries: `col >= startUtc AND col < endUtcExclusive`.
 * Fixes the classic bug where DATE(utc_col) = nepal_today misses overnight hours
 * (Nepal is UTC+5:45, so before ~05:45 NPT the UTC calendar date is still yesterday).
 */
export function nepalRangeUtcBounds(startDate, endDate = startDate) {
  const start = new Date(`${startDate}T00:00:00+05:45`);
  const endExclusive = new Date(`${endDate}T00:00:00+05:45`);
  endExclusive.setTime(endExclusive.getTime() + 86400000);
  const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
  return {
    startUtc: fmt(start),
    endUtcExclusive: fmt(endExclusive),
  };
}

/** Single Nepal day as UTC bounds. */
export function nepalDayUtcBounds(dateStr = nepalDateString()) {
  return nepalRangeUtcBounds(dateStr, dateStr);
}

/**
 * SQL expression: calendar date of a UTC timestamp in Asia/Kathmandu.
 * SQLite-first (`date(col, '+5 hours', '+45 minutes')`); Postgres adapter
 * rewrites the modifier form.
 */
export function nepalDateSql(column) {
  return `date(${column}, '+5 hours', '+45 minutes')`;
}

/** `col >= ? AND col < ?` fragment + params for a Nepal date range. */
export function nepalRangeSql(column, range) {
  const { startUtc, endUtcExclusive } = nepalRangeUtcBounds(range.start, range.end);
  return {
    sql: `${column} >= ? AND ${column} < ?`,
    params: [startUtc, endUtcExclusive],
  };
}

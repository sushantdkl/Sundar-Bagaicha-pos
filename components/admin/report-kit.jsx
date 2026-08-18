'use client';

/**
 * Presentation primitives for the Reports analytics centre.
 * Same visual language as the Dashboard / Inventory / Wastage pages:
 * white cards, border-gray-200, rounded-2xl, shadow-sm, gray-900 headings,
 * gray-500 secondary text, small colour chips, semantic colour only.
 */

import { useMemo, useState } from 'react';
import {
  Area, AreaChart as RcAreaChart, Bar, BarChart as RcBarChart, CartesianGrid, Cell,
  LabelList, ResponsiveContainer, Scatter, ScatterChart as RcScatterChart,
  Tooltip as RcTooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Star, Clock3, CreditCard, Wallet, Info,
  AlertTriangle, Search, ArrowUpDown, Download, Lightbulb,
} from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { formatNepalDateTime } from '@/lib/report-dates';
import { toCsv } from '@/lib/csv';
import { financialToneClass } from '@/lib/financial-tone';

const CHIP_ICONS = {
  up: { Icon: TrendingUp, tone: 'bg-emerald-50 text-emerald-600' },
  down: { Icon: TrendingDown, tone: 'bg-red-50 text-red-600' },
  star: { Icon: Star, tone: 'bg-amber-50 text-amber-600' },
  clock: { Icon: Clock3, tone: 'bg-blue-50 text-blue-600' },
  card: { Icon: CreditCard, tone: 'bg-violet-50 text-violet-600' },
  wallet: { Icon: Wallet, tone: 'bg-teal-50 text-teal-600' },
  warn: { Icon: AlertTriangle, tone: 'bg-amber-50 text-amber-600' },
  info: { Icon: Info, tone: 'bg-gray-100 text-gray-500' },
};

const TONE_CARD = {
  positive: 'border-emerald-200 bg-emerald-50/40',
  warning: 'border-amber-200 bg-amber-50/40',
  negative: 'border-red-200 bg-red-50/40',
  neutral: 'border-gray-200 bg-white',
};

const STATUS_TONE = {
  completed: 'bg-emerald-50 text-emerald-700',
  paid: 'bg-emerald-50 text-emerald-700',
  ok: 'bg-emerald-50 text-emerald-700',
  positive: 'bg-emerald-50 text-emerald-700',
  ready: 'bg-blue-50 text-blue-700',
  confirmed: 'bg-blue-50 text-blue-700',
  seated: 'bg-blue-50 text-blue-700',
  occupied: 'bg-blue-50 text-blue-700',
  preparing: 'bg-amber-50 text-amber-700',
  pending: 'bg-gray-100 text-gray-600',
  new: 'bg-gray-100 text-gray-600',
  low: 'bg-amber-50 text-amber-700',
  reserved: 'bg-violet-50 text-violet-700',
  cancelled: 'bg-red-50 text-red-700',
  no_show: 'bg-red-50 text-red-700',
  'out of stock': 'bg-red-50 text-red-700',
  available: 'bg-gray-100 text-gray-600',
};

/**
 * Chart palette — deliberately small.
 *
 * Every chart on this page is single-series, so hue never carries identity
 * *within* a chart; it only sets the card's tone. That lets the whole app run on
 * two neutral accents (blue for series, slate for ranked lists) plus three
 * reserved semantic tones (profit / expense / loss). The legacy `violet` and
 * `teal` keys collapse onto blue on purpose — seven hues across the tabs read as
 * a rainbow, which the design language forbids.
 *
 * Validated with the dataviz palette checker (light surface): lightness band,
 * chroma floor, normal-vision separation and 3:1 contrast all pass. The
 * amber↔emerald pair sits in the 6–8 CVD band, which is safe here only because
 * those two never appear as two series inside one chart.
 */
const CHART_COLORS = {
  blue: '#2563eb',
  violet: '#2563eb',
  teal: '#2563eb',
  slate: '#475569',
  emerald: '#059669',
  amber: '#d97706',
  red: '#be123c',
};

const AXIS_TICK = { fontSize: 11, fill: '#9ca3af' };
const GRID_STROKE = '#f3f4f6';
/** Subtle, not flashy: one short ease-out on mount. */
const ANIM = { isAnimationActive: true, animationDuration: 550, animationEasing: 'ease-out' };

const pickColor = (color) => CHART_COLORS[color] || CHART_COLORS.blue;

/* ------------------------------------------------------------------ */

export function formatValue(value, format) {
  if (value == null || value === '') return '—';
  switch (format) {
    case 'currency': {
      // Paise only matter under Rs 1,000; above that they just overflow the card.
      const n = Number(value) || 0;
      if (Math.abs(n) < 1000) return formatCurrency(n);
      return `Rs ${Math.round(n).toLocaleString('en-IN')}`;
    }
    case 'percent':
      return `${(Number(value) || 0).toFixed(1)}%`;
    case 'decimal':
      return (Number(value) || 0).toFixed(1);
    case 'minutes':
      return `${Math.round(Number(value) || 0)} min`;
    case 'number':
      return Number.isFinite(Number(value)) ? Number(value).toLocaleString() : String(value);
    case 'datetime':
      return formatNepalDateTime(value);
    default:
      return String(value);
  }
}

/** 1. Quick insight chips — one glanceable line each. */
export function QuickChips({ chips }) {
  if (!chips?.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 animate-in fade-in duration-300">
      {chips.map((chip, i) => {
        const meta = CHIP_ICONS[chip.icon] || CHIP_ICONS.info;
        return (
          <div key={i} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <span className={`shrink-0 rounded-lg p-1.5 ${meta.tone}`}>
              <meta.Icon className="h-4 w-4" />
            </span>
            <p className="text-sm text-gray-700 leading-snug">{chip.text}</p>
          </div>
        );
      })}
    </div>
  );
}

/** 2. Large KPI cards. */
export function KpiCards({ kpis }) {
  if (!kpis?.length) return null;
  const cols = kpis.length >= 5 ? 'xl:grid-cols-5' : 'lg:grid-cols-4';
  return (
    <div className={`grid grid-cols-2 gap-3 sm:gap-5 ${cols} animate-in fade-in duration-300`}>
      {kpis.map((kpi) => (
        <div key={kpi.key} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
          <p className="text-xs font-medium text-gray-500 sm:text-sm">{kpi.label}</p>
          <h3 className={`mt-2 truncate text-xl font-bold tabular-nums sm:text-2xl ${kpi.format === 'currency' ? financialToneClass(kpi) : 'text-gray-900'}`} title={String(kpi.value ?? '')}>
            {formatValue(kpi.value, kpi.format)}
          </h3>
          {kpi.sub && <p className="mt-1 truncate text-xs text-gray-400">{kpi.sub}</p>}
          {kpi.change != null && (
            <p className={`mt-1 inline-flex items-center gap-1 text-xs font-medium ${kpi.change >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {kpi.change >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {kpi.change >= 0 ? '+' : ''}{kpi.change}%
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/** One chart per card — never two. */
export function ChartCard({ title, hint, children, isEmpty, empty }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6 animate-in fade-in duration-300">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-gray-400">{hint}</p>}
      </div>
      {isEmpty ? <p className="py-12 text-center text-sm text-gray-500">{empty}</p> : children}
    </div>
  );
}

/* ---------------------------- chart primitives ---------------------------- */
/*
 * Three shared wrappers cover every chart in the app (dashboard, 11 report tabs,
 * wastage). Callers pass the same `{ label, sub, value, meta }` rows they always
 * have and pick a palette key — nothing configures recharts inline.
 *
 * None of these render their own empty state: <ChartCard isEmpty> already swaps
 * in a friendly message before the chart mounts, so an empty frame is
 * impossible. No legends either — every series here is single, and a legend box
 * for one series is pure clutter; the card title names it.
 */

/** Shared hover card. Shows the long label, the formatted value and any meta. */
function ChartTooltip({ active, payload, format }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-md">
      <p className="text-xs font-medium capitalize text-gray-500">{d.sub || d.label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900">
        {formatValue(d.value, format)}
      </p>
      {d.meta && <p className="mt-0.5 text-xs text-gray-400">{d.meta}</p>}
    </div>
  );
}

/** Axis ticks stay short so they never collide — the tooltip carries the detail. */
function compactTick(value, format) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  if (Math.abs(n) >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(Math.round(n * 10) / 10);
}

const truncate = (s, max) => {
  const str = String(s ?? '');
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
};

/**
 * Area line — for anything measured against time (daily revenue, profit,
 * expenses, wastage). A continuous measure over ordered dates reads as a shape,
 * which is what an area gives you and a row of separate bars does not.
 */
export function TrendChart({ data, color = 'blue', format = 'currency', height = 200 }) {
  const stroke = pickColor(color);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RcAreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={12} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => compactTick(v, format)} />
        <RcTooltip cursor={{ stroke: '#d1d5db', strokeWidth: 1 }} content={(p) => <ChartTooltip {...p} format={format} />} />
        {/* Flat low-opacity fill, not a gradient — the design language has none. */}
        <Area
          type="monotone"
          dataKey="value"
          stroke={stroke}
          strokeWidth={2}
          fill={stroke}
          fillOpacity={0.12}
          activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }}
          {...ANIM}
        />
      </RcAreaChart>
    </ResponsiveContainer>
  );
}

/**
 * Vertical bars — for ordered categorical buckets (hour of day, weekday, prep
 * time band). Discrete buckets should be compared, not connected.
 * Negative bars (a loss-making day) pick up the loss tone automatically.
 */
export function BarChart({ data, color = 'blue', format = 'currency', height = 200 }) {
  const fill = pickColor(color);
  const hasNegative = data.some((d) => Number(d.value) < 0);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RcBarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={4} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => compactTick(v, format)} />
        <RcTooltip cursor={{ fill: '#f9fafb' }} content={(p) => <ChartTooltip {...p} format={format} />} />
        <Bar dataKey="value" fill={fill} radius={[4, 4, 0, 0]} maxBarSize={44} {...ANIM}>
          {hasNegative &&
            data.map((d, i) => (
              <Cell key={i} fill={Number(d.value) < 0 ? CHART_COLORS.red : fill} />
            ))}
        </Bar>
      </RcBarChart>
    </ResponsiveContainer>
  );
}

/**
 * Horizontal ranked bars — for composition and "who is biggest" questions.
 * This is deliberately the answer instead of a pie: a ranked bar stays readable
 * at twelve slices and can be compared by length rather than by angle.
 */
export function RankBars({ data, color = 'slate', format = 'currency', limit = 12 }) {
  const rows = data.slice(0, limit);
  const fill = pickColor(color);
  // One comfortable row height, with a floor so a two-row chart is not a sliver.
  const height = Math.max(120, rows.length * 34 + 16);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RcBarChart data={rows} layout="vertical" margin={{ top: 0, right: 64, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID_STROKE} horizontal={false} />
        <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v) => compactTick(v, format)} />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ ...AXIS_TICK, fontSize: 12, fill: '#374151' }}
          tickLine={false}
          axisLine={false}
          width={124}
          tickFormatter={(v) => truncate(v, 18)}
        />
        <RcTooltip cursor={{ fill: '#f9fafb' }} content={(p) => <ChartTooltip {...p} format={format} />} />
        <Bar dataKey="value" fill={fill} radius={[0, 4, 4, 0]} maxBarSize={18} {...ANIM}>
          {/* Direct label at the bar end — the value without needing a hover. */}
          <LabelList
            dataKey="value"
            position="right"
            className="fill-gray-500"
            style={{ fontSize: 11 }}
            formatter={(v) => formatValue(v, format)}
          />
        </Bar>
      </RcBarChart>
    </ResponsiveContainer>
  );
}

/** Popularity vs profitability quadrant. */
export function ScatterChart({ data, xLabel, yLabel, height = 260 }) {
  const points = data.filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y));
  const maxX = Math.max(1, ...points.map((d) => d.x));
  const maxY = Math.max(1, ...points.map((d) => d.y));
  const minY = Math.min(0, ...points.map((d) => d.y));
  const midX = maxX / 2;
  const midY = minY + (maxY - minY) / 2;
  const toneOf = (d) =>
    d.x >= midX && d.y >= midY ? CHART_COLORS.emerald : d.x < midX && d.y < midY ? CHART_COLORS.red : '#9ca3af';

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <RcScatterChart margin={{ top: 8, right: 12, left: -12, bottom: 4 }}>
          <CartesianGrid stroke={GRID_STROKE} />
          <XAxis type="number" dataKey="x" name={xLabel} tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <YAxis type="number" dataKey="y" name={yLabel} tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => `${Math.round(v)}%`} />
          <ZAxis range={[42, 42]} />
          <RcTooltip
            cursor={{ strokeDasharray: '3 3', stroke: '#d1d5db' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              return (
                <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-md">
                  <p className="text-xs font-medium text-gray-900">{d.label}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {formatValue(d.x, 'number')} sold · {d.y.toFixed(1)}% margin
                  </p>
                </div>
              );
            }}
          />
          <Scatter data={points} {...ANIM}>
            {points.map((d, i) => (
              <Cell key={i} fill={toneOf(d)} fillOpacity={0.75} />
            ))}
          </Scatter>
        </RcScatterChart>
      </ResponsiveContainer>
      {/* Identity here is genuinely colour-coded, so it gets a key. */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
        <span>{xLabel} →</span>
        <span className="inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: CHART_COLORS.emerald }} /> Stars
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: CHART_COLORS.red }} /> Underperformers
          </span>
        </span>
        <span>↑ {yLabel}</span>
      </div>
    </div>
  );
}

/** 4. Business Insights — short written cards, not a stat dump. */
export function BusinessInsights({ insights }) {
  if (!insights?.length) return null;
  return (
    <div className="animate-in fade-in duration-300">
      <div className="mb-4 flex items-center gap-2">
        <Lightbulb className="h-5 w-5 text-amber-500" />
        <h2 className="text-base font-semibold text-gray-900">Business Insights</h2>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {insights.map((insight, i) => (
          <div key={i} className={`rounded-2xl border p-5 shadow-sm ${TONE_CARD[insight.tone] || TONE_CARD.neutral}`}>
            <p className="text-sm font-semibold text-gray-900">{insight.title}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-600">{insight.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Badge({ value }) {
  const key = String(value || '').toLowerCase();
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium capitalize ${STATUS_TONE[key] || 'bg-gray-100 text-gray-600'}`}>
      {value || '—'}
    </span>
  );
}

/** 5. Detailed table — sticky header, searchable, sortable, CSV export. */
export function DataTable({ title, columns, rows, empty, csvName, truncated, limit, onExportAll }) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: null, dir: 'desc' });

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let out = needle
      ? rows.filter((row) => columns.some((c) => String(row[c.key] ?? '').toLowerCase().includes(needle)))
      : rows.slice();
    if (sort.key) {
      const col = columns.find((c) => c.key === sort.key);
      const numeric = ['currency', 'number', 'percent'].includes(col?.type);
      out.sort((a, b) => {
        let av = a[sort.key];
        let bv = b[sort.key];
        if (col?.type === 'datetime') { av = new Date(av || 0).getTime(); bv = new Date(bv || 0).getTime(); }
        else if (numeric) { av = Number(av) || 0; bv = Number(bv) || 0; }
        else { av = String(av ?? '').toLowerCase(); bv = String(bv ?? '').toLowerCase(); }
        if (av < bv) return sort.dir === 'asc' ? -1 : 1;
        if (av > bv) return sort.dir === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return out;
  }, [rows, columns, search, sort]);

  const toggleSort = (key) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));

  /**
   * A download is the complete table, never the truncated view: when the server
   * capped this table, re-ask for it uncapped before writing the file.
   */
  const exportCsv = async () => {
    let source = visible;
    if (truncated && onExportAll) {
      const full = await onExportAll();
      if (full?.length) {
        const needle = search.trim().toLowerCase();
        source = needle
          ? full.filter((row) => columns.some((c) => String(row[c.key] ?? '').toLowerCase().includes(needle)))
          : full;
      }
    }
    const headers = columns.map((c) => c.label);
    const csvRows = source.map((row) =>
      Object.fromEntries(columns.map((c) => [c.label, c.type === 'datetime' ? formatNepalDateTime(row[c.key]) : row[c.key] ?? '']))
    );
    const blob = new Blob([toCsv(headers, csvRows)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${csvName || 'report'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6 animate-in fade-in duration-300">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <span className="text-xs text-gray-400">
            {visible.length} row{visible.length === 1 ? '' : 's'}
            {truncated ? ' shown' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search this table…"
              className="h-10 w-full rounded-lg border border-gray-300 pl-9 pr-3 text-sm text-gray-900"
            />
          </div>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!visible.length}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            <Download className="h-4 w-4" /> CSV
          </button>
        </div>
      </div>

      {/* A capped list must never read as a complete one. */}
      {truncated && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            This period has more rows than the table shows. Only the most recent{' '}
            {(limit || visible.length).toLocaleString()} are listed here — the CSV export contains every row.
          </p>
        </div>
      )}

      {!visible.length ? (
        <p className="py-12 text-center text-sm text-gray-500">
          {search.trim() ? `Nothing in this table matches “${search.trim()}”.` : empty}
        </p>
      ) : (
        <div className="max-h-[560px] overflow-auto rounded-xl border border-gray-100">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                {columns.map((c) => (
                  <th key={c.key} className={`whitespace-nowrap px-4 py-3 font-semibold ${c.align === 'right' ? 'text-right' : ''}`}>
                    <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-gray-700">
                      {c.label}
                      <ArrowUpDown className={`h-3 w-3 ${sort.key === c.key ? 'text-gray-700' : 'text-gray-300'}`} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50/70">
                  {columns.map((c) => (
                    <td key={c.key} className={`whitespace-nowrap px-4 py-3.5 ${c.align === 'right' ? `text-right tabular-nums font-medium ${c.type === 'currency' ? financialToneClass({ label: c.label, value: row[c.key], tone: c.tone }) : 'text-gray-900'}` : 'text-gray-600'}`}>
                      {c.type === 'badge' || c.type === 'status'
                        ? <Badge value={row[c.key]} />
                        : formatValue(row[c.key], c.type)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Honest footnotes about metrics this schema cannot support. */
export function DataNotes({ notes }) {
  if (!notes?.length) return null;
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 text-sm text-gray-500">
      <p className="mb-2 font-medium text-gray-600">About this data</p>
      <ul className="space-y-1.5">
        {notes.map((note, i) => (
          <li key={i} className="flex gap-2 leading-relaxed">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray-300" />
            {note}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChartGrid({ children }) {
  return <div className="grid gap-5 lg:grid-cols-2">{children}</div>;
}

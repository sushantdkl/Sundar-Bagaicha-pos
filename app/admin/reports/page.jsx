'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { Calendar, Download, RotateCcw, Search } from 'lucide-react';
import {
  QuickChips, KpiCards, ChartCard, ChartGrid, BarChart, TrendChart, RankBars,
  ScatterChart, BusinessInsights, DataTable, DataNotes, formatValue,
} from '@/components/admin/report-kit';
import DonutChart from '@/components/admin/donut-chart';
import { orderTypeLabel } from '@/lib/order-types.js';
import DateInput from '@/components/ui/date-input.jsx';

const DONUT_COLORS = ['#0f172a', '#2563eb', '#059669', '#d97706', '#db2777', '#7c3aed', '#0891b2', '#ea580c'];

function DonutBlock({ rows, centerLabel = 'Total', format = 'currency' }) {
  const segments = (rows || [])
    .filter((r) => Number(r.value) > 0)
    .map((r, i) => ({ label: r.label, value: Number(r.value), color: DONUT_COLORS[i % DONUT_COLORS.length] }));
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (!segments.length) return null;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center sm:gap-8">
      <DonutChart
        segments={segments}
        centerLabel={centerLabel}
        centerValue={formatValue(total, format)}
        size={170}
      />
      <div className="space-y-1.5 text-sm">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: seg.color }} />
            <span className="text-gray-600">{seg.label}</span>
            <span className="font-semibold tabular-nums text-gray-900">{formatValue(seg.value, format)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Reports analytics centre.
 *
 * Every tab follows the same shape: quick insight chips → KPI cards →
 * charts (one per card) → Business Insights → detailed table(s).
 * All data comes from /api/admin/reports, which computes it from the
 * live schema; nothing on this page is hard-coded.
 *
 * There is no Branch filter because this deployment is single-location —
 * no branch/outlet entity exists anywhere in the schema. There is no
 * Customer filter because orders.customer_id is never populated, and no
 * Supplier filter because suppliers are free-text on expenses only (the
 * Suppliers tab groups by that text instead).
 */

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'sales', label: 'Sales' },
  { id: 'finance', label: 'Finance' },
  { id: 'orders', label: 'Orders' },
  { id: 'menu', label: 'Menu' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'customers', label: 'Customers' },
  { id: 'employees', label: 'Employees' },
  { id: 'tables', label: 'Tables' },
  { id: 'reservations', label: 'Reservations' },
  { id: 'suppliers', label: 'Suppliers' },
];

const PERIODS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Last 7 days' },
  { id: 'month', label: 'This month' },
  { id: 'custom', label: 'Custom' },
];

const allZero = (series) => !series?.length || series.every((d) => !d.value);

function selectClass() {
  return 'h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700';
}

export default function ReportsPage() {
  const [tab, setTab] = useState('overview');
  const [period, setPeriod] = useState('week');
  const [custom, setCustom] = useState({ start: '', end: '' });
  const [filters, setFilters] = useState({ businessDayId: '', employeeId: '', categoryId: '', foodGroup: '', paymentMethod: '', orderType: '', search: '' });
  const [searchDraft, setSearchDraft] = useState('');
  const [options, setOptions] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ tab, period });
    if (period === 'custom' && custom.start && custom.end) {
      params.set('startDate', custom.start);
      params.set('endDate', custom.end);
    }
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    params.set('withOptions', '1');
    return params.toString();
  }, [tab, period, custom, filters]);

  const load = useCallback(async () => {
    if (period === 'custom' && (!custom.start || !custom.end)) return;
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('pos_token');
      const res = await fetch(`/api/admin/reports?${query}`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'The report could not be built.');
      setData(body);
      if (body.options) setOptions(body.options);
    } catch (err) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [query, period, custom.start, custom.end]);

  useEffect(() => { load(); }, [load]);

  const resetFilters = () => {
    setFilters({ businessDayId: '', employeeId: '', categoryId: '', foodGroup: '', paymentMethod: '', orderType: '', search: '' });
    setSearchDraft('');
  };
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  /** Re-fetch this tab with the detail caps lifted. */
  const fetchFullTab = useCallback(async () => {
    const token = localStorage.getItem('pos_token');
    const res = await fetch(`/api/admin/reports?${query}&export=1`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'The export could not be built.');
    return body;
  }, [query]);

  /** Rows for one table, uncapped — used by that table's own CSV button. */
  const fetchFullTable = useCallback(
    async (tableId) => {
      const body = await fetchFullTab();
      const all = body.tables || (body.table ? [{ id: 'detail', ...body.table }] : []);
      return (all.find((t) => t.id === tableId) || all[0])?.rows || [];
    },
    [fetchFullTab]
  );

  /**
   * Export the whole active tab: KPIs, every chart series and every table.
   * Pulls the uncapped payload first so a download is never the truncated view.
   */
  const exportTab = async () => {
    if (!data) return;
    let full = data;
    try {
      full = await fetchFullTab();
    } catch {
      // Fall back to what is on screen rather than failing the download.
    }
    const blob = new Blob([buildReportWorkbook({
      tab,
      tabLabel: TABS.find((t) => t.id === tab)?.label || tab,
      period,
      filters,
      data: full,
    })], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${tab}-report-${data.range?.start || 'export'}.xls`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Reports</h1>
            <p className="mt-1 flex items-center gap-2 text-sm text-gray-500">
              <Calendar className="h-4 w-4" />
              {data?.range?.label || 'Choose a date range to begin'}
            </p>
          </div>
          <button
            type="button"
            onClick={exportTab}
            disabled={!data}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
          >
            <Download className="h-4 w-4" /> Export {TABS.find((t) => t.id === tab)?.label}
          </button>
        </div>
      </header>

      <div className="space-y-6 bg-gray-50 p-4 sm:p-6 lg:p-8">
        {/* Shared filter bar — applies to whichever tab is active */}
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPeriod(p.id)}
                className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                  period === p.id ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {p.label}
              </button>
            ))}
            {period === 'custom' && (
              <div className="flex flex-wrap items-center gap-2">
                <DateInput value={custom.start} onChange={(v) => setCustom({ ...custom, start: v })} className={selectClass()} />
                <span className="text-sm text-gray-400">to</span>
                <DateInput value={custom.end} onChange={(v) => setCustom({ ...custom, end: v })} className={selectClass()} />
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
            <select value={filters.businessDayId} onChange={(e) => setFilters({ ...filters, businessDayId: e.target.value })} className={selectClass()}>
              <option value="">Calendar date range</option>
              {(options?.businessDays || []).map((day) => <option key={day.id} value={day.id}>Business Day {String(day.business_date).slice(0, 10)} · {day.status}</option>)}
            </select>
            <select value={filters.employeeId} onChange={(e) => setFilters({ ...filters, employeeId: e.target.value })} className={selectClass()}>
              <option value="">All employees</option>
              {(options?.employees || []).map((e) => (
                <option key={e.id} value={e.id}>{e.name} · {e.role}</option>
              ))}
            </select>
            <select value={filters.foodGroup} onChange={(e) => setFilters({ ...filters, foodGroup: e.target.value })} className={selectClass()}>
              <option value="">All master categories</option>
              {(options?.foodGroups || []).map((g) => (
                <option key={g.id} value={g.id}>{g.label}</option>
              ))}
            </select>
            <select value={filters.categoryId} onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })} className={selectClass()}>
              <option value="">All categories</option>
              {(options?.categories || []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select value={filters.paymentMethod} onChange={(e) => setFilters({ ...filters, paymentMethod: e.target.value })} className={selectClass()}>
              <option value="">All payment methods</option>
              {(options?.paymentMethods || []).map((m) => (
                <option key={m} value={m} className="capitalize">{m}</option>
              ))}
            </select>
            <select value={filters.orderType} onChange={(e) => setFilters({ ...filters, orderType: e.target.value })} className={selectClass()}>
              <option value="">All order types</option>
              {(options?.orderTypes || []).map((t) => (
                <option key={t} value={t}>{orderTypeLabel(t)}</option>
              ))}
            </select>
            <form
              onSubmit={(e) => { e.preventDefault(); setFilters({ ...filters, search: searchDraft.trim() }); }}
              className="relative min-w-[200px] flex-1"
            >
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                onBlur={() => setFilters((f) => ({ ...f, search: searchDraft.trim() }))}
                placeholder="Search bills, orders, tables…"
                className="h-10 w-full rounded-lg border border-gray-300 pl-9 pr-3 text-sm text-gray-900"
              />
            </form>
            {activeFilterCount > 0 && (
              <button type="button" onClick={resetFilters} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-600 hover:bg-gray-50">
                <RotateCcw className="h-3.5 w-3.5" /> Clear {activeFilterCount}
              </button>
            )}
          </div>
        </div>

        {/* Tab bar — horizontally scrollable on mobile */}
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div className="flex w-max gap-1 rounded-xl border border-gray-200 bg-white p-1 shadow-sm sm:w-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                  tab === t.id ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {period === 'custom' && (!custom.start || !custom.end) && (
          <p className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
            Pick a start and end date above to build this report.
          </p>
        )}

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
            {error} <button type="button" onClick={load} className="ml-2 font-semibold underline">Try again</button>
          </div>
        )}

        {loading && !data && <p className="py-24 text-center text-sm text-gray-500">Building your report…</p>}

        {data && (
          <div className={`space-y-6 ${loading ? 'opacity-60' : ''}`}>
            <QuickChips chips={data.chips} />
            <KpiCards kpis={data.kpis} />
            <ReportContents data={data} />
            <TabCharts tab={tab} data={data} />
            <BusinessInsights insights={data.insights} />
            {(data.tables || (data.table ? [{ id: 'detail', ...data.table }] : [])).map((t) => (
              <DataTable
                key={t.id}
                title={t.title || 'Details'}
                columns={t.columns}
                rows={t.rows}
                empty={t.empty}
                truncated={t.truncated}
                limit={t.limit}
                onExportAll={() => fetchFullTable(t.id)}
                csvName={`${tab}-${t.id}`}
              />
            ))}
            <DataNotes notes={data.notes} />
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function humanKey(value) {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatExportCell(value, type) {
  if (type === 'datetime' && value) return new Date(value).toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' });
  return value ?? '';
}

function tableHtml({ title, headers, rows }) {
  return `
    <tr></tr>
    <tr><td colspan="${Math.max(1, headers.length)}" style="font-weight:bold;background:#d9eaf7">${escapeHtml(title)}</td></tr>
    <tr>${headers.map((header) => `<th style="font-weight:bold;background:#eeeeee">${escapeHtml(header)}</th>`).join('')}</tr>
    ${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}
  `;
}

function flattenObjectRows(object, prefix = '') {
  return Object.entries(object || {}).flatMap(([key, value]) => {
    const label = prefix ? `${prefix} ${humanKey(key)}` : humanKey(key);
    if (value && typeof value === 'object' && !Array.isArray(value)) return flattenObjectRows(value, label);
    return [[label, value]];
  });
}

function buildReportWorkbook({ tabLabel, period, filters, data }) {
  const range = data.range || {};
  const activeFilters = Object.entries(filters || {}).filter(([, value]) => value);
  const tables = data.tables || (data.table ? [{ id: 'detail', ...data.table }] : []);
  const sections = [];

  sections.push(`<tr><td colspan="12" style="font-size:20px;font-weight:bold">${escapeHtml(tabLabel)} Report</td></tr>`);
  sections.push(`<tr><td style="font-weight:bold">Report</td><td>${escapeHtml(tabLabel)}</td></tr>`);
  sections.push(`<tr><td style="font-weight:bold">Period</td><td>${escapeHtml(range.label || period)}</td></tr>`);
  sections.push(`<tr><td style="font-weight:bold">Date Range</td><td>${escapeHtml(range.start || '')}</td><td>${escapeHtml(range.end || '')}</td></tr>`);
  sections.push(`<tr><td style="font-weight:bold">Exported At</td><td>${escapeHtml(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }))}</td></tr>`);

  if (activeFilters.length) {
    sections.push(tableHtml({ title: 'Active Filters', headers: ['Filter', 'Value'], rows: activeFilters.map(([key, value]) => [humanKey(key), value]) }));
  }
  sections.push(tableHtml({
    title: 'KPI Summary',
    headers: ['Metric', 'Value', 'Format', 'Detail'],
    rows: (data.kpis || []).map((kpi) => [kpi.label, kpi.value ?? '', kpi.format || '', kpi.sub || '']),
  }));
  Object.entries(data.charts || {}).forEach(([name, series]) => {
    sections.push(tableHtml({
      title: `${humanKey(name)} Data`,
      headers: ['Label', 'Value', 'Detail'],
      rows: (series || []).map((row) => [row.sub || row.label, row.value ?? '', row.meta || '']),
    }));
  });
  if (data.insights?.length) {
    sections.push(tableHtml({
      title: 'Business Insights',
      headers: ['Title', 'Insight', 'Tone'],
      rows: data.insights.map((row) => [row.title, row.body, row.tone || '']),
    }));
  }
  if (data.reconciliation) {
    sections.push(tableHtml({ title: 'Reconciliation', headers: ['Metric', 'Value'], rows: flattenObjectRows(data.reconciliation) }));
  }
  tables.forEach((table) => {
    const columns = table.columns || [];
    sections.push(tableHtml({
      title: table.title || humanKey(table.id || 'Detail'),
      headers: columns.map((column) => column.label),
      rows: (table.rows || []).map((row) => columns.map((column) => formatExportCell(row[column.key], column.type))),
    }));
  });
  if (data.notes?.length) {
    sections.push(tableHtml({ title: 'Data Notes', headers: ['Note'], rows: data.notes.map((note) => [note]) }));
  }

  return `<!doctype html><html><head><meta charset="utf-8" /></head><body><table>${sections.join('')}</table></body></html>`;
}

function ReportContents({ data }) {
  const tables = data.tables || (data.table ? [data.table] : []);
  const chartCount = Object.keys(data.charts || {}).length;
  const rowCount = tables.reduce((sum, table) => sum + (table.rows?.length || 0), 0);
  const capped = tables.filter((table) => table.truncated).length;
  const items = [
    ['KPIs', data.kpis?.length || 0],
    ['Charts', chartCount],
    ['Tables', tables.length],
    ['Rows shown', rowCount],
    ['Capped tables', capped],
  ];

  return (
    <div className="grid gap-px overflow-hidden rounded-2xl border border-gray-200 bg-gray-200 shadow-sm sm:grid-cols-5">
      {items.map(([label, value]) => (
        <div key={label} className="bg-white px-4 py-3">
          <p className="text-xs text-gray-500">{label}</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">{value}</p>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Per-tab chart layouts — one chart per card, plenty of whitespace.   */
/* ------------------------------------------------------------------ */

function TabCharts({ tab, data }) {
  const c = data.charts || {};

  if (tab === 'overview') {
    return (
      <>
        <ChartGrid>
          <ChartCard title="Revenue Trend" hint="Settled bills per day" isEmpty={allZero(c.revenueTrend)} empty="No revenue was taken during the selected period.">
            <TrendChart data={c.revenueTrend} color="blue" />
          </ChartCard>
          <ChartCard title="Profit Trend" hint="Revenue less estimated food cost" isEmpty={allZero(c.profitTrend)} empty="There is no trading activity to derive profit from yet.">
            <TrendChart data={c.profitTrend} color="emerald" />
          </ChartCard>
        </ChartGrid>
        <ChartGrid>
          <ChartCard title="Top Selling Items" isEmpty={!c.topItems?.length} empty="No menu items were sold during the selected period.">
            <RankBars data={c.topItems} color="slate" />
          </ChartCard>
          <ChartCard title="Inventory Alerts" isEmpty={!data.alerts?.length} empty="Every tracked raw material is above its reorder level.">
            <div className="space-y-1">
              {(data.alerts || []).map((a, i) => (
                <div key={i} className="flex items-center justify-between border-b border-gray-50 py-2.5 last:border-0">
                  <span className="flex items-center gap-2.5 text-sm font-medium text-gray-800">
                    <span className={`h-2 w-2 rounded-full ${a.status === 'out' ? 'bg-red-500' : 'bg-amber-500'}`} />
                    {a.name}
                  </span>
                  <span className={`text-sm font-semibold tabular-nums ${a.status === 'out' ? 'text-red-600' : 'text-amber-600'}`}>
                    {a.quantity} {a.unit}
                  </span>
                </div>
              ))}
            </div>
          </ChartCard>
        </ChartGrid>
      </>
    );
  }

  if (tab === 'sales') {
    return (
      <>
        <ChartCard title="Revenue Trend" hint="Settled bills per day" isEmpty={allZero(c.revenueTrend)} empty="No revenue was taken during the selected period.">
          <TrendChart data={c.revenueTrend} color="blue" />
        </ChartCard>
        <ChartGrid>
          <ChartCard title="Sales by Hour" isEmpty={allZero(c.byHour)} empty="No bills were settled at any hour in this range.">
            <BarChart data={c.byHour} color="violet" />
          </ChartCard>
          <ChartCard title="Sales by Day of Week" isEmpty={allZero(c.byDay)} empty="There is not enough trading history to compare days.">
            <BarChart data={c.byDay} color="teal" />
          </ChartCard>
        </ChartGrid>
        <ChartGrid>
          <ChartCard title="Sales by Master Category" hint="Food, Beverages, Tobacco…" isEmpty={!c.byGroup?.length} empty="No items were sold in this period.">
            <DonutBlock rows={c.byGroup} centerLabel="Sales" />
          </ChartCard>
          <ChartCard title="Sales by Category" isEmpty={!c.byCategory?.length} empty="No categorised items were sold in this period.">
            <RankBars data={c.byCategory} color="blue" />
          </ChartCard>
        </ChartGrid>
        <ChartGrid>
          <ChartCard title="Sales by Payment Method" isEmpty={!c.byPayment?.length} empty="No payments were recorded against bills in this period.">
            <DonutBlock rows={c.byPayment} centerLabel="Paid" />
          </ChartCard>
          <ChartCard title="Sales by Waiter" isEmpty={!c.byWaiter?.length} empty="No orders in this period were assigned to a waiter.">
            <RankBars data={c.byWaiter} color="emerald" />
          </ChartCard>
        </ChartGrid>
        <ChartGrid>
          <ChartCard title="Sales by Order Type" isEmpty={!c.byOrderType?.length} empty="No orders were placed in this period.">
            <DonutBlock rows={c.byOrderType} centerLabel="Sales" />
          </ChartCard>
        </ChartGrid>
      </>
    );
  }

  if (tab === 'finance') {
    return (
      <>
        <ChartGrid>
          <ChartCard title="Expense Breakdown" hint="By category" isEmpty={!c.expenseBreakdown?.length} empty="No expenses were logged during the selected period.">
            <DonutBlock rows={c.expenseBreakdown} centerLabel="Spend" />
          </ChartCard>
          <ChartCard title="Profit Trend" hint="Revenue less expenses, per day" isEmpty={allZero(c.profitTrend)} empty="There is no revenue or expense activity to plot.">
            <TrendChart data={c.profitTrend} color="emerald" />
          </ChartCard>
        </ChartGrid>
        <ChartGrid>
          <ChartCard title="Monthly Revenue" hint="Whole trading history, not limited by the date filter" isEmpty={!c.monthlyRevenue?.length} empty="No bills have ever been settled.">
            <TrendChart data={c.monthlyRevenue} color="blue" />
          </ChartCard>
          <ChartCard title="Expense Trend" isEmpty={allZero(c.expenseTrend)} empty="No expenses were logged during the selected period.">
            <TrendChart data={c.expenseTrend} color="red" />
          </ChartCard>
        </ChartGrid>
      </>
    );
  }

  if (tab === 'orders') {
    return (
      <>
        <ChartGrid>
          <ChartCard title="Orders per Hour" isEmpty={allZero(c.perHour)} empty="No orders were placed in the selected period.">
            <BarChart data={c.perHour} color="violet" format="number" />
          </ChartCard>
          <ChartCard title="Order Types" isEmpty={!c.orderTypes?.length} empty="No orders were placed in the selected period.">
            <RankBars data={c.orderTypes} color="amber" format="number" />
          </ChartCard>
        </ChartGrid>
        <ChartGrid>
          <ChartCard title="Preparation Time" hint="Kitchen tickets, printed to completed" isEmpty={allZero(c.prepTime)} empty="No kitchen ticket in this period was marked complete.">
            <BarChart data={c.prepTime} color="teal" format="number" />
          </ChartCard>
          <ChartCard title="Serving Time" hint="Order placed to bill settled" isEmpty={allZero(c.serveTime)} empty="No order in this period was billed and settled.">
            <BarChart data={c.serveTime} color="blue" format="number" />
          </ChartCard>
        </ChartGrid>
      </>
    );
  }

  if (tab === 'menu') {
    return (
      <>
        <ChartCard title="Top Selling Items" hint="By revenue" isEmpty={!c.topItems?.length} empty="No menu items were sold during the selected period.">
          <RankBars data={c.topItems} color="slate" />
        </ChartCard>
        <ChartGrid>
          <ChartCard title="Master Category Performance" hint="Food, Beverages, Tobacco…" isEmpty={!c.groupPerformance?.length} empty="No items were sold in this period.">
            <RankBars data={c.groupPerformance} color="slate" />
          </ChartCard>
          <ChartCard title="Menu Category Performance" isEmpty={!c.categoryPerformance?.length} empty="No categorised items were sold in this period.">
            <RankBars data={c.categoryPerformance} color="blue" />
          </ChartCard>
        </ChartGrid>
        <ChartCard title="Average Selling Price" hint="Realised price per item, by category" isEmpty={!c.avgPrice?.length} empty="Nothing was sold, so there is no realised price to average.">
          <RankBars data={c.avgPrice} color="teal" />
        </ChartCard>
        <ChartCard title="Popularity vs Profit" hint="Each dot is a menu item — top right sells well and earns well" isEmpty={!c.matrix?.length} empty="No menu items were sold, so there is nothing to plot.">
          <ScatterChart data={c.matrix} xLabel="Quantity sold" yLabel="Margin %" />
        </ChartCard>
      </>
    );
  }

  if (tab === 'inventory') {
    return (
      <>
        <ChartGrid>
          <ChartCard title="Inventory Consumption" hint="Value deducted by orders" isEmpty={allZero(c.consumption)} empty="No stock has been deducted by orders in this period.">
            <TrendChart data={c.consumption} color="blue" />
          </ChartCard>
          <ChartCard title="Purchase Trend" hint="Value received into stock" isEmpty={allZero(c.purchases)} empty="No deliveries have been received in this period.">
            <TrendChart data={c.purchases} color="teal" />
          </ChartCard>
        </ChartGrid>
        <ChartGrid>
          <ChartCard title="Wastage Trend" isEmpty={allZero(c.wastage)} empty="No wastage has been logged in this period.">
            <TrendChart data={c.wastage} color="red" />
          </ChartCard>
          <ChartCard title="Stock Movement" hint="Quantity moved, by movement type" isEmpty={!c.movementTypes?.length} empty="No inventory movement has been recorded in this period.">
            <RankBars data={c.movementTypes} color="violet" format="number" />
          </ChartCard>
        </ChartGrid>
      </>
    );
  }

  if (tab === 'customers') {
    return (
      <>
        <ChartGrid>
          <ChartCard title="Customer Growth" hint="New profiles created per day" isEmpty={allZero(c.growth)} empty="No new customer profile was created in this period.">
            <TrendChart data={c.growth} color="violet" format="number" />
          </ChartCard>
          <ChartCard title="Visit Frequency" hint="How many customers sit in each visit band" isEmpty={allZero(c.frequency)} empty="No customer profiles exist yet.">
            <BarChart data={c.frequency} color="blue" format="number" />
          </ChartCard>
        </ChartGrid>
        <ChartGrid>
          <ChartCard title="Revenue by Customer" hint="Lifetime spend on the customer profile" isEmpty={!c.revenueByCustomer?.length} empty="No customer has any recorded spend.">
            <RankBars data={c.revenueByCustomer} color="slate" />
          </ChartCard>
          <ChartCard title="Top Customers" hint="By recorded visits" isEmpty={!c.topCustomers?.length} empty="No customer visits have been recorded.">
            <RankBars data={c.topCustomers} color="emerald" format="number" />
          </ChartCard>
        </ChartGrid>
      </>
    );
  }

  if (tab === 'employees') {
    return (
      <>
        <ChartGrid>
          <ChartCard title="Sales by Waiter" isEmpty={!c.salesByWaiter?.length} empty="No orders in this period were assigned to a waiter.">
            <RankBars data={c.salesByWaiter} color="emerald" />
          </ChartCard>
          <ChartCard title="Order Count by Waiter" isEmpty={!c.orderCount?.length} empty="No orders in this period were assigned to a waiter.">
            <RankBars data={c.orderCount} color="blue" format="number" />
          </ChartCard>
        </ChartGrid>
        <ChartCard title="Kitchen Speed" hint="Average minutes per completed ticket, per day" isEmpty={allZero(c.kitchenSpeed)} empty="No kitchen ticket in this period was marked complete.">
          <TrendChart data={c.kitchenSpeed} color="teal" format="minutes" />
        </ChartCard>
      </>
    );
  }

  if (tab === 'tables') {
    return (
      <>
        <ChartGrid>
          <ChartCard title="Table Usage" hint="Settled orders per table" isEmpty={allZero(c.usage)} empty="No table took a settled order in this period.">
            <BarChart data={c.usage} color="blue" format="number" />
          </ChartCard>
          <ChartCard title="Peak Occupancy" hint="Orders opened per hour" isEmpty={allZero(c.peakOccupancy)} empty="No orders were opened in this period.">
            <BarChart data={c.peakOccupancy} color="violet" format="number" />
          </ChartCard>
        </ChartGrid>
        <ChartCard title="Average Duration" hint="Minutes from order placed to bill settled, per table" isEmpty={allZero(c.duration)} empty="No sitting in this period ran through to a settled bill.">
          <BarChart data={c.duration} color="teal" format="minutes" />
        </ChartCard>
      </>
    );
  }

  if (tab === 'reservations') {
    return (
      <>
        <ChartCard title="Reservation Trend" isEmpty={allZero(c.trend)} empty="No reservations were booked for the selected period.">
          <TrendChart data={c.trend} color="violet" format="number" />
        </ChartCard>
        <ChartGrid>
          <ChartCard title="Arrival Hours" isEmpty={!c.arrivalHours?.length} empty="No reservation in this period has an arrival time on it.">
            <BarChart data={c.arrivalHours} color="blue" format="number" />
          </ChartCard>
          <ChartCard title="Busy Days" isEmpty={allZero(c.busyDays)} empty="No reservations were booked for the selected period.">
            <BarChart data={c.busyDays} color="amber" format="number" />
          </ChartCard>
        </ChartGrid>
      </>
    );
  }

  if (tab === 'suppliers') {
    return (
      <>
        <ChartCard title="Purchases Over Time" isEmpty={allZero(c.overTime)} empty="No purchases were recorded against a supplier in this period.">
          <TrendChart data={c.overTime} color="teal" />
        </ChartCard>
        <ChartGrid>
          <ChartCard title="Supplier Spend" isEmpty={!c.spend?.length} empty="No purchases were recorded against a supplier in this period.">
            <RankBars data={c.spend} color="slate" />
          </ChartCard>
          <ChartCard title="Top Suppliers" hint="By number of purchases" isEmpty={!c.topSuppliers?.length} empty="No supplier has been purchased from in this period.">
            <RankBars data={c.topSuppliers} color="blue" format="number" />
          </ChartCard>
        </ChartGrid>
      </>
    );
  }

  return null;
}

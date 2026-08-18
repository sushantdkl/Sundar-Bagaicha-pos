'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart, BusinessInsights, ChartCard, ChartGrid, DataNotes, DataTable,
  KpiCards, QuickChips, RankBars, TrendChart,
} from '@/components/admin/report-kit';

const timeChart = (key) => /(trend|time|daily|hour|day|speed|growth|consumption|purchase|wastage)/i.test(key);

export default function DetailedAnalytics({ tab, period, startDate, endDate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ tab, period });
    if (period === 'custom') {
      params.set('startDate', startDate);
      params.set('endDate', endDate);
    }
    return params.toString();
  }, [tab, period, startDate, endDate]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('pos_token');
      const response = await fetch(`/api/admin/reports?${query}`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not load this analytics section.');
      setData(body);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <div className="py-24 text-center text-sm text-gray-500">Building {tab} analytics...</div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error} <button type="button" onClick={load} className="ml-2 font-semibold underline">Try again</button></div>;
  if (!data) return null;

  const charts = Object.entries(data.charts || {}).filter(([, rows]) => Array.isArray(rows));
  const tables = data.tables || (data.table ? [{ id: 'detail', ...data.table }] : []);

  return (
    <div className={`space-y-6 ${loading ? 'opacity-60' : ''}`}>
      <QuickChips chips={data.chips} />
      <KpiCards kpis={data.kpis} />
      <ChartGrid>
        {charts.map(([key, rows]) => (
          <ChartCard key={key} title={key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())} isEmpty={!rows.length || rows.every((row) => !Number(row.value))} empty="No data for this chart in the selected period.">
            {timeChart(key) ? <TrendChart data={rows} color="blue" /> : rows.length > 12 ? <BarChart data={rows} color="slate" /> : <RankBars data={rows} color="slate" />}
          </ChartCard>
        ))}
      </ChartGrid>
      <BusinessInsights insights={data.insights} />
      {tables.map((table) => <DataTable key={table.id} title={table.title || 'Details'} columns={table.columns} rows={table.rows} empty={table.empty} truncated={table.truncated} limit={table.limit} />)}
      <DataNotes notes={data.notes} />
    </div>
  );
}

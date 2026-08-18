'use client';

import { useState } from 'react';
import {
  Activity, BarChart3, ChefHat, ClipboardCheck, PackageSearch, ShoppingBasket, Users,
} from 'lucide-react';
import AnalyticsHome, { AnalyticsKeyMetrics } from './analytics-home';

import { MenuPerformance, PaymentFinance } from './overview-commercial';
import {
  AttentionCenter, Controls,
  FloorAndReservations,
  InventorySupplier,
  LifecycleKitchen,
  LiveStatus,
  ManagementSummary,
  PeoplePerformance,
  RecentActivity,
} from './overview-operations';

export default function OverviewDashboard({
  data,
  transactionLoading = false,
  onTransactionPageChange,
  onTransactionPageSizeChange,
  onExportTransactions,
}) {
  const [view, setView] = useState('overview');
  const tabs = [
    ['overview', 'Overview', Activity],
    ['sales', 'Sales & Money', BarChart3],
    ['stock', 'Purchases & Stock', PackageSearch],
    ['menu', 'Menu & Tables', ShoppingBasket],
    ['kitchen', 'Kitchen', ChefHat],
    ['people', 'Customers & Team', Users],
    ['control', 'Controls & Activity', ClipboardCheck],
  ];

  return (
    <div>
      <AnalyticsKeyMetrics data={data} />
      <div className="mb-5 overflow-x-auto border-b border-gray-200" role="tablist" aria-label="Analytics views">
        <div className="flex min-w-max gap-1">
          {tabs.map(([id, label, Icon]) => (
            <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)} className={`inline-flex h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-[border-color,color,transform] duration-150 ease-out active:scale-[0.98] ${view === id ? 'border-gray-950 text-gray-950' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800'}`}>
              <Icon className="h-4 w-4" />{label}
            </button>
          ))}
        </div>
      </div>

      {view === 'overview' && <AnalyticsHome data={data} />}
      {view === 'sales' && <div className="space-y-5"><PaymentFinance data={data} /></div>}
      {view === 'stock' && <div className="space-y-5"><InventorySupplier data={data} /></div>}
      {view === 'menu' && <div className="space-y-5"><MenuPerformance data={data} /><FloorAndReservations data={data} /></div>}
      {view === 'kitchen' && <div className="space-y-5"><LiveStatus data={data} /><LifecycleKitchen data={data} /></div>}
      {view === 'people' && <div className="space-y-5"><PeoplePerformance data={data} /></div>}
      {view === 'control' && <div className="space-y-5">
        <AttentionCenter rows={data.attention} />
        <Controls data={data} />
        <RecentActivity
          data={data}
          pagination={data.transactionPagination}
          loading={transactionLoading}
          onPageChange={onTransactionPageChange}
          onPageSizeChange={onTransactionPageSizeChange}
          onExportTransactions={onExportTransactions}
        />
        <ManagementSummary data={data} />
      </div>}
    </div>
  );
}

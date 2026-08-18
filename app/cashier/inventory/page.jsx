'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PackagePlus, RefreshCw, Search, TriangleAlert, Warehouse } from 'lucide-react';
import AdminLayout from '@/components/admin/admin-layout';
import QuickRestockModal from '@/components/inventory/quick-restock-modal';
import { apiJson } from '@/lib/authed-fetch';
import { useToast } from '@/components/ui/toast';
import { friendlyFromError } from '@/lib/friendly-message';

const quantity = (item) => Number(item.quantity || 0);
const minimum = (item) => Number(item.min_stock_level || 0);

export default function CashierInventoryPage() {
  const { addToast } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [restockItem, setRestockItem] = useState(null);
  const [showRestock, setShowRestock] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiJson('/api/admin/inventory');
      setItems(data.items || []);
    } catch (error) {
      addToast(friendlyFromError(error, 'load_failed'));
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => [item.item_name, item.category, item.supplier]
      .some((value) => String(value || '').toLowerCase().includes(q)));
  }, [items, search]);

  const lowStock = items.filter((item) => quantity(item) <= minimum(item)).length;

  const openRestock = (item = null) => {
    setRestockItem(item);
    setShowRestock(true);
  };

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Inventory</h1>
            <p className="mt-1 text-sm text-gray-500">Check stock and record received quantities.</p>
          </div>
          <button type="button" onClick={() => openRestock()} className="flex h-11 items-center gap-2 bg-gray-950 px-4 text-sm font-semibold text-white hover:bg-black">
            <PackagePlus className="h-4 w-4" />
            Receive stock
          </button>
        </div>
      </header>

      <main className="space-y-5 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-3"><Warehouse className="h-5 w-5 text-indigo-600" /><span className="text-sm text-gray-500">Active materials</span></div>
            <p className="mt-2 text-2xl font-bold text-gray-900">{items.length}</p>
          </div>
          <div className="border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center gap-3"><TriangleAlert className="h-5 w-5 text-amber-700" /><span className="text-sm text-amber-800">Low stock</span></div>
            <p className="mt-2 text-2xl font-bold text-amber-950">{lowStock}</p>
          </div>
        </div>

        <div className="border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 p-4">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search material, category, or supplier" className="h-10 w-full border border-gray-300 pl-9 pr-3 text-sm outline-none focus:border-gray-900" />
            </div>
            <button type="button" onClick={load} aria-label="Refresh inventory" title="Refresh inventory" className="flex h-10 w-10 items-center justify-center border border-gray-300 text-gray-700 hover:bg-gray-50">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr><th className="px-4 py-3">Material</th><th className="px-4 py-3">Category</th><th className="px-4 py-3 text-right">On hand</th><th className="px-4 py-3 text-right">Minimum</th><th className="px-4 py-3">Supplier</th><th className="px-4 py-3 text-right">Action</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((item) => {
                  const low = quantity(item) <= minimum(item);
                  const unit = item.consumption_unit || item.unit || '';
                  return (
                    <tr key={item.id} className={low ? 'bg-amber-50/60' : 'hover:bg-gray-50'}>
                      <td className="px-4 py-3 font-medium text-gray-900">{item.item_name}</td>
                      <td className="px-4 py-3 text-gray-600">{item.category || '-'}</td>
                      <td className={`px-4 py-3 text-right font-semibold tabular-nums ${low ? 'text-amber-800' : 'text-gray-900'}`}>{quantity(item).toLocaleString()} {unit}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-500">{minimum(item).toLocaleString()} {unit}</td>
                      <td className="px-4 py-3 text-gray-600">{item.supplier || '-'}</td>
                      <td className="px-4 py-3 text-right"><button type="button" onClick={() => openRestock(item)} className="text-sm font-semibold text-indigo-700 hover:underline">Restock</button></td>
                    </tr>
                  );
                })}
                {!loading && filtered.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-500">No inventory items found.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {showRestock && (
        <QuickRestockModal
          item={restockItem}
          rawMaterials={items}
          onClose={() => { setShowRestock(false); setRestockItem(null); }}
          onRestocked={load}
        />
      )}
    </AdminLayout>
  );
}

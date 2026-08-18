'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import AdminLayout from '@/components/admin/admin-layout';
import { Plus, Edit, Trash2, Search, ChefHat, Upload, Trash } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import WastageModal from '@/components/inventory/wastage-modal';

function authedRequest(url, options = {}) {
  const token = localStorage.getItem('pos_token');
  return fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers },
  });
}

export default function StockManagement() {
  const { addToast } = useToast();
  const { confirm, prompt } = useConfirm();
  const [inventoryItems, setInventoryItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showWastage, setShowWastage] = useState(false);

  const [inventoryForm, setInventoryForm] = useState({
    item_name: '',
    quantity: '',
    unit: 'pieces',
    cost_per_unit: '',
    selling_price: '',
    min_stock_level: '',
    supplier: '',
    notes: '',
    category: '',
    purchase_unit: '',
    consumption_unit: '',
    conversion_factor: ''
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('pos_token');
      const invResponse = await fetch('/api/admin/inventory', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (invResponse.ok) {
        const data = await invResponse.json();
        setInventoryItems(data.items || []);
      }
      setLoading(false);
    } catch (error) {
      console.error('Error:', error);
      addToast(friendlyFromError(error, 'load_failed'));
      setLoading(false);
    }
  };

  const handleInventorySubmit = async (e) => {
    e.preventDefault();
    if (!String(inventoryForm.item_name || '').trim()) {
      addToast(friendlyMessage('validation', { description: 'Please enter the stock item name.' }));
      return;
    }
    if (inventoryForm.quantity === '' || Number.isNaN(Number(inventoryForm.quantity))) {
      addToast(friendlyMessage('validation', { description: 'Quantity should be a number.' }));
      return;
    }
    if (/[a-zA-Z]/.test(String(inventoryForm.quantity))) {
      addToast(friendlyMessage('validation', { description: 'Quantity should be a number, not letters.' }));
      return;
    }
    // Changing a stored quantity by hand is a stock adjustment — the ledger
    // refuses to record one without a reason.
    let adjustmentReason;
    if (editingItem && Number(editingItem.quantity) !== Number(inventoryForm.quantity)) {
      adjustmentReason = await prompt({
        title: 'Stock adjustment',
        message: `Why is ${editingItem.item_name} changing from ${editingItem.quantity} to ${inventoryForm.quantity}?`,
        label: 'Reason',
        placeholder: 'e.g. stock count correction',
        required: true,
        multiline: true,
      });
      if (adjustmentReason == null) return;
      if (!adjustmentReason?.trim()) {
        addToast(friendlyMessage('validation', { description: 'A reason is required to adjust stock by hand.' }));
        return;
      }
    }

    try {
      const token = localStorage.getItem('pos_token');
      const url = editingItem
        ? `/api/admin/inventory?id=${editingItem.id}`
        : '/api/admin/inventory';

      const response = await fetch(url, {
        method: editingItem ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          ...inventoryForm,
          id: editingItem?.id,
          adjustment_reason: adjustmentReason,
        })
      });

      if (response.ok) {
        fetchData();
        setShowForm(false);
        setEditingItem(null);
        resetInventoryForm();
        addToast(friendlyMessage('save_success', { description: 'Stock item was saved.' }));
      } else {
        const data = await response.json().catch(() => ({}));
        addToast(friendlyFromError(data, 'save_failed'));
      }
    } catch (error) {
      console.error('Error:', error);
      addToast(friendlyFromError(error, 'save_failed'));
    }
  };

  const resetInventoryForm = () => {
    setInventoryForm({
      item_name: '',
      quantity: '',
      unit: 'pieces',
      cost_per_unit: '',
      selling_price: '',
      min_stock_level: '',
      supplier: '',
      notes: '',
      category: '',
      purchase_unit: '',
      consumption_unit: '',
      conversion_factor: ''
    });
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setInventoryForm({
      item_name: item.item_name,
      quantity: item.quantity,
      unit: item.unit,
      cost_per_unit: item.cost_per_unit,
      selling_price: item.selling_price || '',
      min_stock_level: item.min_stock_level || '',
      supplier: item.supplier || '',
      notes: item.notes || '',
      category: item.category || '',
      purchase_unit: item.purchase_unit || '',
      consumption_unit: item.consumption_unit || '',
      conversion_factor: item.conversion_factor || ''
    });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: 'Remove item?',
      message: 'Remove this item? Items with history are archived instead of deleted.',
      tone: 'delete',
    });
    if (!ok) return;
    try {
      const token = localStorage.getItem('pos_token');
      const res = await fetch(`/api/admin/inventory?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        addToast(friendlyFromError(data, 'save_failed'));
        return;
      }
      addToast(friendlyMessage('save_success', { description: data.message }));
      fetchData();
    } catch (error) {
      console.error('Error:', error);
      addToast(friendlyFromError(error, 'save_failed'));
    }
  };

  const filteredInventory = inventoryItems.filter(item =>
    item.item_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStockStatus = (quantity, minLevel) => {
    if (quantity <= minLevel) return { label: 'Critical', color: 'text-red-600', bg: 'bg-red-50' };
    if (quantity <= minLevel * 2) return { label: 'Low', color: 'text-yellow-600', bg: 'bg-yellow-50' };
    return { label: 'Good', color: 'text-green-600', bg: 'bg-green-50' };
  };

  return (
    <AdminLayout>
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 lg:px-8 py-5 sm:py-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Raw Stock Items</h1>
            <p className="text-gray-500 mt-1 text-sm sm:text-base">
              Add and edit raw materials. See <Link href="/admin/inventory" className="underline">Inventory Command Center</Link> for stock health & reports.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 w-full sm:w-auto">
            <Link
              href="/admin/recipes"
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 font-semibold text-sm"
            >
              <ChefHat className="w-4 h-4" /> Recipes
            </Link>
            <Link
              href="/admin/stock/import"
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 font-semibold text-sm"
            >
              <Upload className="w-4 h-4" /> Import
            </Link>
            <button
              onClick={() => setShowWastage(true)}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 font-semibold text-sm"
            >
              <Trash className="w-4 h-4" /> Log Wastage
            </button>
            <button
              onClick={() => {
                setShowForm(true);
                setEditingItem(null);
                resetInventoryForm();
              }}
              className="flex items-center justify-center space-x-2 px-4 py-2.5 bg-gray-900 text-white rounded-xl hover:bg-gray-800 font-semibold"
            >
              <Plus className="w-5 h-5" />
              <span>Add Item</span>
            </button>
          </div>
        </div>
      </header>

      {showWastage && (
        <WastageModal request={authedRequest} onClose={() => setShowWastage(false)} onLogged={fetchData} />
      )}

      <div className="p-4 sm:p-6 lg:p-8 bg-gray-50">
        {/* Search Bar */}
        <div className="bg-white rounded-xl sm:rounded-2xl shadow-lg p-3 sm:p-6 mb-4 sm:mb-6">
          <div className="relative">
            <Search className="w-5 h-5 absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search inventory..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 sm:pl-12 pr-4 py-2.5 sm:py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
            />
          </div>
        </div>

        {loading ? (
          <div className="text-center py-16">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-purple-500 border-t-transparent mx-auto"></div>
            <p className="text-gray-600 mt-4">Loading...</p>
          </div>
        ) : (
          <>
            {/* Mobile card list */}
            <div className="md:hidden space-y-3">
              {filteredInventory.length > 0 ? (
                filteredInventory.map((item) => {
                  const status = getStockStatus(item.quantity, item.min_stock_level || 5);
                  const totalValue = item.quantity * item.cost_per_unit;
                  return (
                    <div key={item.id} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0">
                          <h3 className="font-bold text-gray-900 truncate">{item.item_name}</h3>
                          <p className="text-xs text-gray-500">{item.supplier || 'No supplier'}</p>
                        </div>
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold flex-shrink-0 ${status.color} ${status.bg}`}>
                          {status.label}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                        <div><span className="text-gray-500">Qty:</span> <span className="font-semibold text-gray-900">{item.quantity} {item.unit}</span></div>
                        <div><span className="text-gray-500">Cost:</span> <span className="font-semibold text-gray-900">Rs {item.cost_per_unit.toFixed(0)}</span></div>
                        <div className="col-span-2"><span className="text-gray-500">Value:</span> <span className="font-semibold text-gray-900">Rs {totalValue.toFixed(0)}</span></div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleEdit(item)} className="flex-1 py-2 text-blue-600 bg-blue-50 rounded-lg text-sm font-semibold">Edit</button>
                        <button onClick={() => handleDelete(item.id)} className="flex-1 py-2 text-red-600 bg-red-50 rounded-lg text-sm font-semibold">Delete</button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="bg-white rounded-xl p-10 text-center text-gray-500">No inventory items found</div>
              )}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block bg-white rounded-2xl shadow-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px]">
                  <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
                    <tr>
                      <th className="px-6 py-4 text-left font-bold">Item Name</th>
                      <th className="px-6 py-4 text-left font-bold">Quantity</th>
                      <th className="px-6 py-4 text-left font-bold">Unit</th>
                      <th className="px-6 py-4 text-left font-bold">Cost/Unit</th>
                      <th className="px-6 py-4 text-left font-bold">Selling Price</th>
                      <th className="px-6 py-4 text-left font-bold">Total Value</th>
                      <th className="px-6 py-4 text-left font-bold">Status</th>
                      <th className="px-6 py-4 text-left font-bold">Supplier</th>
                      <th className="px-6 py-4 text-right font-bold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredInventory.length > 0 ? (
                      filteredInventory.map((item) => {
                        const status = getStockStatus(item.quantity, item.min_stock_level || 5);
                        const totalValue = item.quantity * item.cost_per_unit;
                        return (
                          <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-6 py-4 font-semibold text-gray-900">{item.item_name}</td>
                            <td className="px-6 py-4 text-gray-900">{item.quantity}</td>
                            <td className="px-6 py-4 text-gray-700">{item.unit}</td>
                            <td className="px-6 py-4 text-gray-900">Rs {item.cost_per_unit.toFixed(2)}</td>
                            <td className="px-6 py-4 text-gray-900">
                              {item.selling_price ? `Rs ${item.selling_price.toFixed(2)}` : '-'}
                            </td>
                            <td className="px-6 py-4 font-semibold text-gray-900">Rs {totalValue.toFixed(2)}</td>
                            <td className="px-6 py-4">
                              <span className={`px-3 py-1 rounded-full text-xs font-bold ${status.color} ${status.bg}`}>
                                {status.label}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-gray-700">{item.supplier || '-'}</td>
                            <td className="px-6 py-4 text-right">
                              <button
                                onClick={() => handleEdit(item)}
                                className="text-blue-600 hover:text-blue-800 mr-3"
                              >
                                <Edit className="w-5 h-5" />
                              </button>
                              <button
                                onClick={() => handleDelete(item.id)}
                                className="text-red-600 hover:text-red-800"
                              >
                                <Trash2 className="w-5 h-5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan="9" className="px-6 py-20 text-center text-gray-500">
                          No inventory items found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 rounded-t-2xl">
              <h2 className="text-2xl font-bold text-gray-900">
                {editingItem ? 'Edit' : 'Add'} Inventory Item
              </h2>
            </div>

            <form onSubmit={handleInventorySubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-2">Item Name *</label>
                  <input
                    type="text"
                    required
                    value={inventoryForm.item_name}
                    onChange={(e) => setInventoryForm({...inventoryForm, item_name: e.target.value})}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 text-gray-900"
                    placeholder="e.g., Coca Cola, Chicken Breast"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-2">Category</label>
                  <input
                    type="text"
                    value={inventoryForm.category}
                    onChange={(e) => setInventoryForm({...inventoryForm, category: e.target.value})}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 text-gray-900"
                    placeholder="e.g., Produce, Meat, Spices"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-2">Quantity *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={inventoryForm.quantity}
                    onChange={(e) => setInventoryForm({...inventoryForm, quantity: e.target.value})}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 text-gray-900"
                    placeholder="0"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-2">Unit *</label>
                  <select
                    required
                    value={inventoryForm.unit}
                    onChange={(e) => setInventoryForm({...inventoryForm, unit: e.target.value})}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 text-gray-900"
                  >
                    <option value="pieces">Pieces</option>
                    <option value="kg">kg (Kilograms)</option>
                    <option value="L">L (Liters)</option>
                    <option value="packets">Packets</option>
                    <option value="boxes">Boxes</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-2">Cost Per Unit *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={inventoryForm.cost_per_unit}
                    onChange={(e) => setInventoryForm({...inventoryForm, cost_per_unit: e.target.value})}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 text-gray-900"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-2">Selling Price</label>
                  <input
                    type="number"
                    step="0.01"
                    value={inventoryForm.selling_price}
                    onChange={(e) => setInventoryForm({...inventoryForm, selling_price: e.target.value})}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 text-gray-900"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-2">Min Stock Level</label>
                  <input
                    type="number"
                    value={inventoryForm.min_stock_level}
                    onChange={(e) => setInventoryForm({...inventoryForm, min_stock_level: e.target.value})}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 text-gray-900"
                    placeholder="5"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-2">Supplier</label>
                  <input
                    type="text"
                    value={inventoryForm.supplier}
                    onChange={(e) => setInventoryForm({...inventoryForm, supplier: e.target.value})}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 text-gray-900"
                    placeholder="Supplier name"
                  />
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold uppercase text-gray-400 mb-3">BOM Unit Conversion (for Recipe Builder)</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-900 mb-2">Purchase Unit</label>
                    <input
                      type="text"
                      value={inventoryForm.purchase_unit}
                      onChange={(e) => setInventoryForm({...inventoryForm, purchase_unit: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 text-gray-900"
                      placeholder="e.g. kg, box_24"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-900 mb-2">Consumption Unit</label>
                    <input
                      type="text"
                      value={inventoryForm.consumption_unit}
                      onChange={(e) => setInventoryForm({...inventoryForm, consumption_unit: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 text-gray-900"
                      placeholder="e.g. grams, ml"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-900 mb-2">Conversion Factor</label>
                    <input
                      type="number"
                      step="any"
                      value={inventoryForm.conversion_factor}
                      onChange={(e) => setInventoryForm({...inventoryForm, conversion_factor: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 text-gray-900"
                      placeholder="e.g. 1000"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-900 mb-2">Notes</label>
                <textarea
                  value={inventoryForm.notes}
                  onChange={(e) => setInventoryForm({...inventoryForm, notes: e.target.value})}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 text-gray-900"
                  rows="3"
                  placeholder="Additional notes..."
                />
              </div>

              <div className="flex space-x-4 pt-4">
                <button
                  type="submit"
                  className="flex-1 bg-gray-900 text-white py-3 rounded-xl font-semibold hover:bg-gray-800 transition-colors"
                >
                  {editingItem ? 'Update Item' : 'Add Item'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setEditingItem(null);
                  }}
                  className="px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-xl font-semibold hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, TrendingUp, DollarSign, ShoppingBag, Users,
  Calendar, CreditCard, PieChart, BarChart3, Download
} from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { getNepaliDateString } from '@/lib/time-utils';

export default function ReportsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [reportPeriod, setReportPeriod] = useState('today');
  
  // Initialize with today's date
  const todayStr = getNepaliDateString();
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);
  
  const [stats, setStats] = useState({
    totalSales: 0,
    totalOrders: 0,
    averageOrderValue: 0,
    totalTax: 0,
    totalServiceCharge: 0,
    totalDiscounts: 0,
    paymentBreakdown: {
      cash: 0,
      card: 0,
      qr: 0,
      credit: 0,
      split: 0
    },
    topItems: [],
    hourlyBreakdown: []
  });

  useEffect(() => {
    // Set default dates based on period (Nepal calendar day, not UTC)
    const todayStr = getNepaliDateString();
    const nepalNow = new Date(`${todayStr}T12:00:00+05:45`);

    if (reportPeriod === 'today') {
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (reportPeriod === 'week') {
      // Last 7 days including today (today = Friday, then from last Friday to this Friday)
      const weekAgo = new Date(nepalNow);
      weekAgo.setDate(weekAgo.getDate() - 6); // -6 to include today = 7 days total
      setStartDate(getNepaliDateString(weekAgo));
      setEndDate(todayStr);
    } else if (reportPeriod === 'month') {
      // Last 30 days including today (if today is 2 March, from 2 Feb to 2 March)
      const monthAgo = new Date(nepalNow);
      monthAgo.setDate(monthAgo.getDate() - 29); // -29 to include today = 30 days total
      setStartDate(getNepaliDateString(monthAgo));
      setEndDate(todayStr);
    }
  }, [reportPeriod]);

  useEffect(() => {
    if (startDate && endDate) {
      fetchReportData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  const fetchReportData = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('pos_token');

      // Don't fetch if no valid token
      if (!token || token === 'null' || token === 'undefined') {
        router.push('/login');
        return;
      }

      // Fetch payments
      const paymentsRes = await fetch(
        `/api/restaurant/payments?startDate=${startDate}&endDate=${endDate}`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      // Fetch orders
      const ordersRes = await fetch('/api/restaurant/orders', {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (paymentsRes.ok && ordersRes.ok) {
        const paymentsData = await paymentsRes.json();
        const ordersData = await ordersRes.json();

        const payments = paymentsData.payments || [];
        const allOrders = ordersData.orders || [];

        // Filter orders by date range
        const filteredOrders = allOrders.filter(order => {
          if (!order.completed_at) return false;
          const orderDate = order.completed_at.split('T')[0];
          return orderDate >= startDate && orderDate <= endDate;
        });

        // Calculate stats
        const totalSales = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
        const totalOrders = filteredOrders.length;
        const averageOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;

        const totalTax = payments.reduce((sum, p) => sum + (p.tax_amount || 0), 0);
        const totalServiceCharge = payments.reduce((sum, p) => sum + (p.service_charge || 0), 0);
        const totalDiscounts = payments.reduce((sum, p) => sum + (p.discount_amount || 0), 0);

        // Payment breakdown
        const paymentBreakdown = {
          cash: payments.filter(p => p.payment_method === 'cash').reduce((sum, p) => sum + p.amount, 0),
          card: payments.filter(p => p.payment_method === 'card').reduce((sum, p) => sum + p.amount, 0),
          online: payments.filter(p => p.payment_method === 'online' || p.payment_method === 'qr').reduce((sum, p) => sum + p.amount, 0),
          credit: payments.filter(p => p.payment_method === 'credit').reduce((sum, p) => sum + p.amount, 0),
          split: payments.filter(p => p.payment_method === 'split').reduce((sum, p) => sum + p.amount, 0)
        };

        // Calculate top items from actual order data
        const itemSales = {};
        filteredOrders.forEach(order => {
          if (order.items && Array.isArray(order.items)) {
            order.items.forEach(item => {
              const itemName = item.name || 'Unknown Item';
              if (!itemSales[itemName]) {
                itemSales[itemName] = { name: itemName, quantity: 0, revenue: 0 };
              }
              itemSales[itemName].quantity += item.quantity || 1;
              itemSales[itemName].revenue += (item.price || 0) * (item.quantity || 1);
            });
          }
        });
        
        const topItems = Object.values(itemSales)
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 5);

        // Hourly breakdown (simplified)
        const hourlyBreakdown = Array.from({ length: 24 }, (_, hour) => {
          const ordersInHour = filteredOrders.filter(order => {
            if (!order.created_at) return false;
            const orderHour = new Date(order.created_at).getHours();
            return orderHour === hour;
          });
          const sales = ordersInHour.reduce((sum, o) => sum + (o.total_amount || 0), 0);
          return { hour, orders: ordersInHour.length, sales };
        });

        setStats({
          totalSales,
          totalOrders,
          averageOrderValue,
          totalTax,
          totalServiceCharge,
          totalDiscounts,
          paymentBreakdown,
          topItems,
          hourlyBreakdown
        });
      }

      setLoading(false);
    } catch (error) {
      console.error('Error fetching report data:', error);
      setLoading(false);
    }
  };

  const exportReport = () => {
    const reportData = {
      period: `${startDate} to ${endDate}`,
      stats: {
        totalSales: stats.totalSales,
        totalOrders: stats.totalOrders,
        averageOrderValue: stats.averageOrderValue,
        totalTax: stats.totalTax,
        totalServiceCharge: stats.totalServiceCharge,
        totalDiscounts: stats.totalDiscounts
      },
      paymentBreakdown: stats.paymentBreakdown,
      topItems: stats.topItems
    };

    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-report-${startDate}-to-${endDate}.json`;
    a.click();
  };

  const getPeakHours = () => {
    const sorted = [...stats.hourlyBreakdown]
      .filter(h => h.orders > 0)
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 3);
    return sorted;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-800 text-lg">Generating reports...</p>
        </div>
      </div>
    );
  }

  const peakHours = getPeakHours();

  return (
    <div className="min-h-screen bg-white p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => router.push('/cashier')}
            className="flex items-center space-x-2 text-gray-800 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="font-semibold">Back to Dashboard</span>
          </button>
          <h1 className="text-3xl font-bold text-gray-800 flex items-center">
            <TrendingUp className="w-8 h-8 mr-3 text-blue-600" />
            Sales Reports & Analytics
          </h1>
          <button
            onClick={exportReport}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all font-semibold"
          >
            <Download className="w-5 h-5" />
            <span>Export</span>
          </button>
        </div>

        {/* Period Selector */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <div className="flex items-center space-x-4 mb-4">
            <button
              onClick={() => setReportPeriod('today')}
              className={`px-6 py-2 rounded-lg font-semibold transition-all ${
                reportPeriod === 'today'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setReportPeriod('week')}
              className={`px-6 py-2 rounded-lg font-semibold transition-all ${
                reportPeriod === 'week'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Last 7 Days
            </button>
            <button
              onClick={() => setReportPeriod('month')}
              className={`px-6 py-2 rounded-lg font-semibold transition-all ${
                reportPeriod === 'month'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Last 30 Days
            </button>
            <button
              onClick={() => setReportPeriod('custom')}
              className={`px-6 py-2 rounded-lg font-semibold transition-all ${
                reportPeriod === 'custom'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Custom Range
            </button>
          </div>

          {reportPeriod === 'custom' && (
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div className="mt-4 text-center text-gray-800 font-semibold">
            Report Period: {new Date(`${startDate}T12:00:00+05:45`).toLocaleDateString('en-GB', { timeZone: 'Asia/Kathmandu' })} - {new Date(`${endDate}T12:00:00+05:45`).toLocaleDateString('en-GB', { timeZone: 'Asia/Kathmandu' })}
          </div>
        </div>

        {/* Main Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white border-2 border-gray-200 rounded-xl p-6">
            <div className="flex items-center justify-between mb-3">
              <DollarSign className="w-10 h-10 text-green-600" />
            </div>
            <p className="text-gray-600 text-sm font-medium mb-1">Total Sales</p>
            <p className="text-3xl font-bold text-gray-900">{formatCurrency(stats.totalSales)}</p>
          </div>

          <div className="bg-white border-2 border-gray-200 rounded-xl p-6">
            <div className="flex items-center justify-between mb-3">
              <ShoppingBag className="w-10 h-10 text-blue-600" />
            </div>
            <p className="text-gray-600 text-sm font-medium mb-1">Total Orders</p>
            <p className="text-3xl font-bold text-gray-900">{stats.totalOrders}</p>
          </div>

          <div className="bg-white border-2 border-gray-200 rounded-xl p-6">
            <div className="flex items-center justify-between mb-3">
              <TrendingUp className="w-10 h-10 text-blue-600" />
            </div>
            <p className="text-gray-600 text-sm font-medium mb-1">Avg Order Value</p>
            <p className="text-3xl font-bold text-gray-900">{formatCurrency(stats.averageOrderValue)}</p>
          </div>

          <div className="bg-white border-2 border-gray-200 rounded-xl p-6">
            <div className="flex items-center justify-between mb-3">
              <Users className="w-10 h-10 text-red-600" />
            </div>
            <p className="text-gray-600 text-sm font-medium mb-1">Total Discounts</p>
            <p className="text-3xl font-bold text-gray-900">{formatCurrency(stats.totalDiscounts)}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Payment Breakdown */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center">
              <PieChart className="w-6 h-6 mr-2 text-blue-600" />
              Payment Method Breakdown
            </h2>
            <div className="space-y-4">
              {Object.entries(stats.paymentBreakdown).map(([method, amount]) => {
                const percentage = stats.totalSales > 0 ? (amount / stats.totalSales * 100) : 0;
                const colors = {
                  cash: 'bg-green-500',
                  card: 'bg-blue-500',
                  online: 'bg-purple-500',
                  credit: 'bg-orange-500',
                  split: 'bg-pink-500'
                };
                const labels = {
                  cash: 'Cash',
                  card: 'Card',
                  online: 'Online Payment',
                  credit: 'Credit',
                  split: 'Split'
                };
                return (
                  <div key={method}>
                    <div className="flex justify-between mb-2">
                      <span className="text-gray-700 font-semibold">{labels[method]}</span>
                      <span className="font-bold text-gray-900">{formatCurrency(amount)}</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div
                        className={`${colors[method]} h-3 rounded-full transition-all`}
                        style={{ width: `${percentage}%` }}
                      ></div>
                    </div>
                    <div className="text-right text-sm text-gray-700 mt-1">{percentage.toFixed(1)}%</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Financial Breakdown */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center">
              <BarChart3 className="w-6 h-6 mr-2 text-blue-600" />
              Financial Breakdown
            </h2>
            <div className="space-y-4">
              <div className="flex justify-between py-3 border-b border-gray-200">
                <span className="text-gray-800">Gross Sales:</span>
                <span className="font-bold text-gray-900 text-lg">{formatCurrency(stats.totalSales - stats.totalTax - stats.totalServiceCharge)}</span>
              </div>
              <div className="flex justify-between py-3 border-b border-gray-200">
                <span className="text-gray-800">Tax Collected (13%):</span>
                <span className="font-semibold text-blue-600">{formatCurrency(stats.totalTax)}</span>
              </div>
              <div className="flex justify-between py-3 border-b border-gray-200">
                <span className="text-gray-800">Service Charge (10%):</span>
                <span className="font-semibold text-green-600">{formatCurrency(stats.totalServiceCharge)}</span>
              </div>
              <div className="flex justify-between py-3 border-b border-gray-200">
                <span className="text-gray-800">Discounts Given:</span>
                <span className="font-semibold text-red-600">- {formatCurrency(stats.totalDiscounts)}</span>
              </div>
              <div className="flex justify-between py-4 bg-blue-50 px-4 rounded-lg">
                <span className="text-gray-800 font-bold text-lg">Net Revenue:</span>
                <span className="font-bold text-gray-900 text-2xl">{formatCurrency(stats.totalSales - stats.totalDiscounts)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Top Selling Items */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-6">Top Selling Items</h2>
            <div className="space-y-3">
              {stats.topItems.map((item, index) => (
                <div key={index} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold">
                      {index + 1}
                    </div>
                    <div>
                      <p className="font-bold text-gray-900">{item.name}</p>
                      <p className="text-sm text-gray-800">{item.quantity} orders</p>
                    </div>
                  </div>
                  <span className="font-bold text-gray-900 text-lg">{formatCurrency(item.revenue)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Peak Hours */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-6">Peak Hours</h2>
            <div className="space-y-4">
              {peakHours.map((hour, index) => (
                <div key={index} className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-lg font-bold text-gray-900">
                      {hour.hour}:00 - {hour.hour + 1}:00
                    </span>
                    <span className="px-3 py-1 bg-blue-600 text-white rounded-full text-sm font-semibold">
                      #{index + 1} Peak
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mt-3">
                    <div>
                      <p className="text-sm text-gray-800">Orders</p>
                      <p className="text-2xl font-bold text-gray-900">{hour.orders}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-800">Sales</p>
                      <p className="text-2xl font-bold text-gray-900">{formatCurrency(hour.sales)}</p>
                    </div>
                  </div>
                </div>
              ))}
              {peakHours.length === 0 && (
                <div className="text-center py-8 text-gray-800">
                  <Calendar className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No orders in this period</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

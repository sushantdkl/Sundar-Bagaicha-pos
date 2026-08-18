'use client'

import { useState, useEffect } from 'react'
import { DownloadCloud, FileText, TrendingUp, TrendingDown, DollarSign, ShoppingCart, Package, Users, Calendar, Clock, Receipt } from 'lucide-react'
import { formatNepalDate, formatNepalTime } from '@/lib/time-utils'

export default function ReportsPage() {
  const [reportType, setReportType] = useState('alltime')
  const [transactions, setTransactions] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState({ start: '', end: '' })
  const [showBillingHistory, setShowBillingHistory] = useState(false)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const [transactionsRes, productsRes] = await Promise.all([
        fetch('/api/transactions'),
        fetch('/api/products')
      ])
      
      const transactionsData = await transactionsRes.json()
      const productsData = await productsRes.json()
      
      if (transactionsData.success) {
        setTransactions(transactionsData.transactions || [])
      }
      if (productsData.success) {
        setProducts(productsData.products || [])
      }
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }

  // Calculate analytics from real data
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const thisWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)

  const filterTransactions = (startDate) => {
    return transactions.filter(t => new Date(t.created_at) >= startDate)
  }

  const calculateStats = (filteredTransactions) => {
    const totalSales = filteredTransactions.reduce((sum, t) => sum + parseFloat(t.total || 0), 0)
    const totalCount = filteredTransactions.length
    const avgTransaction = totalCount > 0 ? totalSales / totalCount : 0
    const totalItems = filteredTransactions.reduce((sum, t) => {
      return sum + (t.items?.reduce((itemSum, item) => itemSum + (item.quantity || 0), 0) || 0)
    }, 0)
    
    return { totalSales, totalCount, avgTransaction, totalItems }
  }

  const dailyStats = calculateStats(filterTransactions(today))
  const weeklyStats = calculateStats(filterTransactions(thisWeek))
  const monthlyStats = calculateStats(filterTransactions(thisMonth))
  const allTimeStats = calculateStats(transactions)

  const reports = {
    daily: {
      title: 'Daily Sales Report',
      date: today.toLocaleDateString(),
      ...dailyStats
    },
    weekly: {
      title: 'Weekly Sales Report',
      date: `${thisWeek.toLocaleDateString()} - ${today.toLocaleDateString()}`,
      ...weeklyStats
    },
    monthly: {
      title: 'Monthly Sales Report',
      date: thisMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      ...monthlyStats
    },
    alltime: {
      title: 'All Time Report',
      date: 'Since Beginning',
      ...allTimeStats
    }
  }

  const currentReport = reports[reportType]

  // Calculate category sales
  const categorySales = {}
  transactions.forEach(transaction => {
    transaction.items?.forEach(item => {
      const product = products.find(p => p.id === item.product_id)
      if (product) {
        const category = product.category || 'Uncategorized'
        categorySales[category] = (categorySales[category] || 0) + (item.subtotal || 0)
      }
    })
  })

  const categoryData = Object.entries(categorySales)
    .map(([category, sales]) => ({ category, sales }))
    .sort((a, b) => b.sales - a.sales)

  const totalCategorySales = categoryData.reduce((sum, item) => sum + item.sales, 0)
  const categoryDataWithPercent = categoryData.map(item => ({
    ...item,
    percent: totalCategorySales > 0 ? (item.sales / totalCategorySales) * 100 : 0
  }))

  // Calculate product sales
  const productSales = {}
  transactions.forEach(transaction => {
    transaction.items?.forEach(item => {
      const productId = item.product_id
      if (!productSales[productId]) {
        productSales[productId] = { quantity: 0, revenue: 0, productId }
      }
      productSales[productId].quantity += item.quantity || 0
      productSales[productId].revenue += item.subtotal || 0
    })
  })

  const topProducts = Object.values(productSales)
    .map(ps => {
      const product = products.find(p => p.id === ps.productId)
      return {
        name: product?.name || 'Unknown',
        qty: ps.quantity,
        revenue: ps.revenue
      }
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)

  // Calculate trends
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
  const yesterdayStats = calculateStats(filterTransactions(yesterday).filter(t => new Date(t.created_at) < today))
  const dailyTrend = yesterdayStats.totalSales > 0 
    ? ((dailyStats.totalSales - yesterdayStats.totalSales) / yesterdayStats.totalSales) * 100 
    : 0

  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)
  const lastMonthStats = calculateStats(transactions.filter(t => {
    const date = new Date(t.created_at)
    return date >= lastMonth && date <= lastMonthEnd
  }))
  const monthlyTrend = lastMonthStats.totalSales > 0
    ? ((monthlyStats.totalSales - lastMonthStats.totalSales) / lastMonthStats.totalSales) * 100
    : 0

  // Low stock products
  const lowStockProducts = products
    .filter(p => p.stock < (p.min_stock || 10))
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 5)

  // Recent transactions for billing history
  const recentTransactions = [...transactions]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 50)

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="text-xl font-semibold text-muted-foreground">Loading reports...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-2xl sm:text-3xl font-bold">Reports & Analytics</h2>
        <button
          onClick={() => setShowBillingHistory(!showBillingHistory)}
          className="pos-button-primary px-4 sm:px-6 py-2 sm:py-3 rounded-lg font-semibold flex items-center gap-2 text-sm sm:text-base w-full sm:w-auto justify-center"
        >
          <Receipt size={20} />
          {showBillingHistory ? 'Hide' : 'View'} Billing History
        </button>
      </div>

      {showBillingHistory ? (
        <div className="pos-stat-card">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-bold">Billing History</h3>
            <span className="text-sm text-muted-foreground">{recentTransactions.length} transactions</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50">
                <tr className="text-muted-foreground font-semibold">
                  <th className="text-left py-3 px-4">Date & Time</th>
                  <th className="text-left py-3 px-4">Items</th>
                  <th className="text-right py-3 px-4">Qty</th>
                  <th className="text-right py-3 px-4">Total</th>
                  <th className="text-left py-3 px-4">Payment</th>
                </tr>
              </thead>
              <tbody>
                {recentTransactions.map(transaction => (
                  <tr key={transaction.id} className="border-b border-border hover:bg-muted/30">
                    <td className="py-3 px-4 text-xs">
                      {formatNepalTime(transaction.created_at)}
                    </td>
                    <td className="py-3 px-4">
                      <div className="max-w-xs truncate">
                        {transaction.items?.map(item => {
                          const product = products.find(p => p.id === item.product_id)
                          return product?.name
                        }).filter(Boolean).join(', ') || 'N/A'}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {transaction.items?.reduce((sum, item) => sum + item.quantity, 0) || 0}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-primary">
                      Rs {parseFloat(transaction.total || 0).toFixed(2)}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-1 bg-primary/20 text-primary rounded text-xs font-semibold">
                        {transaction.payment_method || 'Cash'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            <button
              onClick={() => setReportType('daily')}
              className={`px-4 sm:px-6 py-2 sm:py-3 rounded-lg font-semibold transition-all text-sm sm:text-base ${
                reportType === 'daily'
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border hover:bg-muted'
              }`}
            >
              Daily
            </button>
            <button
              onClick={() => setReportType('weekly')}
              className={`px-4 sm:px-6 py-2 sm:py-3 rounded-lg font-semibold transition-all text-sm sm:text-base ${
                reportType === 'weekly'
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border hover:bg-muted'
              }`}
            >
              Weekly
            </button>
            <button
              onClick={() => setReportType('monthly')}
              className={`px-4 sm:px-6 py-2 sm:py-3 rounded-lg font-semibold transition-all text-sm sm:text-base ${
                reportType === 'monthly'
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border hover:bg-muted'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setReportType('alltime')}
              className={`px-4 sm:px-6 py-2 sm:py-3 rounded-lg font-semibold transition-all text-sm sm:text-base ${
                reportType === 'alltime'
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border hover:bg-muted'
              }`}
            >
              All Time
            </button>
          </div>

          <div className="pos-stat-card border-l-4 border-primary">
            <div className="flex justify-between items-start mb-2">
              <div>
                <p className="text-xs sm:text-sm text-muted-foreground mb-1">{currentReport.title}</p>
                <p className="text-xs text-muted-foreground">{currentReport.date}</p>
              </div>
              <Calendar className="text-primary" size={24} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
            <div className="pos-stat-card">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs sm:text-sm text-muted-foreground">Total Sales</p>
                <DollarSign className="text-primary" size={20} />
              </div>
              <h3 className="text-2xl sm:text-4xl font-bold text-primary">
                Rs {currentReport.totalSales.toFixed(2)}
              </h3>
              {reportType === 'daily' && (
                <div className="flex items-center gap-1 mt-2">
                  {dailyTrend >= 0 ? (
                    <TrendingUp size={16} className="text-green-500" />
                  ) : (
                    <TrendingDown size={16} className="text-red-500" />
                  )}
                  <span className={`text-xs font-semibold ${dailyTrend >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {dailyTrend.toFixed(1)}% vs yesterday
                  </span>
                </div>
              )}
              {reportType === 'monthly' && (
                <div className="flex items-center gap-1 mt-2">
                  {monthlyTrend >= 0 ? (
                    <TrendingUp size={16} className="text-green-500" />
                  ) : (
                    <TrendingDown size={16} className="text-red-500" />
                  )}
                  <span className={`text-xs font-semibold ${monthlyTrend >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {monthlyTrend.toFixed(1)}% vs last month
                  </span>
                </div>
              )}
            </div>

            <div className="pos-stat-card">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs sm:text-sm text-muted-foreground">Transactions</p>
                <ShoppingCart className="text-secondary" size={20} />
              </div>
              <h3 className="text-2xl sm:text-4xl font-bold">{currentReport.totalCount}</h3>
              <p className="text-xs text-muted-foreground mt-2">
                {currentReport.totalItems} items sold
              </p>
            </div>

            <div className="pos-stat-card">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs sm:text-sm text-muted-foreground">Avg. Transaction</p>
                <Receipt className="text-amber-500" size={20} />
              </div>
              <h3 className="text-2xl sm:text-4xl font-bold text-secondary">
                Rs {currentReport.avgTransaction.toFixed(2)}
              </h3>
              <p className="text-xs text-muted-foreground mt-2">per sale</p>
            </div>

            <div className="pos-stat-card">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs sm:text-sm text-muted-foreground">Products</p>
                <Package className="text-purple-500" size={20} />
              </div>
              <h3 className="text-2xl sm:text-4xl font-bold">{products.length}</h3>
              <p className="text-xs text-muted-foreground mt-2">
                {lowStockProducts.length} low stock
              </p>
            </div>
          </div>

          {lowStockProducts.length > 0 && (
            <div className="pos-stat-card border-l-4 border-destructive bg-destructive/5">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-destructive">
                <Package size={20} />
                Low Stock Alert
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {lowStockProducts.map(product => (
                  <div key={product.id} className="p-3 bg-background rounded-lg border border-destructive/20">
                    <p className="font-semibold text-sm">{product.name}</p>
                    <p className="text-xs text-muted-foreground">{product.category}</p>
                    <p className="text-destructive font-bold mt-1">
                      {product.stock} / {product.min_stock || 10}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pos-stat-card">
            <h3 className="text-lg sm:text-xl font-bold mb-4 sm:mb-6">Sales by Category</h3>
            {categoryDataWithPercent.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No sales data available</p>
            ) : (
              <div className="space-y-4">
                {categoryDataWithPercent.slice(0, 8).map(item => (
                  <div key={item.category}>
                    <div className="flex justify-between mb-2">
                      <span className="font-semibold text-sm sm:text-base">{item.category}</span>
                      <span className="text-primary font-bold text-sm sm:text-base">
                        ${item.sales.toFixed(2)} ({item.percent.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2 sm:h-3 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-primary to-secondary transition-all duration-500"
                        style={{ width: `${item.percent}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pos-stat-card">
            <h3 className="text-lg sm:text-xl font-bold mb-4 sm:mb-6">Top Selling Products</h3>
            {topProducts.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No product sales data available</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs sm:text-sm">
                  <thead className="border-b border-border bg-muted/50">
                    <tr className="text-muted-foreground font-semibold">
                      <th className="text-left py-2 sm:py-3 px-3 sm:px-4">Rank</th>
                      <th className="text-left py-2 sm:py-3 px-3 sm:px-4">Product</th>
                      <th className="text-right py-2 sm:py-3 px-3 sm:px-4">Qty Sold</th>
                      <th className="text-right py-2 sm:py-3 px-3 sm:px-4">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProducts.map((product, index) => (
                      <tr key={product.name} className="border-b border-border hover:bg-muted/30">
                        <td className="py-2 sm:py-3 px-3 sm:px-4">
                          <span className={`font-bold ${index < 3 ? 'text-primary' : ''}`}>
                            #{index + 1}
                          </span>
                        </td>
                        <td className="py-2 sm:py-3 px-3 sm:px-4 font-semibold">{product.name}</td>
                        <td className="py-2 sm:py-3 px-3 sm:px-4 text-right">{product.qty}</td>
                        <td className="py-2 sm:py-3 px-3 sm:px-4 text-right font-bold text-primary">
                          Rs {product.revenue.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            <div className="pos-stat-card">
              <h3 className="text-lg font-bold mb-4">Quick Stats</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center p-3 bg-muted/50 rounded">
                  <span className="text-sm text-muted-foreground">Total Products</span>
                  <span className="font-bold">{products.length}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-muted/50 rounded">
                  <span className="text-sm text-muted-foreground">Total Stock Value</span>
                  <span className="font-bold text-primary">
                    Rs {products.reduce((sum, p) => sum + (p.stock * p.price), 0).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 bg-muted/50 rounded">
                  <span className="text-sm text-muted-foreground">Avg. Product Price</span>
                  <span className="font-bold">
                    Rs {products.length > 0 ? (products.reduce((sum, p) => sum + p.price, 0) / products.length).toFixed(2) : '0.00'}
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 bg-muted/50 rounded">
                  <span className="text-sm text-muted-foreground">Categories</span>
                  <span className="font-bold">
                    {new Set(products.map(p => p.category)).size}
                  </span>
                </div>
              </div>
            </div>

            <div className="pos-stat-card">
              <h3 className="text-lg font-bold mb-4">Performance Insights</h3>
              <div className="space-y-3">
                <div className="p-3 bg-primary/10 rounded border-l-4 border-primary">
                  <p className="text-xs text-muted-foreground mb-1">Best Day</p>
                  <p className="font-bold text-primary">
                    {transactions.length > 0 
                      ? formatNepalDate(transactions.sort((a, b) => b.total - a.total)[0]?.created_at)
                      : 'N/A'}
                  </p>
                </div>
                <div className="p-3 bg-secondary/10 rounded border-l-4 border-secondary">
                  <p className="text-xs text-muted-foreground mb-1">Largest Sale</p>
                  <p className="font-bold text-secondary">
                    Rs {transactions.length > 0 
                      ? Math.max(...transactions.map(t => parseFloat(t.total || 0))).toFixed(2)
                      : '0.00'}
                  </p>
                </div>
                <div className="p-3 bg-amber-500/10 rounded border-l-4 border-amber-500">
                  <p className="text-xs text-muted-foreground mb-1">Smallest Sale</p>
                  <p className="font-bold text-amber-600">
                    Rs {transactions.length > 0 
                      ? Math.min(...transactions.map(t => parseFloat(t.total || 0))).toFixed(2)
                      : '0.00'}
                  </p>
                </div>
                <div className="p-3 bg-purple-500/10 rounded border-l-4 border-purple-500">
                  <p className="text-xs text-muted-foreground mb-1">Total Items Sold</p>
                  <p className="font-bold text-purple-600">
                    {transactions.reduce((sum, t) => sum + (t.items?.reduce((s, i) => s + i.quantity, 0) || 0), 0)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
            <button className="flex-1 flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 sm:px-6 py-2 sm:py-3 rounded-lg font-semibold hover:bg-primary/90 transition-colors text-sm sm:text-base">
              <DownloadCloud size={20} />
              Download as PDF
            </button>
            <button className="flex-1 flex items-center justify-center gap-2 border border-border px-4 sm:px-6 py-2 sm:py-3 rounded-lg font-semibold hover:bg-muted transition-colors text-sm sm:text-base">
              <FileText size={20} />
              Download as Excel
            </button>
          </div>
        </>
      )}
    </div>
  )
}

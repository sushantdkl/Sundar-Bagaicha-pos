'use client'

import { Plus, Edit2, Printer, DownloadCloud, ShoppingCart, Package } from 'lucide-react'

export default function QuickActions({ onNavigate }) {
  const actions = [
    { id: 1, label: 'New Sale', icon: ShoppingCart, color: 'bg-primary', page: 'billing' },
    { id: 2, label: 'Add Product', icon: Plus, color: 'bg-secondary', page: 'products' },
    { id: 3, label: 'View Reports', icon: DownloadCloud, color: 'bg-accent', page: 'reports' },
    { id: 4, label: 'Manage Stock', icon: Package, color: 'bg-primary/80', page: 'inventory' },
  ]

  return (
    <div className="pos-stat-card">
      <h3 className="text-lg sm:text-xl font-bold mb-4 sm:mb-6 text-foreground">Quick Actions</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 lg:gap-4">
        {actions.map(action => {
          const Icon = action.icon
          return (
            <button
              key={action.id}
              onClick={() => onNavigate && onNavigate(action.page)}
              className={`${action.color} text-primary-foreground px-3 sm:px-6 py-2 sm:py-4 rounded-lg font-semibold hover:shadow-lg transition-all flex flex-col sm:flex-row sm:items-center sm:justify-center gap-1 sm:gap-2 active:scale-95 text-xs sm:text-sm`}
            >
              <Icon size={16} className="sm:w-5 sm:h-5 mx-auto sm:mx-0" />
              <span className="leading-tight">{action.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

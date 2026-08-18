'use client'

import { TrendingUp, TrendingDown } from 'lucide-react'

export default function StatCard({ title, value, change, trend, icon, onClick }) {
  return (
    <div 
      onClick={onClick}
      className="pos-stat-card cursor-pointer transform transition-transform hover:scale-105"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs sm:text-sm text-muted-foreground font-medium mb-1 truncate">{title}</p>
          <h3 className="text-sm sm:text-base md:text-lg font-bold text-foreground mb-1 sm:mb-2 break-words leading-tight">{value}</h3>
          <div className={`flex items-center gap-1 text-xs sm:text-sm font-semibold ${
            trend === 'up' ? 'text-green-600 dark:text-green-400' : 
            trend === 'down' ? 'text-red-600 dark:text-red-400' : 
            'text-muted-foreground'
          }`}>
            {trend === 'up' && <TrendingUp size={14} className="sm:w-4 sm:h-4" />}
            {trend === 'down' && <TrendingDown size={14} className="sm:w-4 sm:h-4" />}
            <span>{Math.abs(change)}%</span>
            <span className="text-muted-foreground text-xs">
              {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}
            </span>
          </div>
        </div>
        <div className="text-2xl sm:text-3xl md:text-4xl opacity-40 flex-shrink-0">{icon}</div>
      </div>
    </div>
  )
}

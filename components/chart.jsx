'use client'

export default function Chart({ title, span = 'col-span-1', type = 'line', data = [] }) {
  if (type === 'line' && data.length > 0) {
    // Daily sales line chart
    const maxValue = Math.max(...data.map(d => d.value), 1)
    const padding = 40
    const width = 400
    const height = 200
    const chartHeight = height - padding * 2
    const chartWidth = width - padding * 2
    const step = chartWidth / (data.length - 1 || 1)

    const points = data.map((d, i) => ({
      x: padding + i * step,
      y: height - padding - (d.value / maxValue) * chartHeight
    }))

    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
    const areaPath = `${linePath} L ${points[points.length - 1].x} ${height - padding} L ${padding} ${height - padding} Z`

    return (
      <div className={`pos-stat-card ${span}`}>
        <h3 className="text-lg sm:text-xl font-bold mb-4 sm:mb-6 text-foreground">{title}</h3>
        <div className="h-64 flex items-center justify-center bg-muted/30 rounded-lg p-4">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full">
            {/* Grid lines */}
            {[0, 1, 2, 3, 4].map(i => (
              <line
                key={i}
                x1={padding}
                y1={padding + (chartHeight / 4) * i}
                x2={width - padding}
                y2={padding + (chartHeight / 4) * i}
                stroke="currentColor"
                strokeOpacity="0.1"
                strokeWidth="1"
              />
            ))}
            
            {/* Area fill */}
            <path
              d={areaPath}
              fill="url(#lineGradient)"
              opacity="0.2"
            />
            
            {/* Line */}
            <path
              d={linePath}
              stroke="var(--color-primary)"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            
            {/* Points */}
            {points.map((p, i) => (
              <g key={i}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r="4"
                  fill="var(--color-primary)"
                  stroke="white"
                  strokeWidth="2"
                />
                {/* Labels */}
                <text
                  x={p.x}
                  y={height - padding + 20}
                  textAnchor="middle"
                  fontSize="10"
                  fill="currentColor"
                  opacity="0.6"
                >
                  {data[i].label}
                </text>
              </g>
            ))}
            
            <defs>
              <linearGradient id="lineGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="var(--color-primary)" />
                <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      </div>
    )
  }

  if (type === 'pie' && data.length > 0) {
    // Category distribution pie chart
    const total = data.reduce((sum, d) => sum + d.value, 0)
    const radius = 80
    const centerX = 100
    const centerY = 100
    
    let currentAngle = -90 // Start from top

    const slices = data.map((d, i) => {
      const percentage = (d.value / total) * 100
      const angle = (d.value / total) * 360
      const startAngle = currentAngle
      const endAngle = currentAngle + angle
      
      const x1 = centerX + radius * Math.cos((startAngle * Math.PI) / 180)
      const y1 = centerY + radius * Math.sin((startAngle * Math.PI) / 180)
      const x2 = centerX + radius * Math.cos((endAngle * Math.PI) / 180)
      const y2 = centerY + radius * Math.sin((endAngle * Math.PI) / 180)
      
      const largeArc = angle > 180 ? 1 : 0
      
      const path = `M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`
      
      currentAngle += angle
      
      return {
        path,
        color: d.color || `hsl(${(i * 360) / data.length}, 70%, 60%)`,
        label: d.label,
        value: d.value,
        percentage
      }
    })

    return (
      <div className={`pos-stat-card ${span}`}>
        <h3 className="text-lg sm:text-xl font-bold mb-4 sm:mb-6 text-foreground">{title}</h3>
        <div className="h-64 flex items-center justify-center bg-muted/30 rounded-lg p-4">
          <div className="flex flex-col items-center gap-4 w-full">
            <svg viewBox="0 0 200 200" className="w-48 h-48">
              {slices.map((slice, i) => (
                <g key={i}>
                  <path
                    d={slice.path}
                    fill={slice.color}
                    stroke="white"
                    strokeWidth="2"
                  />
                </g>
              ))}
            </svg>
            <div className="grid grid-cols-2 gap-2 w-full text-xs">
              {slices.slice(0, 4).map((slice, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: slice.color }}
                  />
                  <span className="truncate">{slice.label}</span>
                  <span className="font-bold ml-auto">{slice.percentage.toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`pos-stat-card ${span}`}>
      <h3 className="text-lg sm:text-xl font-bold mb-4 sm:mb-6 text-foreground">{title}</h3>
      <div className="h-64 flex items-center justify-center bg-muted/30 rounded-lg">
        <p className="text-muted-foreground">No data available</p>
      </div>
    </div>
  )
}

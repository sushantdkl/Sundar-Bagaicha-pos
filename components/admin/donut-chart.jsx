'use client';

/**
 * Simple SVG donut chart from [{ label, value, color }].
 */
export default function DonutChart({
  segments = [],
  size = 200,
  thickness = 28,
  centerLabel = 'Total',
  centerValue = null,
}) {
  const total = segments.reduce((s, x) => s + Number(x.value || 0), 0);
  const r = 40;
  const c = 2 * Math.PI * r;

  const colors = segments.map((s, i) => s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]);
  const arcs = segments.reduce((acc, seg, i) => {
    const value = Number(seg.value || 0);
    const len = value > 0 ? (value / total) * c : 0;
    const strokeDashoffset = -acc.offset;
    acc.offset += len;
    acc.rows.push({ seg, i, value, len, strokeDashoffset });
    return acc;
  }, { offset: 0, rows: [] }).rows;

  if (total <= 0) {
    return (
      <div className="flex flex-col items-center justify-center" style={{ width: size, height: size }}>
        <div
          className="rounded-full border-[14px] border-gray-100 flex items-center justify-center text-gray-400 text-sm"
          style={{ width: size * 0.85, height: size * 0.85 }}
        >
          No data
        </div>
      </div>
    );
  }

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#f3f4f6" strokeWidth={thickness / 2.5} />
        {arcs.map(({ seg, i, value, len, strokeDashoffset }) => {
          if (value <= 0) return null;
          const dash = `${len} ${c - len}`;
          return (
            <circle
              key={i}
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke={colors[i]}
              strokeWidth={thickness / 2.5}
              strokeDasharray={dash}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="butt"
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
        <p className="text-sm sm:text-base font-bold text-gray-900 tabular-nums leading-tight break-all">
          {centerValue != null ? centerValue : '100%'}
        </p>
        <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5">{centerLabel}</p>
      </div>
    </div>
  );
}

const DEFAULT_COLORS = [
  '#0f172a',
  '#2563eb',
  '#059669',
  '#d97706',
  '#db2777',
  '#7c3aed',
  '#0891b2',
  '#ea580c',
];

export { DEFAULT_COLORS };

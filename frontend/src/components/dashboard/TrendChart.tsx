'use client';

import type { TrendPoint } from '@/lib/api-client';
import { formatTHB } from '@/lib/content-labels';

interface TrendChartProps {
  points: TrendPoint[];
}

const WIDTH = 640;
const HEIGHT = 200;
const PADDING = { top: 12, right: 12, bottom: 24, left: 48 };

/**
 * Dependency-free SVG line chart of cumulative revenue over time (no chart
 * library — Bootstrap-only frontend). Plots the revenue series; the x-axis
 * is the trend's UTC days. Single point renders as a dot; empty renders a
 * placeholder.
 */
export function TrendChart({ points }: TrendChartProps): JSX.Element {
  if (points.length === 0) {
    return <p className="text-muted mb-0">No trend data yet — sync or add metrics first.</p>;
  }

  const plotW = WIDTH - PADDING.left - PADDING.right;
  const plotH = HEIGHT - PADDING.top - PADDING.bottom;
  const maxRevenue = Math.max(...points.map((p) => p.revenue), 1);
  const n = points.length;

  const x = (i: number): number =>
    PADDING.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (revenue: number): number =>
    PADDING.top + plotH - (revenue / maxRevenue) * plotH;

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.revenue).toFixed(1)}`)
    .join(' ');

  return (
    <figure className="mb-0">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Cumulative revenue over time"
        style={{ width: '100%', height: 'auto' }}
      >
        {/* y-axis gridlines + labels at 0, 50%, 100% of max */}
        {[0, 0.5, 1].map((frac) => {
          const gy = PADDING.top + plotH - frac * plotH;
          return (
            <g key={frac}>
              <line
                x1={PADDING.left}
                y1={gy}
                x2={WIDTH - PADDING.right}
                y2={gy}
                stroke="currentColor"
                strokeOpacity={0.15}
              />
              <text x={PADDING.left - 6} y={gy + 4} textAnchor="end" fontSize={11} fill="currentColor">
                {formatTHB(maxRevenue * frac)}
              </text>
            </g>
          );
        })}

        <path d={linePath} fill="none" stroke="#0d6efd" strokeWidth={2} />

        {points.map((p, i) => (
          <g key={p.date}>
            <circle cx={x(i)} cy={y(p.revenue)} r={3} fill="#0d6efd">
              <title>{`${p.date}: ${formatTHB(p.revenue)}`}</title>
            </circle>
            {/* x-axis label — thin to first, last, and middle to avoid crowding */}
            {(i === 0 || i === n - 1 || i === Math.floor((n - 1) / 2)) && (
              <text
                x={x(i)}
                y={HEIGHT - 6}
                textAnchor="middle"
                fontSize={11}
                fill="currentColor"
              >
                {p.date.slice(5)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </figure>
  );
}

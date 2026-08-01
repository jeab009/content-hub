'use client';

import type { JSX } from 'react';

import type { TrendPoint } from '@/lib/api-client';
import { formatTHB } from '@/lib/content-labels';
import {
  AXIS_FONT_SIZE,
  CHART_HEIGHT as HEIGHT,
  CHART_WIDTH as WIDTH,
  Y_LABEL_GAP,
  computeChartPadding,
} from '@/lib/trend-chart-layout';

interface TrendChartProps {
  points: TrendPoint[];
}

/** Fractions of max revenue that get a gridline + y-axis label. */
const Y_AXIS_FRACTIONS = [0, 0.5, 1] as const;

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

  const maxRevenue = Math.max(...points.map((p) => p.revenue), 1);
  const n = points.length;

  // Padding is derived from the labels actually being drawn, so a large
  // revenue figure widens the axis gutter instead of being clipped (BUG-P5-01).
  const yAxisLabels = Y_AXIS_FRACTIONS.map((frac) => formatTHB(maxRevenue * frac));
  const PADDING = computeChartPadding(yAxisLabels, points[n - 1].date.slice(5));

  const plotW = WIDTH - PADDING.left - PADDING.right;
  const plotH = HEIGHT - PADDING.top - PADDING.bottom;

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
        {Y_AXIS_FRACTIONS.map((frac, i) => {
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
              <text
                x={PADDING.left - Y_LABEL_GAP}
                y={gy + 4}
                textAnchor="end"
                fontSize={AXIS_FONT_SIZE}
                fill="currentColor"
              >
                {yAxisLabels[i]}
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
                fontSize={AXIS_FONT_SIZE}
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

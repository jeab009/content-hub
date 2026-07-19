import { describe, expect, it } from '@jest/globals';
import { formatTHB } from './content-labels';
import {
  CHART_WIDTH,
  axisLabelOverflow,
  computeChartPadding,
  estimateAxisLabelWidth,
} from './trend-chart-layout';

/**
 * BUG-P5-01 regression: the dashboard revenue chart clipped its axis labels
 * against the SVG viewBox (overflow: hidden), rendering "THB 7.90" as
 * "HB 7.90" and truncating the last date. Root cause was fixed left/right
 * padding that did not account for how wide the labels actually are.
 */
describe('BUG-P5-01: trend chart axis labels must fit inside the viewBox', () => {
  /** The y-axis labels TrendChart draws: 0%, 50%, 100% of max revenue. */
  const yLabelsFor = (maxRevenue: number): string[] =>
    [0, 0.5, 1].map((frac) => formatTHB(maxRevenue * frac));

  it('does not clip on the exact data that exposed the bug (max THB 7.90)', () => {
    const overflow = axisLabelOverflow(yLabelsFor(7.9), '07-19');

    expect(overflow.left).toBeLessThanOrEqual(0);
    expect(overflow.right).toBeLessThanOrEqual(0);
  });

  const magnitudes: ReadonlyArray<[string, number]> = [
    ['zero revenue', 0],
    ['single baht', 7.9],
    ['thousands', 12_345.67],
    ['millions', 1_234_567.89],
    ['billions', 9_876_543_210.12],
  ];

  it.each(magnitudes)('does not clip at %s', (_label: string, maxRevenue: number) => {
    const overflow = axisLabelOverflow(yLabelsFor(maxRevenue), '12-31');

    expect(overflow.left).toBeLessThanOrEqual(0);
    expect(overflow.right).toBeLessThanOrEqual(0);
  });

  it('grows left padding with revenue magnitude rather than holding a fixed guess', () => {
    const small = computeChartPadding(yLabelsFor(7.9), '07-19').left;
    const large = computeChartPadding(yLabelsFor(1_234_567.89), '07-19').left;

    expect(large).toBeGreaterThan(small);
  });

  it('reserves at least half the last x-axis label on the right edge', () => {
    const label = '07-19';
    const padding = computeChartPadding(yLabelsFor(7.9), label);

    expect(padding.right).toBeGreaterThanOrEqual(estimateAxisLabelWidth(label) / 2);
    // ...and the label therefore ends inside the viewBox.
    expect(CHART_WIDTH - padding.right + estimateAxisLabelWidth(label) / 2).toBeLessThanOrEqual(
      CHART_WIDTH,
    );
  });

  it('keeps the previous visual inset when labels are narrow enough not to need more', () => {
    // A short label must not shrink the axis below the original 48/12 insets.
    const padding = computeChartPadding(['0'], '1');

    expect(padding.left).toBe(48);
    expect(padding.right).toBe(12);
  });

  it('estimates label width proportionally to length', () => {
    expect(estimateAxisLabelWidth('')).toBe(0);
    expect(estimateAxisLabelWidth('THB 7.90')).toBeCloseTo(49.6, 1);
  });
});

/**
 * Geometry for the dependency-free SVG trend chart (TrendChart.tsx).
 *
 * Extracted into lib/ because it is pure arithmetic and the invariant it
 * guards — "no axis label is drawn outside the viewBox" — is only checkable in
 * a test if it lives outside the component (jsdom has no getBBox).
 *
 * BUG-P5-01: the chart previously hardcoded `left: 48 / right: 12`. Those are
 * fixed guesses, but the y-axis labels come from formatTHB, whose width grows
 * with revenue magnitude ("THB 7.90" is 8 chars, "THB 1,234,567.89" is 16). At
 * 48px of left padding the labels already overflowed the viewBox by ~7px on
 * the demo's own data and the SVG (overflow: hidden) clipped the leading "T",
 * rendering "HB 7.90". The final x-axis label overflowed the right edge the
 * same way. Deriving the padding from the labels actually being drawn fixes it
 * for every magnitude instead of moving the guess.
 */

export const CHART_WIDTH = 640;
export const CHART_HEIGHT = 200;

/** Font size of every axis label, in user units. Mirrored in TrendChart. */
export const AXIS_FONT_SIZE = 11;

/**
 * Approximate advance width of one axis-label character at AXIS_FONT_SIZE.
 *
 * Measured in Chrome against the shipped font stack: "THB 7.90" (8 chars)
 * rendered 49.2px and "07-16" (5 chars) 30.6px — both ≈6.15px/char. Rounded up
 * to 6.2 so the estimate errs toward reserving slightly too much room, never
 * too little. Labels are digits/uppercase/punctuation only, so a single
 * average is accurate enough; the alternative (canvas measureText) would drag
 * a DOM dependency into what is otherwise pure layout math.
 */
export const AXIS_CHAR_WIDTH = 6.2;

/** Gap between a y-axis label's right edge and the plot area. */
export const Y_LABEL_GAP = 6;

/** Floor for left padding so sparse labels still leave the axis room to read. */
const MIN_LEFT_PADDING = 48;

/** Floor for right padding, matching the original visual inset. */
const MIN_RIGHT_PADDING = 12;

export interface ChartPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Estimated rendered width of an axis label, in user units. */
export function estimateAxisLabelWidth(label: string): number {
  return label.length * AXIS_CHAR_WIDTH;
}

/**
 * Padding that guarantees every supplied label fits inside the viewBox.
 *
 * - `left` must clear the widest y-axis label plus its gap, because those are
 *   drawn with textAnchor="end" at `left - Y_LABEL_GAP`.
 * - `right` must clear half the last x-axis label, because that one is drawn
 *   with textAnchor="middle" centred on the plot's right edge.
 */
export function computeChartPadding(
  yAxisLabels: readonly string[],
  lastXAxisLabel: string,
): ChartPadding {
  const widestY = yAxisLabels.reduce(
    (max, label) => Math.max(max, estimateAxisLabelWidth(label)),
    0,
  );

  return {
    top: 12,
    bottom: 24,
    left: Math.ceil(Math.max(MIN_LEFT_PADDING, widestY + Y_LABEL_GAP)),
    right: Math.ceil(
      Math.max(MIN_RIGHT_PADDING, estimateAxisLabelWidth(lastXAxisLabel) / 2),
    ),
  };
}

/**
 * How far the axis labels spill outside the viewBox, in user units. Both
 * numbers must be <= 0 for the chart to render uncropped; positive means that
 * many units are being clipped. Exists so the invariant is directly assertable
 * rather than inferred from the padding numbers.
 */
export function axisLabelOverflow(
  yAxisLabels: readonly string[],
  lastXAxisLabel: string,
): { left: number; right: number } {
  const padding = computeChartPadding(yAxisLabels, lastXAxisLabel);

  const widestY = yAxisLabels.reduce(
    (max, label) => Math.max(max, estimateAxisLabelWidth(label)),
    0,
  );
  // y labels end at (left - gap) and extend leftward by their own width.
  const leftmost = padding.left - Y_LABEL_GAP - widestY;
  // The last x label is centred on the plot's right edge.
  const rightmost =
    CHART_WIDTH - padding.right + estimateAxisLabelWidth(lastXAxisLabel) / 2;

  return { left: -leftmost, right: rightmost - CHART_WIDTH };
}

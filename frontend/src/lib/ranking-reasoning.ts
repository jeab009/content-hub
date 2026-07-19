import type { OverrideFeedbackInput, RankingFactor } from '@/lib/api-client';

/**
 * Pure formatting for ranking-score reasoning, and specifically for v2's
 * `override_feedback` factor (Phase 5A.5) — the signal learned from the
 * admin's own past override decisions.
 *
 * That factor is the one place the engine scores the admin's behaviour back at
 * them, so "explainable in the UI, no black box" (constraint C-D) means the
 * raw counts must be readable, not just the derived 0..1 value. Everything
 * here is pure so the wording is unit-testable without rendering a component.
 */

/** The v2-only factor name carrying the override signal. */
export const OVERRIDE_FEEDBACK_FACTOR = 'override_feedback';

export function isOverrideFeedbackFactor(factor: RankingFactor): boolean {
  return factor.name === OVERRIDE_FEEDBACK_FACTOR;
}

/**
 * Reads a factor's loosely-typed jsonb `input` as the override-feedback shape.
 * Fields stay optional: the factor emits a reduced set when it short-circuits
 * to neutral, and a score row written by an older engine may lack them all.
 */
export function overrideFeedbackInput(factor: RankingFactor): OverrideFeedbackInput {
  return factor.input as OverrideFeedbackInput;
}

/**
 * True when the factor was pinned to the neutral 0.5 rather than computed.
 * The engine flags this explicitly (`neutral: true`), which is what we trust —
 * a *computed* value can legitimately land on 0.5 too, and reading the number
 * alone would mislabel it.
 */
export function isNeutralFactor(input: OverrideFeedbackInput): boolean {
  return input.neutral === true;
}

/** Why the factor went neutral, in the admin's words rather than the enum's. */
const NEUTRAL_REASONS: Record<string, string> = {
  below_min_sample_size: 'Not enough override history yet to be a signal',
  content_has_no_pillar: 'This content has no pillar, so there is no history to compare against',
};

export function describeNeutralReason(input: OverrideFeedbackInput): string {
  if (input.reason && NEUTRAL_REASONS[input.reason]) {
    return NEUTRAL_REASONS[input.reason];
  }
  return 'Held at neutral — the signal was not computed for this score';
}

/** One raw count from the override read model, ready to render as a row. */
export interface OverrideFeedbackCount {
  label: string;
  value: number;
}

/**
 * The raw counts behind the factor, in the order that reads as a sentence:
 * how many decisions were in the window, how often this platform was
 * recommended, how often it was overridden away from, and how often it was
 * chosen as the override target. Absent fields are dropped rather than
 * rendered as zero — "no data" and "zero" are different claims.
 */
export function overrideFeedbackCounts(input: OverrideFeedbackInput): OverrideFeedbackCount[] {
  const rows: Array<[string, number | undefined]> = [
    ['Decisions in window (sample size)', input.sampleSize],
    ['Times this platform was recommended', input.recommendedCount],
    ['Times it was overridden away from', input.overriddenAwayCount],
    ['Times it was chosen as the override', input.selectedAsOverrideCount],
  ];
  return rows
    .filter((row): row is [string, number] => typeof row[1] === 'number')
    .map(([label, value]) => ({ label, value }));
}

/**
 * One-line summary of what the factor did to the score. Neutral cases say so
 * explicitly and name the threshold, because "0.5, held neutral" and "0.5,
 * computed from a balanced history" mean very different things to an admin
 * deciding whether to trust the recommendation.
 */
export function summarizeOverrideFeedback(input: OverrideFeedbackInput): string {
  if (isNeutralFactor(input)) {
    const threshold =
      typeof input.minSampleSize === 'number'
        ? ` (needs ${input.minSampleSize}, has ${input.sampleSize ?? 0})`
        : '';
    return `NEUTRAL — ${describeNeutralReason(input)}${threshold}.`;
  }
  const away = formatRate(input.awayRate);
  const toward = formatRate(input.towardRate);
  const window =
    typeof input.lookbackDays === 'number' ? ` over the last ${input.lookbackDays} days` : '';
  return `Computed from real override history${window}: overridden away ${away} of the time, chosen as the override ${toward} of the time.`;
}

function formatRate(rate: number | undefined): string {
  return typeof rate === 'number' ? `${Math.round(rate * 100)}%` : '—';
}

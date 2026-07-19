import { describe, expect, it } from '@jest/globals';
import type { OverrideFeedbackInput, RankingFactor } from '@/lib/api-client';
import {
  isNeutralFactor,
  isOverrideFeedbackFactor,
  describeNeutralReason,
  overrideFeedbackCounts,
  overrideFeedbackInput,
  summarizeOverrideFeedback,
} from '@/lib/ranking-reasoning';
import { labels } from '@/lib/content-labels';

/** A computed override_feedback factor, shaped exactly as the v2 engine emits it. */
function computedFactor(overrides: Partial<OverrideFeedbackInput> = {}): RankingFactor {
  return {
    name: 'override_feedback',
    weight: 0.2,
    value: 0.6,
    contribution: 0.12,
    input: {
      pillar: 'product',
      platform: 'tiktok',
      sampleSize: 12,
      recommendedCount: 5,
      overriddenAwayCount: 1,
      selectedAsOverrideCount: 3,
      lookbackDays: 90,
      minSampleSize: 5,
      awayRate: 0.0833,
      towardRate: 0.25,
      normalizer: 2,
      ...overrides,
    },
  };
}

/** The reduced shape the engine emits when it short-circuits to neutral. */
function neutralFactor(overrides: Partial<OverrideFeedbackInput> = {}): RankingFactor {
  return {
    name: 'override_feedback',
    weight: 0.2,
    value: 0.5,
    contribution: 0.1,
    input: {
      pillar: 'product',
      platform: 'tiktok',
      sampleSize: 3,
      recommendedCount: 1,
      overriddenAwayCount: 0,
      selectedAsOverrideCount: 0,
      lookbackDays: 90,
      minSampleSize: 5,
      reason: 'below_min_sample_size',
      neutral: true,
      ...overrides,
    },
  };
}

describe('isOverrideFeedbackFactor', () => {
  it('matches only the v2 override factor', () => {
    expect(isOverrideFeedbackFactor(computedFactor())).toBe(true);
    expect(
      isOverrideFeedbackFactor({ ...computedFactor(), name: 'engagement_history' }),
    ).toBe(false);
  });
});

describe('isNeutralFactor', () => {
  it('trusts the engine flag rather than inferring from the value', () => {
    expect(isNeutralFactor(overrideFeedbackInput(neutralFactor()))).toBe(true);
    expect(isNeutralFactor(overrideFeedbackInput(computedFactor()))).toBe(false);
  });

  it('does NOT call a computed 0.5 neutral — a balanced history is a real signal', () => {
    const balanced = computedFactor({ awayRate: 0.1, towardRate: 0.1 });
    expect(balanced.value).not.toBe(0.5);
    expect(isNeutralFactor(overrideFeedbackInput({ ...balanced, value: 0.5 }))).toBe(false);
  });
});

describe('overrideFeedbackCounts', () => {
  it('exposes all four raw counts in reading order', () => {
    const counts = overrideFeedbackCounts(overrideFeedbackInput(computedFactor()));
    expect(counts).toEqual([
      { label: 'Decisions in window (sample size)', value: 12 },
      { label: 'Times this platform was recommended', value: 5 },
      { label: 'Times it was overridden away from', value: 1 },
      { label: 'Times it was chosen as the override', value: 3 },
    ]);
  });

  it('still shows the counts in the neutral case, so the admin sees how short the sample is', () => {
    const counts = overrideFeedbackCounts(overrideFeedbackInput(neutralFactor()));
    expect(counts).toContainEqual({ label: 'Decisions in window (sample size)', value: 3 });
  });

  it('omits absent fields rather than rendering them as zero', () => {
    const counts = overrideFeedbackCounts(
      overrideFeedbackInput(neutralFactor({ recommendedCount: undefined })),
    );
    expect(counts.map((row) => row.label)).not.toContain('Times this platform was recommended');
  });

  it('keeps a genuine zero, which is a different claim from missing', () => {
    const counts = overrideFeedbackCounts(
      overrideFeedbackInput(computedFactor({ overriddenAwayCount: 0 })),
    );
    expect(counts).toContainEqual({ label: 'Times it was overridden away from', value: 0 });
  });
});

describe('summarizeOverrideFeedback', () => {
  it('says NEUTRAL and names the unmet threshold below min sample size', () => {
    const summary = summarizeOverrideFeedback(overrideFeedbackInput(neutralFactor()));
    expect(summary).toContain('NEUTRAL');
    expect(summary).toContain('Not enough override history yet');
    expect(summary).toContain('needs 5, has 3');
  });

  it('explains the no-pillar neutral case distinctly', () => {
    const summary = summarizeOverrideFeedback(
      overrideFeedbackInput(neutralFactor({ reason: 'content_has_no_pillar' })),
    );
    expect(summary).toContain('NEUTRAL');
    expect(summary).toContain('no pillar');
  });

  it('reports both rates as percentages when the factor was computed', () => {
    const summary = summarizeOverrideFeedback(overrideFeedbackInput(computedFactor()));
    expect(summary).toContain('over the last 90 days');
    expect(summary).toContain('overridden away 8% of the time');
    expect(summary).toContain('chosen as the override 25% of the time');
    expect(summary).not.toContain('NEUTRAL');
  });

  it('degrades to an em dash rather than NaN when a rate is missing', () => {
    const summary = summarizeOverrideFeedback(
      overrideFeedbackInput(computedFactor({ awayRate: undefined })),
    );
    expect(summary).toContain('overridden away — of the time');
    expect(summary).not.toContain('NaN');
  });
});

describe('describeNeutralReason', () => {
  it('falls back to a generic explanation for an unrecognised reason', () => {
    expect(describeNeutralReason({ reason: 'some_future_reason' })).toContain('Held at neutral');
  });
});

describe('engine version badge', () => {
  it('names the factor count for each engine so v1 and v2 scores are distinguishable', () => {
    expect(labels.engineVersion('v1')).toContain('v1');
    expect(labels.engineVersion('v1')).toContain('4 factors');
    expect(labels.engineVersion('v2')).toContain('v2');
    expect(labels.engineVersion('v2')).toContain('5 factors');
  });

  it('falls back readably for an engine version this build predates', () => {
    expect(labels.engineVersion('v3')).toBe('Engine v3');
  });
});

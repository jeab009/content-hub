import { describe, expect, it } from '@jest/globals';
import type { ReadyContentOverview, ReadyContentScore } from '@/lib/api-client';
import {
  canSubmitPublish,
  isOverride,
  needsRanking,
  overrideReasonRequired,
  recommendedScore,
} from '@/lib/publish-logic';

function score(overrides: Partial<ReadyContentScore> = {}): ReadyContentScore {
  return {
    id: 'score-1',
    platform: 'facebook',
    score: 0.72,
    computedAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

function content(overrides: Partial<ReadyContentOverview> = {}): ReadyContentOverview {
  return {
    contentId: 'content-1',
    title: 'Demo',
    type: 'video',
    contentPillar: 'product',
    createdAt: '2026-07-18T00:00:00.000Z',
    latestScores: [score({ platform: 'facebook', score: 0.72 }), score({ platform: 'youtube', score: 0.5 })],
    recommendedPlatform: 'facebook',
    ...overrides,
  };
}

describe('isOverride', () => {
  it('is false when the selected platform matches the recommendation', () => {
    expect(isOverride('facebook', 'facebook')).toBe(false);
  });

  it('is true when the selected platform differs from the recommendation', () => {
    expect(isOverride('youtube', 'facebook')).toBe(true);
  });

  it('is never an override when there is no recommendation', () => {
    expect(isOverride('youtube', null)).toBe(false);
  });
});

describe('overrideReasonRequired', () => {
  it('requires a reason only when overriding a real recommendation', () => {
    expect(overrideReasonRequired('youtube', 'facebook')).toBe(true);
    expect(overrideReasonRequired('facebook', 'facebook')).toBe(false);
    expect(overrideReasonRequired('youtube', null)).toBe(false);
  });
});

describe('canSubmitPublish', () => {
  it('is disabled without a password', () => {
    expect(
      canSubmitPublish({
        selected: 'facebook',
        recommended: 'facebook',
        password: '   ',
        overrideReason: '',
      }),
    ).toBe(false);
  });

  it('is enabled for a non-override with a password', () => {
    expect(
      canSubmitPublish({
        selected: 'facebook',
        recommended: 'facebook',
        password: 'secret',
        overrideReason: '',
      }),
    ).toBe(true);
  });

  it('blocks an override until a reason is supplied', () => {
    expect(
      canSubmitPublish({
        selected: 'youtube',
        recommended: 'facebook',
        password: 'secret',
        overrideReason: '',
      }),
    ).toBe(false);
    expect(
      canSubmitPublish({
        selected: 'youtube',
        recommended: 'facebook',
        password: 'secret',
        overrideReason: 'Sponsor requested YouTube',
      }),
    ).toBe(true);
  });
});

describe('recommendedScore', () => {
  it('returns the score row for the recommended platform', () => {
    expect(recommendedScore(content())?.platform).toBe('facebook');
    expect(recommendedScore(content())?.score).toBe(0.72);
  });

  it('returns null when there is no recommendation', () => {
    expect(recommendedScore(content({ recommendedPlatform: null }))).toBeNull();
  });

  it('returns null when the recommended platform has no score row', () => {
    expect(
      recommendedScore(content({ recommendedPlatform: 'youtube', latestScores: [score()] })),
    ).toBeNull();
  });
});

describe('needsRanking', () => {
  it('is true when a content has no scores yet', () => {
    expect(needsRanking(content({ latestScores: [] }))).toBe(true);
  });

  it('is false once scores exist', () => {
    expect(needsRanking(content())).toBe(false);
  });
});

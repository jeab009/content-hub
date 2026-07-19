import { describe, expect, it } from '@jest/globals';
import type {
  AssetPlatform,
  PostPlatform,
  ReadyContentOverview,
  ReadyContentScore,
} from '@/lib/api-client';
import {
  canSubmitManualRecord,
  canSubmitPublish,
  isManualRecordPlatform,
  isOverride,
  isValidExternalPostId,
  isValidExternalPostUrl,
  needsRanking,
  overrideReasonRequired,
  recommendedScore,
  toAssetPlatform,
  EXTERNAL_POST_ID_MAX_LENGTH,
} from '@/lib/publish-logic';
import { ASSET_PLATFORMS, labels } from '@/lib/content-labels';

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

describe('four-platform coverage', () => {
  it('labels every AssetPlatform without falling through to undefined', () => {
    expect(ASSET_PLATFORMS).toEqual(['facebook', 'youtube', 'tiktok', 'line_oa']);
    for (const platform of ASSET_PLATFORMS) {
      expect(labels.platform(platform)).toBeTruthy();
    }
  });

  it('labels every post-side platform, including LINE under its other enum name', () => {
    const postPlatforms: PostPlatform[] = ['facebook', 'youtube', 'tiktok', 'line'];
    for (const platform of postPlatforms) {
      expect(labels.postPlatform(platform)).toBeTruthy();
    }
    expect(labels.postPlatform('line')).toBe('LINE OA');
  });

  it('no longer labels TikTok and LINE as unshipped Phase 5 platforms', () => {
    expect(labels.platform('tiktok')).toBe('TikTok');
    expect(labels.platform('line_oa')).toBe('LINE OA');
  });
});

describe('toAssetPlatform', () => {
  it('maps LINE across the two enum spellings', () => {
    expect(toAssetPlatform('line')).toBe('line_oa');
  });

  it('is identity for the three platforms the enums agree on', () => {
    expect(toAssetPlatform('facebook')).toBe('facebook');
    expect(toAssetPlatform('youtube')).toBe('youtube');
    expect(toAssetPlatform('tiktok')).toBe('tiktok');
  });

  it('produces a value the AssetPlatform label map actually has a key for', () => {
    const postPlatforms: PostPlatform[] = ['facebook', 'youtube', 'tiktok', 'line'];
    for (const platform of postPlatforms) {
      const asset: AssetPlatform = toAssetPlatform(platform);
      expect(ASSET_PLATFORMS).toContain(asset);
    }
  });
});

describe('isManualRecordPlatform', () => {
  it('flags the two platforms with no verified live integration', () => {
    expect(isManualRecordPlatform('tiktok')).toBe(true);
    expect(isManualRecordPlatform('line_oa')).toBe(true);
  });

  it('does not flag the adapter-published platforms', () => {
    expect(isManualRecordPlatform('facebook')).toBe(false);
    expect(isManualRecordPlatform('youtube')).toBe(false);
  });
});

describe('isValidExternalPostId', () => {
  it('requires a non-blank id', () => {
    expect(isValidExternalPostId('')).toBe(false);
    expect(isValidExternalPostId('   ')).toBe(false);
    expect(isValidExternalPostId('tt_9981')).toBe(true);
  });

  it('rejects an id longer than the DTO allows', () => {
    expect(isValidExternalPostId('x'.repeat(EXTERNAL_POST_ID_MAX_LENGTH))).toBe(true);
    expect(isValidExternalPostId('x'.repeat(EXTERNAL_POST_ID_MAX_LENGTH + 1))).toBe(false);
  });
});

describe('isValidExternalPostUrl', () => {
  it('treats blank as valid — a LINE broadcast has no permalink', () => {
    expect(isValidExternalPostUrl('')).toBe(true);
    expect(isValidExternalPostUrl('   ')).toBe(true);
  });

  it('accepts absolute http and https URLs', () => {
    expect(isValidExternalPostUrl('https://www.tiktok.com/@x/video/1')).toBe(true);
    expect(isValidExternalPostUrl('http://example.com/p/1')).toBe(true);
  });

  it('rejects a URL with no protocol, matching require_protocol on the DTO', () => {
    expect(isValidExternalPostUrl('www.tiktok.com/@x/video/1')).toBe(false);
  });

  it('rejects non-http protocols', () => {
    expect(isValidExternalPostUrl('ftp://example.com/p/1')).toBe(false);
    expect(isValidExternalPostUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('canSubmitManualRecord', () => {
  const base = {
    selected: 'tiktok' as AssetPlatform,
    recommended: 'tiktok' as AssetPlatform | null,
    externalPostId: 'tt_9981',
    externalPostUrl: '',
    password: 'secret',
    overrideReason: '',
  };

  it('is enabled for a non-override with an id and a password', () => {
    expect(canSubmitManualRecord(base)).toBe(true);
  });

  it('is disabled without the platform-native post id', () => {
    expect(canSubmitManualRecord({ ...base, externalPostId: '  ' })).toBe(false);
  });

  it('is disabled without a password', () => {
    expect(canSubmitManualRecord({ ...base, password: '' })).toBe(false);
  });

  it('is disabled when the optional URL is present but malformed', () => {
    expect(canSubmitManualRecord({ ...base, externalPostUrl: 'not-a-url' })).toBe(false);
    expect(
      canSubmitManualRecord({ ...base, externalPostUrl: 'https://tiktok.com/p/1' }),
    ).toBe(true);
  });

  it('blocks an override until a reason is supplied', () => {
    const overriding = { ...base, selected: 'line_oa' as AssetPlatform, recommended: 'tiktok' as AssetPlatform };
    expect(canSubmitManualRecord(overriding)).toBe(false);
    expect(canSubmitManualRecord({ ...overriding, overrideReason: 'Posted to LINE by request' })).toBe(
      true,
    );
  });

  it('does not require a reason when the content was never ranked', () => {
    expect(canSubmitManualRecord({ ...base, recommended: null, selected: 'line_oa' })).toBe(true);
  });
});

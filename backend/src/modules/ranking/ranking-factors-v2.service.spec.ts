import { AssetPlatform, ContentPillar } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RankingFactorsService } from './ranking-factors.service';
import { RankingFactorsV2Service } from './ranking-factors-v2.service';
import { NEUTRAL_FACTOR_VALUE } from './ranking.constants';
import {
  FACTOR_WEIGHTS_V2,
  OVERRIDE_MIN_SAMPLE_SIZE,
  OVERRIDE_RATE_NORMALIZER,
} from './ranking-v2.constants';

type Decision = {
  recommendedPlatform: AssetPlatform | null;
  selectedPlatform: AssetPlatform | null;
  wasOverride: boolean;
};

/** n decisions where `platform` was recommended and the admin took it. */
function followed(platform: AssetPlatform, count: number): Decision[] {
  return Array.from({ length: count }, () => ({
    recommendedPlatform: platform,
    selectedPlatform: platform,
    wasOverride: false,
  }));
}

/** n decisions where `from` was recommended but the admin published on `to`. */
function overrodeAway(from: AssetPlatform, to: AssetPlatform, count: number): Decision[] {
  return Array.from({ length: count }, () => ({
    recommendedPlatform: from,
    selectedPlatform: to,
    wasOverride: true,
  }));
}

describe('RankingFactorsV2Service', () => {
  let prisma: {
    metric: { aggregate: jest.Mock };
    post: { findMany: jest.Mock; count: jest.Mock };
    pillarRatioPolicy: { findFirst: jest.Mock };
    platformCadenceTarget: { findFirst: jest.Mock };
  };
  let service: RankingFactorsV2Service;

  beforeEach(() => {
    prisma = {
      metric: { aggregate: jest.fn() },
      post: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      pillarRatioPolicy: { findFirst: jest.fn().mockResolvedValue(null) },
      platformCadenceTarget: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const prismaService = prisma as unknown as PrismaService;
    service = new RankingFactorsV2Service(prismaService, new RankingFactorsService(prismaService));
  });

  describe('engagement_history — blends engagement AND revenue (the v2 change)', () => {
    /** platform aggregate first, then the pillar-wide aggregate. */
    function mockAggregates(
      platform: {
        engagement: number;
        revenue: number;
        count: number;
      },
      overall: { engagement: number; revenue: number },
    ): void {
      prisma.metric.aggregate
        .mockResolvedValueOnce({
          _avg: { engagement: platform.engagement, revenue: platform.revenue },
          _count: { _all: platform.count },
        })
        .mockResolvedValueOnce({
          _avg: { engagement: overall.engagement, revenue: overall.revenue },
          _count: { _all: platform.count },
        });
    }

    it('scores above neutral when the platform out-earns the pillar average, even at average engagement', async () => {
      // Engagement exactly at the pillar average (component 0.5) but revenue
      // well above it — v1 would have returned a flat 0.5 here because it
      // never looked at revenue. That difference is the point of v2.
      mockAggregates(
        { engagement: 100, revenue: 900, count: 12 },
        { engagement: 100, revenue: 100 },
      );

      const factor = await service.engagementHistory(ContentPillar.comedy, AssetPlatform.youtube);

      expect(factor.input.engagementComponent).toBe(0.5);
      expect(Number(factor.input.revenueComponent)).toBeGreaterThan(0.5);
      expect(factor.value).toBeGreaterThan(NEUTRAL_FACTOR_VALUE);
      expect(factor.input.platformAvgRevenue).toBe(900);
      expect(factor.input.pillarAvgRevenueAllPlatforms).toBe(100);
    });

    it('falls back to a neutral revenue component when nothing has earned yet', async () => {
      mockAggregates({ engagement: 300, revenue: 0, count: 5 }, { engagement: 100, revenue: 0 });

      const factor = await service.engagementHistory(ContentPillar.product, AssetPlatform.facebook);

      // Zero revenue everywhere must not drag the blend toward zero.
      expect(factor.input.revenueComponent).toBe(NEUTRAL_FACTOR_VALUE);
      expect(factor.value).toBeGreaterThan(NEUTRAL_FACTOR_VALUE);
    });

    it('is neutral with no history at all', async () => {
      mockAggregates({ engagement: 0, revenue: 0, count: 0 }, { engagement: 0, revenue: 0 });

      const factor = await service.engagementHistory(ContentPillar.drama, AssetPlatform.tiktok);

      expect(factor.value).toBe(NEUTRAL_FACTOR_VALUE);
      expect(factor.input.reason).toBe('no_engagement_history');
    });

    it('carries the v2 weight and a matching contribution', async () => {
      mockAggregates(
        { engagement: 100, revenue: 100, count: 9 },
        { engagement: 100, revenue: 100 },
      );

      const factor = await service.engagementHistory(ContentPillar.comedy, AssetPlatform.facebook);

      expect(factor.weight).toBe(FACTOR_WEIGHTS_V2.engagementHistory);
      expect(factor.contribution).toBeCloseTo(factor.weight * factor.value, 10);
    });
  });

  describe('override_feedback — the new v2 factor', () => {
    it('DOWN-weights a platform the admin keeps overriding away from', async () => {
      prisma.post.findMany.mockResolvedValue([
        ...overrodeAway(AssetPlatform.facebook, AssetPlatform.tiktok, 6),
        ...followed(AssetPlatform.youtube, 2),
      ]);

      const factor = await service.overrideFeedback(ContentPillar.comedy, AssetPlatform.facebook);

      expect(factor.value).toBeLessThan(NEUTRAL_FACTOR_VALUE);
      expect(factor.input.recommendedCount).toBe(6);
      expect(factor.input.overriddenAwayCount).toBe(6);
      expect(factor.input.selectedAsOverrideCount).toBe(0);
      expect(factor.input.sampleSize).toBe(8);
      expect(factor.input.awayRate).toBe(0.75);
    });

    it('UP-weights a platform the admin keeps choosing as the override target', async () => {
      prisma.post.findMany.mockResolvedValue([
        ...overrodeAway(AssetPlatform.facebook, AssetPlatform.tiktok, 6),
        ...followed(AssetPlatform.youtube, 2),
      ]);

      const factor = await service.overrideFeedback(ContentPillar.comedy, AssetPlatform.tiktok);

      expect(factor.value).toBeGreaterThan(NEUTRAL_FACTOR_VALUE);
      expect(factor.input.selectedAsOverrideCount).toBe(6);
      expect(factor.input.overriddenAwayCount).toBe(0);
      expect(factor.input.towardRate).toBe(0.75);
    });

    it('stays NEUTRAL below the min-sample threshold, and still reports the counts', async () => {
      const belowThreshold = OVERRIDE_MIN_SAMPLE_SIZE - 1;
      prisma.post.findMany.mockResolvedValue(
        overrodeAway(AssetPlatform.facebook, AssetPlatform.tiktok, belowThreshold),
      );

      const factor = await service.overrideFeedback(ContentPillar.comedy, AssetPlatform.facebook);

      // Unanimously overridden away — but on too little evidence to act on.
      expect(factor.value).toBe(NEUTRAL_FACTOR_VALUE);
      expect(factor.input.reason).toBe('below_min_sample_size');
      expect(factor.input.sampleSize).toBe(belowThreshold);
      expect(factor.input.overriddenAwayCount).toBe(belowThreshold);
      expect(factor.input.minSampleSize).toBe(OVERRIDE_MIN_SAMPLE_SIZE);
    });

    it('is neutral with no override history at all', async () => {
      prisma.post.findMany.mockResolvedValue([]);

      const factor = await service.overrideFeedback(ContentPillar.drama, AssetPlatform.line_oa);

      expect(factor.value).toBe(NEUTRAL_FACTOR_VALUE);
      expect(factor.input.sampleSize).toBe(0);
    });

    it('is neutral for content with no pillar', async () => {
      const factor = await service.overrideFeedback(null, AssetPlatform.facebook);

      expect(factor.value).toBe(NEUTRAL_FACTOR_VALUE);
      expect(factor.input.reason).toBe('content_has_no_pillar');
      expect(prisma.post.findMany).not.toHaveBeenCalled();
    });

    // R4: the factor is bounded, so even a unanimous history is advisory
    // rather than decisive. These are the WORST-CASE extremes — reachable only
    // when every decision in the window went the same way.
    it('is bounded: even a unanimous history moves a total score by at most ±0.10', async () => {
      prisma.post.findMany.mockResolvedValue(
        overrodeAway(AssetPlatform.facebook, AssetPlatform.tiktok, 20),
      );

      const worst = await service.overrideFeedback(ContentPillar.comedy, AssetPlatform.facebook);
      const best = await service.overrideFeedback(ContentPillar.comedy, AssetPlatform.tiktok);

      const halfSpan = 1 / OVERRIDE_RATE_NORMALIZER;
      expect(worst.value).toBeGreaterThanOrEqual(NEUTRAL_FACTOR_VALUE - halfSpan);
      expect(best.value).toBeLessThanOrEqual(NEUTRAL_FACTOR_VALUE + halfSpan);

      const neutralContribution = FACTOR_WEIGHTS_V2.overrideFeedback * NEUTRAL_FACTOR_VALUE;
      const maxSwing = FACTOR_WEIGHTS_V2.overrideFeedback * halfSpan; // 0.20 * 0.5 = 0.10
      expect(Math.abs(worst.contribution - neutralContribution)).toBeLessThanOrEqual(
        maxSwing + 1e-9,
      );
      expect(Math.abs(best.contribution - neutralContribution)).toBeLessThanOrEqual(
        maxSwing + 1e-9,
      );
    });

    it('reads only the fields it needs, over the lookback window and pillar', async () => {
      await service.overrideFeedback(ContentPillar.comedy, AssetPlatform.facebook);

      const [args] = prisma.post.findMany.mock.calls[0] as [
        { where: Record<string, unknown>; select: Record<string, boolean> },
      ];
      expect(args.where.recommendedPlatform).toEqual({ not: null });
      expect(args.where.content).toEqual({ contentPillar: ContentPillar.comedy });
      expect(args.select).toEqual({
        recommendedPlatform: true,
        selectedPlatform: true,
        wasOverride: true,
      });
    });
  });

  describe('re-weighted v1 factors', () => {
    it('keeps the v1 api_availability VALUE but applies the v2 weight', async () => {
      const v1 = new RankingFactorsService(prisma as unknown as PrismaService);

      const v1Factor = v1.apiAvailability(AssetPlatform.tiktok);
      const v2Factor = service.apiAvailability(AssetPlatform.tiktok);

      expect(v2Factor.value).toBe(v1Factor.value); // same formula
      expect(v2Factor.weight).toBe(FACTOR_WEIGHTS_V2.apiAvailability);
      expect(v2Factor.contribution).toBeCloseTo(v2Factor.weight * v2Factor.value, 10);
    });

    it('re-weights cadence_pressure without changing its value', async () => {
      prisma.platformCadenceTarget.findFirst.mockResolvedValue({
        targetPostsPerPeriod: 14,
        periodUnit: 'week',
      });
      prisma.post.count.mockResolvedValue(7);

      const factor = await service.cadencePressure(AssetPlatform.tiktok);

      expect(factor.value).toBe(0.5); // 1 - 7/14, the frozen v1 formula
      expect(factor.weight).toBe(FACTOR_WEIGHTS_V2.cadencePressure);
      expect(factor.input.targetPostsPerPeriod).toBe(14);
    });
  });
});

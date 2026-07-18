import { AssetPlatform, ContentPillar } from '@prisma/client';
import { RankingFactorsService } from './ranking-factors.service';
import { PrismaService } from '../prisma/prisma.service';
import { FACTOR_WEIGHTS, NEUTRAL_FACTOR_VALUE } from './ranking.constants';

describe('RankingFactorsService', () => {
  let prisma: {
    metric: { aggregate: jest.Mock };
    post: { count: jest.Mock };
    pillarRatioPolicy: { findFirst: jest.Mock };
    platformCadenceTarget: { findFirst: jest.Mock };
  };
  let service: RankingFactorsService;

  beforeEach(() => {
    prisma = {
      metric: { aggregate: jest.fn() },
      post: { count: jest.fn() },
      pillarRatioPolicy: { findFirst: jest.fn() },
      platformCadenceTarget: { findFirst: jest.fn() },
    };
    service = new RankingFactorsService(prisma as unknown as PrismaService);
  });

  describe('engagementHistory', () => {
    it('is neutral (0.5) when there is no history yet — the launch state', async () => {
      prisma.metric.aggregate.mockResolvedValue({
        _avg: { engagement: null, revenue: null },
        _count: { _all: 0 },
      });

      const factor = await service.engagementHistory(ContentPillar.comedy, AssetPlatform.facebook);

      expect(factor.value).toBe(NEUTRAL_FACTOR_VALUE);
      expect(factor.input.neutral).toBe(true);
      expect(factor.contribution).toBeCloseTo(
        FACTOR_WEIGHTS.engagementHistory * NEUTRAL_FACTOR_VALUE,
      );
    });

    it('is neutral when the content has no pillar assigned', async () => {
      const factor = await service.engagementHistory(null, AssetPlatform.facebook);

      expect(factor.value).toBe(NEUTRAL_FACTOR_VALUE);
      expect(factor.input.reason).toBe('content_has_no_pillar');
      expect(prisma.metric.aggregate).not.toHaveBeenCalled();
    });

    it('scores above 0.5 when the platform outperforms the pillar cross-platform average', async () => {
      prisma.metric.aggregate
        .mockResolvedValueOnce({
          _avg: { engagement: 300, revenue: 10 },
          _count: { _all: 5 },
        }) // platform-specific
        .mockResolvedValueOnce({ _avg: { engagement: 100 }, _count: { _all: 12 } }); // all platforms

      const factor = await service.engagementHistory(ContentPillar.product, AssetPlatform.facebook);

      expect(factor.value).toBeCloseTo(300 / (300 + 100));
      expect(factor.value).toBeGreaterThan(NEUTRAL_FACTOR_VALUE);
      expect(factor.input.sampleSize).toBe(5);
    });
  });

  describe('apiAvailability', () => {
    it('weights auto-sync platforms above manual ones', () => {
      const facebook = service.apiAvailability(AssetPlatform.facebook);
      const tiktok = service.apiAvailability(AssetPlatform.tiktok);

      expect(facebook.value).toBeGreaterThan(tiktok.value);
      expect(facebook.value).toBe(1);
    });
  });

  describe('pillarAlignment', () => {
    beforeEach(() => {
      prisma.pillarRatioPolicy.findFirst.mockResolvedValue({
        targetRatioPct: 40,
        effectiveFrom: new Date('2026-07-01'),
      });
    });

    it('scores above 0.5 when the pillar is under its target ratio', async () => {
      prisma.post.count.mockResolvedValueOnce(10).mockResolvedValueOnce(1); // total, pillar → 10% actual vs 40% target

      const factor = await service.pillarAlignment(ContentPillar.product);

      expect(factor.value).toBeCloseTo(0.5 + (40 - 10) / 100);
      expect(factor.value).toBeGreaterThan(NEUTRAL_FACTOR_VALUE);
    });

    it('scores below 0.5 when the pillar is over its target ratio', async () => {
      prisma.post.count.mockResolvedValueOnce(10).mockResolvedValueOnce(8); // 80% actual vs 40% target

      const factor = await service.pillarAlignment(ContentPillar.product);

      expect(factor.value).toBeCloseTo(0.5 + (40 - 80) / 100);
      expect(factor.value).toBeLessThan(NEUTRAL_FACTOR_VALUE);
    });

    it('is neutral when no ratio policy exists', async () => {
      prisma.pillarRatioPolicy.findFirst.mockResolvedValue(null);

      const factor = await service.pillarAlignment(ContentPillar.drama);

      expect(factor.value).toBe(NEUTRAL_FACTOR_VALUE);
      expect(factor.input.reason).toBe('no_ratio_policy');
    });
  });

  describe('cadencePressure', () => {
    beforeEach(() => {
      prisma.platformCadenceTarget.findFirst.mockResolvedValue({
        targetPostsPerPeriod: 7,
        periodUnit: 'week',
        effectiveFrom: new Date('2026-07-01'),
      });
    });

    it('scores 1.0 when nothing has been published this period', async () => {
      prisma.post.count.mockResolvedValue(0);

      const factor = await service.cadencePressure(AssetPlatform.facebook);

      expect(factor.value).toBe(1);
    });

    it('scores lower the closer the platform is to its target', async () => {
      prisma.post.count.mockResolvedValue(5);

      const factor = await service.cadencePressure(AssetPlatform.facebook);

      expect(factor.value).toBeCloseTo(1 - 5 / 7);
    });

    it('scores 0 at/over target', async () => {
      prisma.post.count.mockResolvedValue(9);

      const factor = await service.cadencePressure(AssetPlatform.facebook);

      expect(factor.value).toBe(0);
    });

    it('is neutral when the platform has no cadence target', async () => {
      prisma.platformCadenceTarget.findFirst.mockResolvedValue(null);

      const factor = await service.cadencePressure(AssetPlatform.line_oa);

      expect(factor.value).toBe(NEUTRAL_FACTOR_VALUE);
      expect(factor.input.reason).toBe('no_cadence_target');
    });
  });
});

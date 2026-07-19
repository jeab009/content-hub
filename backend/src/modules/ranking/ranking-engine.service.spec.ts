import { NotFoundException } from '@nestjs/common';
import { AssetPlatform, ContentPillar, EngineVersion } from '@prisma/client';
import { RankingEngineService } from './ranking-engine.service';
import { RankingFactorsService } from './ranking-factors.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { activeEngine } from './active-ranking-engine.fixture';
import { FACTOR_WEIGHTS, RankingFactor, RankingReasoning } from './ranking.constants';

function factor(name: RankingFactor['name'], weight: number, value: number): RankingFactor {
  return { name, input: {}, weight, value, contribution: weight * value };
}

describe('RankingEngineService', () => {
  let prisma: {
    content: { findUnique: jest.Mock };
    rankingScore: { create: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let factors: {
    engagementHistory: jest.Mock;
    apiAvailability: jest.Mock;
    pillarAlignment: jest.Mock;
    cadencePressure: jest.Mock;
  };
  let auditLog: { record: jest.Mock };
  let service: RankingEngineService;

  beforeEach(() => {
    prisma = {
      content: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'content-1',
          contentPillar: ContentPillar.product,
        }),
      },
      rankingScore: {
        create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => ({
          id: `score-${args.data.platform as string}`,
          ...args.data,
          computedAt: new Date('2026-07-17T00:00:00Z'),
        })),
        findMany: jest.fn(),
      },
      // Mirrors PrismaService.$transaction(Promise[]): resolve the batch.
      $transaction: jest
        .fn()
        .mockImplementation((operations: unknown[]) => Promise.all(operations)),
    };
    factors = {
      engagementHistory: jest
        .fn()
        .mockResolvedValue(factor('engagement_history', FACTOR_WEIGHTS.engagementHistory, 0.5)),
      apiAvailability: jest
        .fn()
        .mockReturnValue(factor('api_availability', FACTOR_WEIGHTS.apiAvailability, 1)),
      pillarAlignment: jest
        .fn()
        .mockResolvedValue(factor('pillar_alignment', FACTOR_WEIGHTS.pillarAlignment, 0.8)),
      cadencePressure: jest
        .fn()
        .mockResolvedValue(factor('cadence_pressure', FACTOR_WEIGHTS.cadencePressure, 1)),
    };
    auditLog = { record: jest.fn() };
    service = new RankingEngineService(
      prisma as unknown as PrismaService,
      factors as unknown as RankingFactorsService,
      auditLog as unknown as AuditLogService,
      // Reads are scoped to the active engine (BUG-P5-02). These v1 tests run
      // under the default engine; the scoping itself is covered by
      // ranking-engine-mixing.spec.ts.
      activeEngine(EngineVersion.v1),
    );
  });

  describe('computeScores', () => {
    it('throws 404 for unknown content', async () => {
      prisma.content.findUnique.mockResolvedValue(null);

      await expect(service.computeScores('missing', 'admin-1')).rejects.toThrow(NotFoundException);
    });

    it('writes one score row per ranked platform (facebook, youtube)', async () => {
      const scores = await service.computeScores('content-1', 'admin-1');

      expect(scores).toHaveLength(2);
      const platforms = prisma.rankingScore.create.mock.calls.map(
        (call: [{ data: { platform: AssetPlatform } }]) => call[0].data.platform,
      );
      expect(platforms).toEqual([AssetPlatform.facebook, AssetPlatform.youtube]);
    });

    it('totals the score as the exact sum of factor contributions', async () => {
      await service.computeScores('content-1', 'admin-1');

      const [{ data }] = prisma.rankingScore.create.mock.calls[0] as [
        { data: { reasoning: RankingReasoning } },
      ];
      const expectedTotal =
        FACTOR_WEIGHTS.engagementHistory * 0.5 +
        FACTOR_WEIGHTS.apiAvailability * 1 +
        FACTOR_WEIGHTS.pillarAlignment * 0.8 +
        FACTOR_WEIGHTS.cadencePressure * 1;
      expect(data.reasoning.total).toBeCloseTo(expectedTotal, 4);
    });

    it('v1 factor weights sum to exactly 1.0 so scores stay in 0..1', () => {
      const weightSum = Object.values(FACTOR_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
      expect(weightSum).toBeCloseTo(1, 10);
    });

    it('persists an explainable reasoning payload: every factor carries name/input/weight/value/contribution', async () => {
      await service.computeScores('content-1', 'admin-1');

      const [{ data }] = prisma.rankingScore.create.mock.calls[0] as [
        { data: { reasoning: RankingReasoning } },
      ];
      expect(data.reasoning.engineVersion).toBe('v1');
      expect(data.reasoning.factors).toHaveLength(4);
      for (const entry of data.reasoning.factors) {
        expect(entry).toEqual(
          expect.objectContaining({
            name: expect.any(String),
            input: expect.any(Object),
            weight: expect.any(Number),
            value: expect.any(Number),
            contribution: expect.any(Number),
          }),
        );
        expect(entry.contribution).toBeCloseTo(entry.weight * entry.value, 4);
      }
    });

    it('audit-logs the recompute', async () => {
      await service.computeScores('content-1', 'admin-1');

      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ actor: 'admin-1', action: 'ranking_recomputed' }),
      );
    });
  });

  describe('getLatestScores / getRecommendation', () => {
    it('keeps only the newest row per platform', async () => {
      prisma.rankingScore.findMany.mockResolvedValue([
        {
          id: 's3',
          platform: AssetPlatform.facebook,
          score: 0.7,
          computedAt: new Date('2026-07-17'),
        },
        {
          id: 's2',
          platform: AssetPlatform.youtube,
          score: 0.9,
          computedAt: new Date('2026-07-16'),
        },
        {
          id: 's1',
          platform: AssetPlatform.facebook,
          score: 0.2,
          computedAt: new Date('2026-07-15'),
        },
      ]);

      const latest = await service.getLatestScores('content-1');

      expect(latest).toHaveLength(2);
      expect(latest.find((row) => row.platform === AssetPlatform.facebook)?.id).toBe('s3');
    });

    it('recommends the top-scored platform from the latest rows', async () => {
      prisma.rankingScore.findMany.mockResolvedValue([
        {
          id: 's3',
          platform: AssetPlatform.facebook,
          score: 0.7,
          computedAt: new Date('2026-07-17'),
        },
        {
          id: 's2',
          platform: AssetPlatform.youtube,
          score: 0.9,
          computedAt: new Date('2026-07-16'),
        },
      ]);

      const recommendation = await service.getRecommendation('content-1');

      expect(recommendation?.platform).toBe(AssetPlatform.youtube);
    });

    it('returns null recommendation when the content was never ranked', async () => {
      prisma.rankingScore.findMany.mockResolvedValue([]);

      expect(await service.getRecommendation('content-1')).toBeNull();
    });

    describe('BUG-QA-003: deterministic tie-break', () => {
      const tied = (order: 'fb-first' | 'yt-first') => {
        const fb = {
          id: 's-fb',
          platform: AssetPlatform.facebook,
          score: 0.785,
          computedAt: new Date('2026-07-17T10:00:00Z'),
        };
        const yt = {
          id: 's-yt',
          platform: AssetPlatform.youtube,
          score: 0.785,
          computedAt: new Date('2026-07-17T10:00:00Z'),
        };
        return order === 'fb-first' ? [fb, yt] : [yt, fb];
      };

      it('breaks a tie toward the platform earliest in RANKED_PLATFORMS (facebook), regardless of DB row order', async () => {
        prisma.rankingScore.findMany.mockResolvedValueOnce(tied('fb-first'));
        expect((await service.getRecommendation('content-1'))?.platform).toBe(
          AssetPlatform.facebook,
        );

        // Same tie, opposite DB row order → still facebook (deterministic).
        prisma.rankingScore.findMany.mockResolvedValueOnce(tied('yt-first'));
        expect((await service.getRecommendation('content-1'))?.platform).toBe(
          AssetPlatform.facebook,
        );
      });

      it('still picks the strict max when scores are not tied', async () => {
        prisma.rankingScore.findMany.mockResolvedValue([
          {
            id: 's-fb',
            platform: AssetPlatform.facebook,
            score: 0.5,
            computedAt: new Date('2026-07-17T10:00:00Z'),
          },
          {
            id: 's-yt',
            platform: AssetPlatform.youtube,
            score: 0.9,
            computedAt: new Date('2026-07-17T10:00:00Z'),
          },
        ]);

        expect((await service.getRecommendation('content-1'))?.platform).toBe(
          AssetPlatform.youtube,
        );
      });

      it('requests a deterministic secondary DB sort key (platform) on the latest-scores query', async () => {
        prisma.rankingScore.findMany.mockResolvedValue([]);
        await service.getLatestScores('content-1');

        expect(prisma.rankingScore.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            orderBy: [{ computedAt: 'desc' }, { platform: 'asc' }],
          }),
        );
      });
    });
  });
});

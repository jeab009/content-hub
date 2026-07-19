import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssetPlatform, ContentPillar, EngineVersion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { RankingEngineService } from './ranking-engine.service';
import { RankingEngineV2Service } from './ranking-engine-v2.service';
import { RankingEngineSelectorService } from './ranking-engine-selector.service';
import { RankingFactorsService } from './ranking-factors.service';
import { RankingFactorsV2Service } from './ranking-factors-v2.service';
import {
  PLATFORM_TIE_BREAK_ORDER,
  RANKED_PLATFORMS,
  RankingReasoning,
  pickRecommendedScore,
} from './ranking.constants';
import { FACTOR_WEIGHTS_V2, RANKED_PLATFORMS_V2 } from './ranking-v2.constants';

const CONTENT = { id: 'content-1', contentPillar: ContentPillar.comedy };

interface CreatedRow {
  contentId: string;
  platform: AssetPlatform;
  score: { toString(): string };
  reasoning: RankingReasoning;
  engineVersion: EngineVersion;
}

/**
 * An EMPTY-HISTORY prisma double: no metrics, no override history, no policy
 * rows, no cadence targets. This is the legacy state the golden regression
 * test needs — the world as it looked when v1 shipped.
 */
function buildEmptyHistoryPrisma() {
  const created: CreatedRow[] = [];
  return {
    created,
    prisma: {
      content: { findUnique: jest.fn().mockResolvedValue(CONTENT) },
      metric: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _avg: { engagement: null, revenue: null }, _count: { _all: 0 } }),
      },
      post: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      pillarRatioPolicy: { findFirst: jest.fn().mockResolvedValue(null) },
      platformCadenceTarget: { findFirst: jest.fn().mockResolvedValue(null) },
      rankingScore: {
        create: jest.fn().mockImplementation((args: { data: CreatedRow }) => {
          created.push(args.data);
          return args.data;
        }),
      },
      $transaction: jest.fn().mockImplementation((ops: unknown[]) => Promise.resolve(ops)),
    },
  };
}

describe('RankingEngineV2Service', () => {
  let harness: ReturnType<typeof buildEmptyHistoryPrisma>;
  let auditLog: { record: jest.Mock };
  let service: RankingEngineV2Service;

  beforeEach(() => {
    harness = buildEmptyHistoryPrisma();
    auditLog = { record: jest.fn() };
    const prismaService = harness.prisma as unknown as PrismaService;
    service = new RankingEngineV2Service(
      prismaService,
      new RankingFactorsV2Service(prismaService, new RankingFactorsService(prismaService)),
      auditLog as unknown as AuditLogService,
    );
  });

  it('404s for missing content', async () => {
    harness.prisma.content.findUnique.mockResolvedValue(null);

    await expect(service.computeScores('nope', 'admin-1')).rejects.toThrow(NotFoundException);
  });

  it('writes one score row per platform for ALL FOUR platforms, tagged v2', async () => {
    await service.computeScores(CONTENT.id, 'admin-1');

    expect(harness.created).toHaveLength(4);
    expect(harness.created.map((row) => row.platform)).toEqual([
      AssetPlatform.facebook,
      AssetPlatform.youtube,
      AssetPlatform.tiktok,
      AssetPlatform.line_oa,
    ]);
    for (const row of harness.created) {
      expect(row.engineVersion).toBe(EngineVersion.v2);
    }
  });

  it('emits a 5-factor reasoning payload whose contributions sum to the total', async () => {
    await service.computeScores(CONTENT.id, 'admin-1');

    for (const row of harness.created) {
      const { factors, total } = row.reasoning;
      expect(factors.map((f) => f.name)).toEqual([
        'engagement_history',
        'override_feedback',
        'cadence_pressure',
        'pillar_alignment',
        'api_availability',
      ]);
      const summed = factors.reduce((sum, f) => sum + f.contribution, 0);
      expect(total).toBeCloseTo(summed, 4);
      expect(row.reasoning.engineVersion).toBe(EngineVersion.v2);
    }
  });

  it('puts the raw override counts in the reasoning so the UI can explain the score', async () => {
    harness.prisma.post.findMany.mockResolvedValue(
      Array.from({ length: 8 }, () => ({
        recommendedPlatform: AssetPlatform.facebook,
        selectedPlatform: AssetPlatform.tiktok,
        wasOverride: true,
      })),
    );

    await service.computeScores(CONTENT.id, 'admin-1');

    const facebook = harness.created.find((r) => r.platform === AssetPlatform.facebook);
    const tiktok = harness.created.find((r) => r.platform === AssetPlatform.tiktok);
    const fbOverride = facebook?.reasoning.factors.find((f) => f.name === 'override_feedback');
    const ttOverride = tiktok?.reasoning.factors.find((f) => f.name === 'override_feedback');

    expect(fbOverride?.input).toMatchObject({
      sampleSize: 8,
      recommendedCount: 8,
      overriddenAwayCount: 8,
      selectedAsOverrideCount: 0,
    });
    expect(ttOverride?.input).toMatchObject({ selectedAsOverrideCount: 8, overriddenAwayCount: 0 });
    // The repeatedly-rejected platform is scored below the preferred one.
    expect(Number(facebook?.score.toString())).toBeLessThan(Number(tiktok?.score.toString()));
  });

  it('audit-logs the recompute as ranking_recomputed carrying engineVersion v2', async () => {
    await service.computeScores(CONTENT.id, 'admin-1');

    const [entry] = auditLog.record.mock.calls[0] as [
      { action: string; meta: { engineVersion: string } },
    ];
    expect(entry.action).toBe('ranking_recomputed');
    expect(entry.meta.engineVersion).toBe(EngineVersion.v2);
  });
});

/**
 * GOLDEN REGRESSION TEST (exit criterion #5, risk R1).
 *
 * The migration from v1 to v2 must be monotone on the legacy case: for content
 * with no metrics and no override history — every v2-specific input absent —
 * v2 must still recommend the SAME platform v1 does, considering only the two
 * platforms v1 knew about. If this ever fails, v2 has changed an existing
 * recommendation for a reason unrelated to the new data it was built to use.
 */
describe('v1 → v2 golden regression (legacy FB/YT content, no history)', () => {
  it('v2 recommends the same platform as v1 across the legacy platform set', async () => {
    const v1Harness = buildEmptyHistoryPrisma();
    const v2Harness = buildEmptyHistoryPrisma();
    const audit = { record: jest.fn() } as unknown as AuditLogService;

    const v1Prisma = v1Harness.prisma as unknown as PrismaService;
    const v1 = new RankingEngineService(v1Prisma, new RankingFactorsService(v1Prisma), audit);

    const v2Prisma = v2Harness.prisma as unknown as PrismaService;
    const v2 = new RankingEngineV2Service(
      v2Prisma,
      new RankingFactorsV2Service(v2Prisma, new RankingFactorsService(v2Prisma)),
      audit,
    );

    await v1.computeScores(CONTENT.id, 'admin-1');
    await v2.computeScores(CONTENT.id, 'admin-1');

    const toScoreLike = (rows: CreatedRow[]) =>
      rows.map((row) => ({ platform: row.platform, score: Number(row.score.toString()) }));

    const v1Recommendation = pickRecommendedScore(toScoreLike(v1Harness.created));
    // Restrict v2 to the platforms v1 could see — v2's job on legacy content is
    // to not change the answer among the platforms that already existed.
    const v2OnLegacyPlatforms = pickRecommendedScore(
      toScoreLike(v2Harness.created).filter((row) => RANKED_PLATFORMS.includes(row.platform)),
    );

    expect(v2OnLegacyPlatforms?.platform).toBe(v1Recommendation?.platform);
    expect(v1Recommendation?.platform).toBe(AssetPlatform.facebook);
  });

  it('v1 still scores exactly its two platforms — v2 did not widen it', async () => {
    const harness = buildEmptyHistoryPrisma();
    const prismaService = harness.prisma as unknown as PrismaService;
    const v1 = new RankingEngineService(prismaService, new RankingFactorsService(prismaService), {
      record: jest.fn(),
    } as unknown as AuditLogService);

    await v1.computeScores(CONTENT.id, 'admin-1');

    expect(harness.created).toHaveLength(2);
    expect(harness.created.map((row) => row.platform)).toEqual([
      AssetPlatform.facebook,
      AssetPlatform.youtube,
    ]);
  });

  it('appends the new platforms to the tie-break order without disturbing FB/YT', () => {
    // Appending is what makes every pre-existing tie-break outcome safe.
    expect(PLATFORM_TIE_BREAK_ORDER.slice(0, RANKED_PLATFORMS.length)).toEqual([
      ...RANKED_PLATFORMS,
    ]);
    expect(PLATFORM_TIE_BREAK_ORDER).toEqual([
      AssetPlatform.facebook,
      AssetPlatform.youtube,
      AssetPlatform.tiktok,
      AssetPlatform.line_oa,
    ]);
    expect(RANKED_PLATFORMS_V2).toEqual(PLATFORM_TIE_BREAK_ORDER);
  });

  it('v2 weights sum to exactly 1.0', () => {
    const sum = Object.values(FACTOR_WEIGHTS_V2).reduce((a, b) => a + b, 0);

    expect(sum).toBeCloseTo(1, 10);
  });
});

describe('RankingEngineSelectorService', () => {
  const v1 = { computeScores: jest.fn().mockResolvedValue(['v1-rows']) };
  const v2 = { computeScores: jest.fn().mockResolvedValue(['v2-rows']) };

  function buildSelector(engine?: string): RankingEngineSelectorService {
    const configService = {
      get: jest.fn().mockReturnValue(engine ? { ranking: { engine } } : undefined),
    } as unknown as ConfigService;
    return new RankingEngineSelectorService(
      configService,
      v1 as unknown as RankingEngineService,
      v2 as unknown as RankingEngineV2Service,
    );
  }

  beforeEach(() => {
    v1.computeScores.mockClear();
    v2.computeScores.mockClear();
  });

  it('routes to v1 by default', async () => {
    const selector = buildSelector('v1');

    await selector.computeScores('content-1', 'admin-1');

    expect(selector.activeEngineVersion).toBe('v1');
    expect(v1.computeScores).toHaveBeenCalledWith('content-1', 'admin-1');
    expect(v2.computeScores).not.toHaveBeenCalled();
  });

  it('routes to v2 when the flag says so', async () => {
    const selector = buildSelector('v2');

    await selector.computeScores('content-1', 'admin-1');

    expect(selector.activeEngineVersion).toBe('v2');
    expect(v2.computeScores).toHaveBeenCalledWith('content-1', 'admin-1');
    expect(v1.computeScores).not.toHaveBeenCalled();
  });

  it('falls back to v1 when config is missing entirely', async () => {
    const selector = buildSelector();

    await selector.computeScores('content-1', 'admin-1');

    expect(selector.activeEngineVersion).toBe('v1');
    expect(v1.computeScores).toHaveBeenCalled();
  });
});

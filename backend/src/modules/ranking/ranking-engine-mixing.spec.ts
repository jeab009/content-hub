import { AssetPlatform, EngineVersion, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { RankingEngineService } from './ranking-engine.service';
import { RankingFactorsService } from './ranking-factors.service';
import { activeEngine } from './active-ranking-engine.fixture';

/**
 * BUG-P5-02 — a recommendation must never be computed from scores produced by
 * more than one engine.
 *
 * v1 writes 2 rows (facebook, youtube); v2 writes 4 (adds tiktok, line_oa).
 * Because v1 never writes tiktok/line_oa, a v2 -> v1 rollback leaves the v2
 * rows for those platforms in the "latest per platform" set FOREVER — nothing
 * supersedes them. The old read path then handed pickRecommendedScore a set
 * containing both a v1 score and a v2 score, which are computed from different
 * factor sets under different weight vectors and are simply not comparable.
 *
 * The fixture below is the live demo database's actual shape (content
 * 3033264c, "Comedy skit teaser") with one deliberate change: the v2 tiktok
 * score is raised above every v1 score. That makes the defect decide the
 * outcome instead of merely being present — under the old code tiktok (v2)
 * wins while the engine badge reads v1.
 */

const CONTENT_ID = 'content-mixed';

interface Row {
  id: string;
  contentId: string;
  platform: AssetPlatform;
  score: number;
  engineVersion: EngineVersion;
  computedAt: Date;
}

/** v1 ran most recently (15:15); v2 ran earlier (14:33) — as in the demo DB. */
const MIXED_ROWS: Row[] = [
  {
    id: 'v1-fb',
    contentId: CONTENT_ID,
    platform: AssetPlatform.facebook,
    score: 0.4822,
    engineVersion: EngineVersion.v1,
    computedAt: new Date('2026-07-19T15:15:31.804Z'),
  },
  {
    id: 'v1-yt',
    contentId: CONTENT_ID,
    platform: AssetPlatform.youtube,
    score: 0.4583,
    engineVersion: EngineVersion.v1,
    computedAt: new Date('2026-07-19T15:15:31.804Z'),
  },
  {
    id: 'v2-tt',
    contentId: CONTENT_ID,
    platform: AssetPlatform.tiktok,
    // Deliberately the highest score in the whole set: if the engines are ever
    // mixed again, this row wins and every assertion below fails loudly.
    score: 0.9111,
    engineVersion: EngineVersion.v2,
    computedAt: new Date('2026-07-19T14:33:09.896Z'),
  },
  {
    id: 'v2-line',
    contentId: CONTENT_ID,
    platform: AssetPlatform.line_oa,
    score: 0.3823,
    engineVersion: EngineVersion.v2,
    computedAt: new Date('2026-07-19T14:33:09.896Z'),
  },
];

/**
 * A findMany double that actually HONOURS the where clause and the ordering,
 * so these tests exercise the real selection rule rather than just asserting
 * that some arguments were passed. Without this the engine filter would be
 * untested — the filter lives in the query, and a mock that ignores `where`
 * cannot tell a scoped read from an unscoped one.
 */
function findManyOver(rows: Row[]): jest.Mock {
  return jest.fn().mockImplementation((args: { where: Prisma.RankingScoreWhereInput }) => {
    const { contentId, engineVersion } = args.where;
    const wantedIds =
      typeof contentId === 'string'
        ? [contentId]
        : ((contentId as { in?: string[] })?.in ?? rows.map((row) => row.contentId));

    return Promise.resolve(
      rows
        .filter((row) => wantedIds.includes(row.contentId))
        .filter((row) => engineVersion === undefined || row.engineVersion === engineVersion)
        .sort(
          (a, b) =>
            b.computedAt.getTime() - a.computedAt.getTime() || a.platform.localeCompare(b.platform),
        ),
    );
  });
}

function buildRankingService(engine: EngineVersion, rows: Row[]): RankingEngineService {
  const prisma = {
    rankingScore: { findMany: findManyOver(rows) },
  } as unknown as PrismaService;

  return new RankingEngineService(
    prisma,
    {} as unknown as RankingFactorsService,
    { record: jest.fn() } as unknown as AuditLogService,
    activeEngine(engine),
  );
}

function buildSchedulerService(engine: EngineVersion, rows: Row[]): SchedulerService {
  const prisma = {
    platformCadenceTarget: { findMany: jest.fn().mockResolvedValue([]) },
    post: { count: jest.fn().mockResolvedValue(0) },
    content: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: CONTENT_ID,
          title: 'Comedy skit teaser',
          type: 'video',
          contentPillar: 'comedy',
          createdAt: new Date('2026-07-19T12:00:00Z'),
        },
      ]),
    },
    rankingScore: { findMany: findManyOver(rows) },
  } as unknown as PrismaService;

  return new SchedulerService(prisma, activeEngine(engine));
}

describe('BUG-P5-02: engine-scoped score reads', () => {
  describe('with mixed v1/v2 rows in the database', () => {
    it('engine v1 recommends from v1 rows ONLY — the higher-scoring v2 tiktok row is ignored', async () => {
      const service = buildRankingService(EngineVersion.v1, MIXED_ROWS);

      const scores = await service.getLatestScores(CONTENT_ID);
      const recommendation = await service.getRecommendation(CONTENT_ID);

      expect(scores.map((row) => row.platform).sort()).toEqual([
        AssetPlatform.facebook,
        AssetPlatform.youtube,
      ]);
      expect(scores.every((row) => row.engineVersion === EngineVersion.v1)).toBe(true);
      // 0.9111 (v2 tiktok) is higher, but it is not v1's to compare against.
      expect(recommendation?.platform).toBe(AssetPlatform.facebook);
    });

    it('engine v2 recommends from v2 rows ONLY — the newer v1 rows are ignored', async () => {
      const service = buildRankingService(EngineVersion.v2, MIXED_ROWS);

      const scores = await service.getLatestScores(CONTENT_ID);
      const recommendation = await service.getRecommendation(CONTENT_ID);

      expect(scores.map((row) => row.platform).sort()).toEqual([
        AssetPlatform.line_oa,
        AssetPlatform.tiktok,
      ]);
      expect(scores.every((row) => row.engineVersion === EngineVersion.v2)).toBe(true);
      expect(recommendation?.platform).toBe(AssetPlatform.tiktok);
    });

    it('never returns a set spanning more than one engine version', async () => {
      for (const engine of [EngineVersion.v1, EngineVersion.v2]) {
        const scores = await buildRankingService(engine, MIXED_ROWS).getLatestScores(CONTENT_ID);

        expect(new Set(scores.map((row) => row.engineVersion)).size).toBe(1);
      }
    });
  });

  describe('BUG-QA-003 still holds: both surfaces agree under mixed data', () => {
    it.each([EngineVersion.v1, EngineVersion.v2])(
      'ranking read and scheduler overview recommend the same platform under engine %s',
      async (engine) => {
        const fromRanking = await buildRankingService(engine, MIXED_ROWS).getRecommendation(
          CONTENT_ID,
        );
        const overview = await buildSchedulerService(engine, MIXED_ROWS).overview(
          new Date('2026-07-19T16:00:00Z'),
        );
        const [ready] = overview.readyContents;

        expect(ready.recommendedPlatform).toBe(fromRanking?.platform);
        // And both are looking at the same engine-scoped set, not just the
        // same winner by coincidence.
        expect(ready.latestScores.map((score) => score.id).sort()).toEqual(
          (await buildRankingService(engine, MIXED_ROWS).getLatestScores(CONTENT_ID))
            .map((score) => score.id)
            .sort(),
        );
      },
    );

    it('the scheduler overview also never mixes engines', async () => {
      const overview = await buildSchedulerService(EngineVersion.v1, MIXED_ROWS).overview(
        new Date('2026-07-19T16:00:00Z'),
      );

      expect(overview.readyContents[0].latestScores.map((score) => score.id).sort()).toEqual([
        'v1-fb',
        'v1-yt',
      ]);
    });
  });

  describe('v1 behaviour is unchanged when no v2 rows exist', () => {
    const v1Only = MIXED_ROWS.filter((row) => row.engineVersion === EngineVersion.v1);

    it('reads the same rows and recommends the same platform as before the fix', async () => {
      const service = buildRankingService(EngineVersion.v1, v1Only);

      const scores = await service.getLatestScores(CONTENT_ID);

      expect(scores.map((row) => row.id).sort()).toEqual(['v1-fb', 'v1-yt']);
      expect((await service.getRecommendation(CONTENT_ID))?.platform).toBe(AssetPlatform.facebook);
    });

    it('still keeps only the newest row per platform within the active engine', async () => {
      const withStaleV1: Row[] = [
        ...v1Only,
        {
          id: 'v1-fb-old',
          contentId: CONTENT_ID,
          platform: AssetPlatform.facebook,
          score: 0.99,
          engineVersion: EngineVersion.v1,
          computedAt: new Date('2026-07-18T09:00:00Z'),
        },
      ];

      const scores = await buildRankingService(EngineVersion.v1, withStaleV1).getLatestScores(
        CONTENT_ID,
      );

      expect(scores.map((row) => row.id).sort()).toEqual(['v1-fb', 'v1-yt']);
    });
  });

  describe('engine round-trip v1 -> v2 -> v1 (the rollback that exposed the bug)', () => {
    it('returns to the exact v1 answer after rolling back, with the v2 rows still on disk', async () => {
      const before = await buildRankingService(EngineVersion.v1, MIXED_ROWS).getRecommendation(
        CONTENT_ID,
      );
      await buildRankingService(EngineVersion.v2, MIXED_ROWS).getRecommendation(CONTENT_ID);
      const after = await buildRankingService(EngineVersion.v1, MIXED_ROWS).getRecommendation(
        CONTENT_ID,
      );

      expect(after?.platform).toBe(before?.platform);
      expect(after?.id).toBe('v1-fb');
    });

    it('content ranked ONLY by the other engine reads as unranked, not as a stale recommendation', async () => {
      const v2Only = MIXED_ROWS.filter((row) => row.engineVersion === EngineVersion.v2);
      const service = buildRankingService(EngineVersion.v1, v2Only);

      // The honest answer: v1 has never scored this content. A recompute
      // under v1 fixes it. Serving the v2 set here would be the bug.
      expect(await service.getLatestScores(CONTENT_ID)).toEqual([]);
      expect(await service.getRecommendation(CONTENT_ID)).toBeNull();
    });
  });
});

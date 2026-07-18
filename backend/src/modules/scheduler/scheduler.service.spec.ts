import { AssetPlatform, CadencePeriodUnit } from '@prisma/client';
import { SchedulerService } from './scheduler.service';
import { PrismaService } from '../prisma/prisma.service';
import { pickRecommendedScore } from '../ranking/ranking.constants';
import { cadencePaceStatus } from './dto/scheduler-overview.dto';

describe('cadencePaceStatus', () => {
  const weekStart = new Date('2026-07-13T00:00:00Z');
  const weekEnd = new Date('2026-07-20T00:00:00Z');

  it('target_met once the full target is reached, regardless of time', () => {
    expect(cadencePaceStatus(7, 7, weekStart, weekEnd, new Date('2026-07-14T00:00:00Z'))).toBe(
      'target_met',
    );
  });

  it('on_pace when published matches the pro-rated expectation', () => {
    // Wednesday 00:00 = 2/7 elapsed, target 7 → expected floor(2) = 2.
    const wednesday = new Date('2026-07-15T00:00:00Z');
    expect(cadencePaceStatus(2, 7, weekStart, weekEnd, wednesday)).toBe('on_pace');
  });

  it('under_target when published falls behind the pro-rated expectation', () => {
    const friday = new Date('2026-07-17T00:00:00Z'); // 4/7 elapsed → expected 4
    expect(cadencePaceStatus(1, 7, weekStart, weekEnd, friday)).toBe('under_target');
  });

  it('start of the period is always on_pace with zero published', () => {
    expect(cadencePaceStatus(0, 7, weekStart, weekEnd, weekStart)).toBe('on_pace');
  });
});

describe('SchedulerService.overview', () => {
  let prisma: {
    platformCadenceTarget: { findMany: jest.Mock };
    post: { count: jest.Mock };
    content: { findMany: jest.Mock };
    rankingScore: { findMany: jest.Mock };
  };
  let service: SchedulerService;

  const now = new Date('2026-07-17T12:00:00Z'); // Friday

  beforeEach(() => {
    prisma = {
      platformCadenceTarget: {
        findMany: jest.fn().mockResolvedValue([
          {
            platform: AssetPlatform.facebook,
            targetPostsPerPeriod: 7,
            periodUnit: CadencePeriodUnit.week,
            effectiveFrom: new Date('2026-07-01'),
          },
          {
            platform: AssetPlatform.youtube,
            targetPostsPerPeriod: 3,
            periodUnit: CadencePeriodUnit.week,
            effectiveFrom: new Date('2026-07-01'),
          },
        ]),
      },
      post: { count: jest.fn().mockResolvedValueOnce(6).mockResolvedValueOnce(0) },
      content: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'content-1',
            title: 'Clip A',
            type: 'video',
            contentPillar: 'comedy',
            createdAt: now,
          },
        ]),
      },
      rankingScore: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 's-new-fb',
            contentId: 'content-1',
            platform: AssetPlatform.facebook,
            score: 0.71,
            computedAt: new Date('2026-07-17T10:00:00Z'),
          },
          {
            id: 's-new-yt',
            contentId: 'content-1',
            platform: AssetPlatform.youtube,
            score: 0.85,
            computedAt: new Date('2026-07-17T10:00:00Z'),
          },
          {
            id: 's-old-fb',
            contentId: 'content-1',
            platform: AssetPlatform.facebook,
            score: 0.2,
            computedAt: new Date('2026-07-10T10:00:00Z'),
          },
        ]),
      },
    };
    service = new SchedulerService(prisma as unknown as PrismaService);
  });

  it('reports per-platform cadence progress against the current week window', async () => {
    const overview = await service.overview(now);

    const facebook = overview.cadence.find((row) => row.platform === AssetPlatform.facebook);
    expect(facebook).toEqual(
      expect.objectContaining({ targetPostsPerPeriod: 7, publishedThisPeriod: 6, remaining: 1 }),
    );
    expect(facebook?.periodStart.toISOString()).toBe('2026-07-13T00:00:00.000Z');
    expect(facebook?.periodEnd.toISOString()).toBe('2026-07-20T00:00:00.000Z');
    // 6 of 7 by Friday noon (4.5/7 elapsed → expected 4) — ahead of pace.
    expect(facebook?.status).toBe('on_pace');

    const youtube = overview.cadence.find((row) => row.platform === AssetPlatform.youtube);
    expect(youtube?.publishedThisPeriod).toBe(0);
    expect(youtube?.status).toBe('under_target'); // expected floor(3 * 4.5/7) = 1 by now
  });

  it('lists ready contents with only their LATEST score per platform and the top platform', async () => {
    const overview = await service.overview(now);

    expect(overview.readyContents).toHaveLength(1);
    const [ready] = overview.readyContents;
    expect(ready.latestScores).toHaveLength(2);
    expect(ready.latestScores.map((score) => score.id)).toEqual(
      expect.arrayContaining(['s-new-fb', 's-new-yt']),
    );
    expect(ready.latestScores.map((score) => score.id)).not.toContain('s-old-fb');
    expect(ready.recommendedPlatform).toBe(AssetPlatform.youtube);
  });

  describe('BUG-QA-003: tie-break agrees with the ranking engine', () => {
    const tiedScores = [
      {
        id: 's-yt',
        contentId: 'content-1',
        platform: AssetPlatform.youtube,
        score: 0.785,
        computedAt: new Date('2026-07-17T10:00:00Z'),
      },
      {
        id: 's-fb',
        contentId: 'content-1',
        platform: AssetPlatform.facebook,
        score: 0.785,
        computedAt: new Date('2026-07-17T10:00:00Z'),
      },
    ];

    it('recommends facebook on a tie (earliest in RANKED_PLATFORMS) and matches pickRecommendedScore', async () => {
      // DB row order lists youtube first — the shared tie-break must still win.
      prisma.rankingScore.findMany.mockResolvedValue(tiedScores);

      const overview = await service.overview(now);
      const [ready] = overview.readyContents;

      expect(ready.recommendedPlatform).toBe(AssetPlatform.facebook);
      // The publish-time recompute path (getRecommendation) routes through the
      // same shared util, so both agree on this exact set of scores.
      expect(pickRecommendedScore(tiedScores)?.platform).toBe(AssetPlatform.facebook);
    });

    it('requests a deterministic secondary DB sort key (platform) on the batched scores query', async () => {
      prisma.rankingScore.findMany.mockResolvedValue(tiedScores);
      await service.overview(now);

      expect(prisma.rankingScore.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ computedAt: 'desc' }, { platform: 'asc' }],
        }),
      );
    });
  });
});

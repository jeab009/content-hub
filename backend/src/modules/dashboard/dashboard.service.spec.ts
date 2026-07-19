import { NotFoundException } from '@nestjs/common';
import { Platform } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../prisma/prisma.service';

/** Builds a metrics-with-post row the way prisma include returns it. */
function metric(overrides: {
  postId: string;
  contentId: string;
  platform: Platform;
  reach: number;
  engagement: number;
  revenue: number;
  collectedAt: string;
  title?: string;
}) {
  return {
    id: `${overrides.postId}-${overrides.collectedAt}`,
    postId: overrides.postId,
    platform: overrides.platform,
    reach: overrides.reach,
    engagement: overrides.engagement,
    revenue: overrides.revenue, // Number stands in for Prisma.Decimal (Number() is identity)
    source: 'api',
    collectedAt: new Date(overrides.collectedAt),
    createdAt: new Date(overrides.collectedAt),
    post: {
      id: overrides.postId,
      contentId: overrides.contentId,
      platform: overrides.platform,
      content: {
        id: overrides.contentId,
        title: overrides.title ?? `Content ${overrides.contentId}`,
        type: 'video',
        contentPillar: 'comedy',
      },
    },
  };
}

describe('DashboardService', () => {
  const now = new Date('2026-07-18T12:00:00Z');

  function buildService(rows: ReturnType<typeof metric>[]): DashboardService {
    const prisma = {
      metric: { findMany: jest.fn().mockResolvedValue(rows) },
    } as unknown as PrismaService;
    return new DashboardService(prisma);
  }

  it('totals sum only the LATEST reading per post (append-only history)', async () => {
    // post-1 has two readings; only the newer (reach 300) should count.
    const service = buildService([
      metric({
        postId: 'post-1',
        contentId: 'c1',
        platform: Platform.facebook,
        reach: 100,
        engagement: 10,
        revenue: 1.0,
        collectedAt: '2026-07-16T00:00:00Z',
      }),
      metric({
        postId: 'post-1',
        contentId: 'c1',
        platform: Platform.facebook,
        reach: 300,
        engagement: 30,
        revenue: 3.0,
        collectedAt: '2026-07-17T00:00:00Z',
      }),
      metric({
        postId: 'post-2',
        contentId: 'c2',
        platform: Platform.youtube,
        reach: 200,
        engagement: 20,
        revenue: 2.5,
        collectedAt: '2026-07-17T00:00:00Z',
      }),
    ]);

    const overview = await service.overview(now);

    expect(overview.totals.reach).toBe(500); // 300 (latest post-1) + 200
    expect(overview.totals.revenue).toBe(5.5);
    expect(overview.totals.postsWithMetrics).toBe(2);
    expect(overview.totals.contentsWithMetrics).toBe(2);
  });

  it('breaks revenue down per platform, highest first', async () => {
    const service = buildService([
      metric({
        postId: 'post-1',
        contentId: 'c1',
        platform: Platform.facebook,
        reach: 100,
        engagement: 10,
        revenue: 1.0,
        collectedAt: '2026-07-17T00:00:00Z',
      }),
      metric({
        postId: 'post-2',
        contentId: 'c2',
        platform: Platform.youtube,
        reach: 200,
        engagement: 20,
        revenue: 9.0,
        collectedAt: '2026-07-17T00:00:00Z',
      }),
    ]);

    const overview = await service.overview(now);

    expect(overview.byPlatform.map((p) => p.platform)).toEqual([
      Platform.youtube,
      Platform.facebook,
    ]);
    expect(overview.byPlatform[0].revenue).toBe(9.0);
  });

  it('trend replays readings as a cumulative per-day snapshot', async () => {
    const service = buildService([
      metric({
        postId: 'post-1',
        contentId: 'c1',
        platform: Platform.facebook,
        reach: 100,
        engagement: 10,
        revenue: 1.0,
        collectedAt: '2026-07-16T09:00:00Z',
      }),
      metric({
        postId: 'post-1',
        contentId: 'c1',
        platform: Platform.facebook,
        reach: 250,
        engagement: 25,
        revenue: 2.5,
        collectedAt: '2026-07-17T09:00:00Z',
      }),
      metric({
        postId: 'post-2',
        contentId: 'c2',
        platform: Platform.youtube,
        reach: 200,
        engagement: 20,
        revenue: 2.0,
        collectedAt: '2026-07-17T10:00:00Z',
      }),
    ]);

    const overview = await service.overview(now);

    expect(overview.trend).toEqual([
      { date: '2026-07-16', reach: 100, revenue: 1.0 },
      // Day 2: post-1 updated to 250 + post-2 new 200 = 450 reach, 4.5 revenue
      { date: '2026-07-17', reach: 450, revenue: 4.5 },
    ]);
  });

  it('groups revenue by content and returns empty structures with no metrics', async () => {
    const withData = buildService([
      metric({
        postId: 'post-1',
        contentId: 'c1',
        platform: Platform.facebook,
        reach: 100,
        engagement: 10,
        revenue: 4.25,
        collectedAt: '2026-07-17T00:00:00Z',
        title: 'Funny clip',
      }),
    ]);
    const revenue = await withData.revenue(now);
    expect(revenue.byContent).toHaveLength(1);
    expect(revenue.byContent[0]).toMatchObject({ title: 'Funny clip', revenue: 4.25 });
    expect(revenue.totalRevenue).toBe(4.25);

    const empty = await buildService([]).overview(now);
    expect(empty.totals.reach).toBe(0);
    expect(empty.trend).toEqual([]);
    expect(empty.byPlatform).toEqual([]);
  });

  describe('contentRevenue drill-down (Phase 5A.8)', () => {
    const CONTENT = {
      id: 'c1',
      title: 'Funny clip',
      type: 'video',
      contentPillar: 'comedy',
    };

    function buildDrilldownService(rows: ReturnType<typeof metric>[], content: unknown = CONTENT) {
      const prisma = {
        content: { findUnique: jest.fn().mockResolvedValue(content) },
        metric: { findMany: jest.fn().mockResolvedValue(rows) },
      };
      return { service: new DashboardService(prisma as unknown as PrismaService), prisma };
    }

    it('404s for a content that does not exist', async () => {
      const { service } = buildDrilldownService([], null);

      await expect(service.contentRevenue('missing', now)).rejects.toThrow(NotFoundException);
    });

    it('scopes the metric query to the requested content', async () => {
      const { service, prisma } = buildDrilldownService([]);

      await service.contentRevenue('c1', now);

      const [args] = prisma.metric.findMany.mock.calls[0] as [{ where: unknown }];
      expect(args.where).toEqual({ post: { contentId: 'c1' } });
    });

    it('returns zeroed totals for a content with no metrics yet (not a 404)', async () => {
      const { service } = buildDrilldownService([]);

      const result = await service.contentRevenue('c1', now);

      expect(result.totalRevenue).toBe(0);
      expect(result.totals).toEqual({ reach: 0, engagement: 0, revenue: 0, posts: 0 });
      expect(result.byPost).toEqual([]);
      expect(result.trend).toEqual([]);
      expect(result.title).toBe('Funny clip');
    });

    it('splits by platform and by post using latest-per-post, so it reconciles with the summary', async () => {
      const { service } = buildDrilldownService([
        // post-1 has an older and a newer reading — only the newer counts.
        metric({
          postId: 'post-1',
          contentId: 'c1',
          platform: Platform.facebook,
          reach: 100,
          engagement: 10,
          revenue: 5,
          collectedAt: '2026-07-16T00:00:00Z',
        }),
        metric({
          postId: 'post-1',
          contentId: 'c1',
          platform: Platform.facebook,
          reach: 300,
          engagement: 30,
          revenue: 20,
          collectedAt: '2026-07-18T00:00:00Z',
        }),
        metric({
          postId: 'post-2',
          contentId: 'c1',
          platform: Platform.tiktok,
          reach: 900,
          engagement: 90,
          revenue: 12.5,
          collectedAt: '2026-07-18T00:00:00Z',
        }),
      ]);

      const result = await service.contentRevenue('c1', now);

      expect(result.totalRevenue).toBe(32.5); // 20 + 12.5, not 37.5
      expect(result.totals.posts).toBe(2);
      expect(result.byPost).toHaveLength(2);
      // Sorted by revenue descending.
      expect(result.byPost[0]).toMatchObject({ postId: 'post-1', revenue: 20 });
      expect(result.byPost[1]).toMatchObject({ postId: 'post-2', revenue: 12.5 });
      expect(result.byPlatform.map((p) => p.platform)).toEqual([
        Platform.facebook,
        Platform.tiktok,
      ]);
    });

    it('surfaces publishMethod and the external id/URL so a manual record is distinguishable', async () => {
      const row = metric({
        postId: 'post-9',
        contentId: 'c1',
        platform: Platform.tiktok,
        reach: 500,
        engagement: 40,
        revenue: 8,
        collectedAt: '2026-07-18T00:00:00Z',
      });
      Object.assign(row.post, {
        publishMethod: 'manual_external',
        externalPostId: 'tt-7788',
        externalPostUrl: 'https://www.tiktok.com/@acct/video/7788',
        postedAt: new Date('2026-07-17T00:00:00Z'),
      });
      const { service } = buildDrilldownService([row]);

      const result = await service.contentRevenue('c1', now);

      expect(result.byPost[0]).toMatchObject({
        publishMethod: 'manual_external',
        externalPostId: 'tt-7788',
        externalPostUrl: 'https://www.tiktok.com/@acct/video/7788',
        metricSource: 'api',
      });
    });
  });
});

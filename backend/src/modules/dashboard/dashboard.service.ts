import { Injectable } from '@nestjs/common';
import { Content, Metric, Platform, Post } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DashboardOverviewDto,
  DashboardRevenueDto,
  PlatformBreakdownItem,
  RevenueByContentItem,
  TrendPoint,
} from './dto/dashboard.dto';

type MetricWithPost = Metric & { post: Post & { content: Content } };

interface Tally {
  reach: number;
  engagement: number;
  revenue: number;
  posts: number;
}

/**
 * Read-model for the Phase 3 dashboard. Pure aggregation over the
 * append-only metrics table — no writes. Because metrics are append-only,
 * the "current" figure for a post is its LATEST reading; totals and
 * breakdowns sum the latest-per-post, while the trend replays readings day
 * by day to show cumulative revenue/reach over time.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(now: Date = new Date()): Promise<DashboardOverviewDto> {
    const metrics = await this.loadMetrics();
    const latest = latestPerPost(metrics);

    const totalsTally = sumTally(latest);
    const contentsWithMetrics = new Set(latest.map((m) => m.post.contentId)).size;

    return {
      generatedAt: now,
      totals: {
        reach: totalsTally.reach,
        engagement: totalsTally.engagement,
        revenue: round2(totalsTally.revenue),
        postsWithMetrics: latest.length,
        contentsWithMetrics,
      },
      byPlatform: this.byPlatform(latest),
      trend: buildTrend(metrics),
    };
  }

  async revenue(now: Date = new Date()): Promise<DashboardRevenueDto> {
    const metrics = await this.loadMetrics();
    const latest = latestPerPost(metrics);

    return {
      generatedAt: now,
      totalRevenue: round2(sumTally(latest).revenue),
      byContent: this.byContent(latest),
      byPlatform: this.byPlatform(latest),
    };
  }

  private loadMetrics(): Promise<MetricWithPost[]> {
    return this.prisma.metric.findMany({
      include: { post: { include: { content: true } } },
      orderBy: { collectedAt: 'asc' },
    });
  }

  private byPlatform(latest: MetricWithPost[]): PlatformBreakdownItem[] {
    const groups = new Map<Platform, Tally>();
    for (const metric of latest) {
      addToTally(groups, metric.platform, metric);
    }
    return [...groups.entries()]
      .map(([platform, tally]) => ({
        platform,
        reach: tally.reach,
        engagement: tally.engagement,
        revenue: round2(tally.revenue),
        posts: tally.posts,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  private byContent(latest: MetricWithPost[]): RevenueByContentItem[] {
    const groups = new Map<string, { tally: Tally; content: Content }>();
    for (const metric of latest) {
      const existing = groups.get(metric.post.contentId);
      const tally = existing?.tally ?? { reach: 0, engagement: 0, revenue: 0, posts: 0 };
      tally.reach += metric.reach;
      tally.engagement += metric.engagement;
      tally.revenue += Number(metric.revenue);
      tally.posts += 1;
      groups.set(metric.post.contentId, { tally, content: metric.post.content });
    }
    return [...groups.entries()]
      .map(([contentId, { tally, content }]) => ({
        contentId,
        title: content.title,
        type: content.type,
        contentPillar: content.contentPillar,
        reach: tally.reach,
        engagement: tally.engagement,
        revenue: round2(tally.revenue),
        posts: tally.posts,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }
}

/** Latest reading per post (max collectedAt; createdAt as tiebreak). */
function latestPerPost(metrics: MetricWithPost[]): MetricWithPost[] {
  const latest = new Map<string, MetricWithPost>();
  for (const metric of metrics) {
    const current = latest.get(metric.postId);
    if (!current || isNewer(metric, current)) {
      latest.set(metric.postId, metric);
    }
  }
  return [...latest.values()];
}

function isNewer(a: MetricWithPost, b: MetricWithPost): boolean {
  const at = a.collectedAt.getTime();
  const bt = b.collectedAt.getTime();
  if (at !== bt) return at > bt;
  return a.createdAt.getTime() > b.createdAt.getTime();
}

function sumTally(metrics: MetricWithPost[]): Tally {
  return metrics.reduce<Tally>(
    (acc, m) => ({
      reach: acc.reach + m.reach,
      engagement: acc.engagement + m.engagement,
      revenue: acc.revenue + Number(m.revenue),
      posts: acc.posts + 1,
    }),
    { reach: 0, engagement: 0, revenue: 0, posts: 0 },
  );
}

function addToTally(groups: Map<Platform, Tally>, key: Platform, metric: MetricWithPost): void {
  const tally = groups.get(key) ?? { reach: 0, engagement: 0, revenue: 0, posts: 0 };
  tally.reach += metric.reach;
  tally.engagement += metric.engagement;
  tally.revenue += Number(metric.revenue);
  tally.posts += 1;
  groups.set(key, tally);
}

/**
 * Cumulative reach/revenue per UTC day: replay all readings in time order,
 * keeping a running latest-per-post, and snapshot the sum at each day's end.
 * `metrics` must already be sorted by collectedAt ascending.
 */
function buildTrend(metrics: MetricWithPost[]): TrendPoint[] {
  if (metrics.length === 0) return [];
  const days = [...new Set(metrics.map((m) => dayKey(m.collectedAt)))].sort();
  const running = new Map<string, { reach: number; revenue: number }>();
  const trend: TrendPoint[] = [];
  let index = 0;
  for (const day of days) {
    const endOfDay = new Date(`${day}T23:59:59.999Z`).getTime();
    while (index < metrics.length && metrics[index].collectedAt.getTime() <= endOfDay) {
      const metric = metrics[index];
      running.set(metric.postId, { reach: metric.reach, revenue: Number(metric.revenue) });
      index += 1;
    }
    let reach = 0;
    let revenue = 0;
    for (const value of running.values()) {
      reach += value.reach;
      revenue += value.revenue;
    }
    trend.push({ date: day, reach, revenue: round2(revenue) });
  }
  return trend;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

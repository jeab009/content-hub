import { ContentPillar, ContentType, MetricSource, Platform, PublishMethod } from '@prisma/client';

export interface PlatformBreakdownItem {
  platform: Platform;
  reach: number;
  engagement: number;
  revenue: number;
  posts: number;
}

export interface TrendPoint {
  /** UTC day, YYYY-MM-DD. */
  date: string;
  reach: number;
  revenue: number;
}

export class DashboardOverviewDto {
  generatedAt!: Date;
  totals!: {
    reach: number;
    engagement: number;
    revenue: number;
    postsWithMetrics: number;
    contentsWithMetrics: number;
  };
  byPlatform!: PlatformBreakdownItem[];
  /** Cumulative reach/revenue snapshot per UTC day (drives the line chart). */
  trend!: TrendPoint[];
}

export interface RevenueByContentItem {
  contentId: string;
  title: string;
  type: ContentType;
  contentPillar: ContentPillar | null;
  reach: number;
  engagement: number;
  revenue: number;
  posts: number;
}

export class DashboardRevenueDto {
  generatedAt!: Date;
  totalRevenue!: number;
  byContent!: RevenueByContentItem[];
  byPlatform!: PlatformBreakdownItem[];
}

/**
 * One published post inside a content's revenue drill-down. Carries
 * publishMethod and the external id/URL so a manually-recorded TikTok/LINE
 * post is visibly distinguishable from an adapter-published one, and so the
 * admin can click through to verify the figures at the source.
 */
export interface RevenueByPostItem {
  postId: string;
  platform: Platform;
  publishMethod: PublishMethod;
  externalPostId: string | null;
  externalPostUrl: string | null;
  postedAt: Date | null;
  reach: number;
  engagement: number;
  revenue: number;
  metricSource: MetricSource | null;
  lastCollectedAt: Date | null;
}

/**
 * Per-content revenue drill-down (Phase 5A.8): the level below
 * DashboardRevenueDto's byContent row — this content split by platform, by
 * post, and over time. Same latest-per-post semantics as the rest of the
 * dashboard read-model, so the numbers reconcile with the summary above it.
 */
export class ContentRevenueDrilldownDto {
  generatedAt!: Date;
  contentId!: string;
  title!: string;
  type!: ContentType;
  contentPillar!: ContentPillar | null;
  totalRevenue!: number;
  totals!: { reach: number; engagement: number; revenue: number; posts: number };
  byPlatform!: PlatformBreakdownItem[];
  byPost!: RevenueByPostItem[];
  /** Cumulative reach/revenue per UTC day, for THIS content only. */
  trend!: TrendPoint[];
}

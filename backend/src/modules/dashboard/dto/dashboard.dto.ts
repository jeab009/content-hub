import { ContentPillar, ContentType, Platform } from '@prisma/client';

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

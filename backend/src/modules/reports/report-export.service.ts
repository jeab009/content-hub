import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toPostPlatform } from '../../common/utils/platform-map.util';
import { CsvValue, toCsv } from '../../common/utils/csv.util';
import { ReportQueryDto } from './dto/report-query.dto';

/**
 * CSV report builders (Phase 5A.6). Read-only aggregation; nothing here
 * writes. Each method returns a finished CSV document — the controller adds
 * the headers and the audit row.
 *
 * PDPA boundary, and the reason the comment report looks the way it does: the
 * comment export is AGGREGATE-ONLY. It never selects `author`, `text`,
 * `authorExternalId`, `replyText`, or any other per-person field — the counts
 * are computed with Prisma groupBy so the raw values never even enter this
 * process's memory. A per-comment export is out of scope by policy, not by
 * omission (docs/phase5-project-plan.md Decision 4, risk R3).
 */
@Injectable()
export class ReportExportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Revenue by content × platform × period, at the drill-down grain the
   * dashboard summarizes. Metrics are append-only, so the figure for a post is
   * its LATEST reading — matching DashboardService's latest-per-post semantics
   * rather than summing every historical snapshot (which would multi-count).
   */
  async revenueCsv(query: ReportQueryDto): Promise<string> {
    const metrics = await this.prisma.metric.findMany({
      where: this.metricWhere(query),
      include: { post: { include: { content: true } } },
      orderBy: { collectedAt: 'asc' },
    });

    const latestPerPost = new Map<string, (typeof metrics)[number]>();
    for (const metric of metrics) {
      const current = latestPerPost.get(metric.postId);
      if (!current || metric.collectedAt >= current.collectedAt) {
        latestPerPost.set(metric.postId, metric);
      }
    }

    const rows: CsvValue[][] = [...latestPerPost.values()]
      .sort((a, b) => Number(b.revenue) - Number(a.revenue))
      .map((metric) => [
        metric.post.contentId,
        metric.post.content.title,
        metric.post.content.contentPillar,
        metric.platform,
        metric.post.id,
        metric.post.publishMethod,
        metric.collectedAt.toISOString(),
        metric.source,
        metric.reach,
        metric.engagement,
        Number(metric.revenue).toFixed(2),
      ]);

    return toCsv(
      [
        'content_id',
        'content_title',
        'content_pillar',
        'platform',
        'post_id',
        'publish_method',
        'collected_at',
        'metric_source',
        'reach',
        'engagement',
        'revenue_thb',
      ],
      rows,
    );
  }

  /**
   * Override log / recommendation-adherence: what the engine recommended, what
   * the admin actually chose, and why. This is business data (no PII), and it
   * doubles as the human-readable audit of what ranking v2's override_feedback
   * factor is learning from.
   */
  async overrideLogCsv(query: ReportQueryDto): Promise<string> {
    const where: Prisma.PostWhereInput = {
      recommendedPlatform: { not: null },
      ...(query.contentId && { contentId: query.contentId }),
      ...(query.platform && { selectedPlatform: query.platform }),
      ...this.dateRange('createdAt', query),
    };

    const posts = await this.prisma.post.findMany({
      where,
      include: { content: { select: { title: true, contentPillar: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const rows: CsvValue[][] = posts.map((post) => [
      post.id,
      post.contentId,
      post.content.title,
      post.content.contentPillar,
      post.recommendedPlatform,
      post.selectedPlatform,
      post.wasOverride,
      post.overrideReason,
      post.publishMethod,
      post.status,
      post.priorityScore === null ? null : Number(post.priorityScore),
      post.recommendedAt?.toISOString() ?? null,
      post.postedAt?.toISOString() ?? null,
      post.createdAt.toISOString(),
    ]);

    return toCsv(
      [
        'post_id',
        'content_id',
        'content_title',
        'content_pillar',
        'recommended_platform',
        'selected_platform',
        'was_override',
        'override_reason',
        'publish_method',
        'status',
        'priority_score',
        'recommended_at',
        'posted_at',
        'created_at',
      ],
      rows,
    );
  }

  /**
   * Comment summary — COUNTS ONLY.
   *
   * Grouped by (platform, sentiment, priority) with an SLA-breach tally. The
   * groupBy `by` list is the complete set of columns that can reach the output,
   * and it contains no author, text, or author id. If you are extending this
   * report, adding a per-person column here is the PDPA violation — take it to
   * the System Analyst first (risk R3).
   */
  async commentSummaryCsv(query: ReportQueryDto): Promise<string> {
    const where: Prisma.CommentWhereInput = {
      ...(query.platform && { platform: toPostPlatform(query.platform) }),
      ...(query.contentId && { post: { contentId: query.contentId } }),
      ...this.dateRange('collectedAt', query),
    };

    const groups = await this.prisma.comment.groupBy({
      by: ['platform', 'sentiment', 'priority'],
      where,
      _count: { _all: true },
    });

    const now = new Date();
    const rows: CsvValue[][] = await Promise.all(
      groups
        .sort((a, b) => b._count._all - a._count._all)
        .map(async (group) => {
          const groupWhere: Prisma.CommentWhereInput = {
            ...where,
            platform: group.platform,
            sentiment: group.sentiment,
            priority: group.priority,
          };
          const [repliedCount, slaBreachedCount] = await Promise.all([
            this.prisma.comment.count({ where: { ...groupWhere, repliedAt: { not: null } } }),
            this.prisma.comment.count({
              where: { ...groupWhere, repliedAt: null, slaDueAt: { lt: now } },
            }),
          ]);
          return [
            group.platform,
            group.sentiment,
            group.priority,
            group._count._all,
            repliedCount,
            slaBreachedCount,
          ];
        }),
    );

    return toCsv(
      ['platform', 'sentiment', 'priority', 'comment_count', 'replied_count', 'sla_breached_count'],
      rows,
    );
  }

  private metricWhere(query: ReportQueryDto): Prisma.MetricWhereInput {
    return {
      ...(query.platform && { platform: toPostPlatform(query.platform) }),
      ...(query.contentId && { post: { contentId: query.contentId } }),
      ...this.dateRange('collectedAt', query),
    };
  }

  /** Builds an inclusive-from / inclusive-to filter on one date column. */
  private dateRange(field: string, query: ReportQueryDto): Record<string, unknown> {
    if (!query.from && !query.to) {
      return {};
    }
    return {
      [field]: {
        ...(query.from && { gte: new Date(query.from) }),
        ...(query.to && { lte: new Date(query.to) }),
      },
    };
  }
}

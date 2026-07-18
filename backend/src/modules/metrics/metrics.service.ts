import { Injectable, NotFoundException } from '@nestjs/common';
import { Metric, MetricSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { CreateManualMetricDto } from './dto/create-manual-metric.dto';

/**
 * Manual metric entry + per-post metric history. Metrics are APPEND-ONLY
 * (System Analyst condition #3): a reading is only ever inserted, never
 * updated in place, so the full history stays auditable and a correction is
 * a new row rather than a silent overwrite.
 */
@Injectable()
export class MetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Appends a manual reading for a post. The post carries the platform. */
  async appendManual(postId: string, dto: CreateManualMetricDto, userId: string): Promise<Metric> {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) {
      throw new NotFoundException(`Post ${postId} not found`);
    }

    const metric = await this.prisma.metric.create({
      data: {
        postId: post.id,
        platform: post.platform,
        reach: dto.reach,
        engagement: dto.engagement,
        revenue: dto.revenue,
        source: MetricSource.manual,
        collectedAt: dto.collectedAt ? new Date(dto.collectedAt) : new Date(),
      },
    });

    this.auditLog.record({
      actor: userId,
      action: 'metric_manual_added',
      result: 'success',
      meta: {
        postId: post.id,
        platform: post.platform,
        metricId: metric.id,
        collectedAt: metric.collectedAt.toISOString(),
      },
    });

    return metric;
  }

  /** Full reading history for a post, oldest first (drives the trend chart). */
  async listForPost(postId: string): Promise<Metric[]> {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) {
      throw new NotFoundException(`Post ${postId} not found`);
    }
    return this.prisma.metric.findMany({
      where: { postId },
      orderBy: { collectedAt: 'asc' },
    });
  }
}

import { Injectable } from '@nestjs/common';
import { AssetPlatform, PostStatus, RankingScore } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toPostPlatform } from '../../common/utils/platform-map.util';
import { currentPeriodEnd, currentPeriodStart } from '../../common/utils/cadence-period.util';
import {
  CadenceOverviewItemDto,
  ReadyContentOverviewDto,
  SchedulerOverviewDto,
  cadencePaceStatus,
} from './dto/scheduler-overview.dto';

/** Post statuses that count toward cadence ("went live"). */
const LIVE_POST_STATUSES: PostStatus[] = [PostStatus.posted, PostStatus.posted_unconfirmed];

/**
 * Read-model for the Scheduler UI: per-platform cadence progress for the
 * current period plus the ready-to-publish backlog with its latest ranking
 * scores. Pure aggregation — no writes, no publish side effects.
 */
@Injectable()
export class SchedulerService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(now: Date = new Date()): Promise<SchedulerOverviewDto> {
    const [cadence, readyContents] = await Promise.all([
      this.cadenceOverview(now),
      this.readyContentsWithScores(),
    ]);
    return { generatedAt: now, cadence, readyContents };
  }

  private async cadenceOverview(now: Date): Promise<CadenceOverviewItemDto[]> {
    const targets = await this.prisma.platformCadenceTarget.findMany({
      orderBy: [{ platform: 'asc' }, { effectiveFrom: 'desc' }],
    });

    // Latest target per platform (rows are per effective_from date).
    const latestPerPlatform = new Map<AssetPlatform, (typeof targets)[number]>();
    for (const target of targets) {
      if (!latestPerPlatform.has(target.platform)) {
        latestPerPlatform.set(target.platform, target);
      }
    }

    return Promise.all(
      [...latestPerPlatform.values()].map(async (target) => {
        const periodStart = currentPeriodStart(target.periodUnit, now);
        const periodEnd = currentPeriodEnd(target.periodUnit, now);
        const publishedThisPeriod = await this.prisma.post.count({
          where: {
            platform: toPostPlatform(target.platform),
            status: { in: LIVE_POST_STATUSES },
            postedAt: { gte: periodStart, lt: periodEnd },
          },
        });
        return {
          platform: target.platform,
          targetPostsPerPeriod: target.targetPostsPerPeriod,
          periodUnit: target.periodUnit,
          periodStart,
          periodEnd,
          publishedThisPeriod,
          remaining: Math.max(0, target.targetPostsPerPeriod - publishedThisPeriod),
          status: cadencePaceStatus(
            publishedThisPeriod,
            target.targetPostsPerPeriod,
            periodStart,
            periodEnd,
            now,
          ),
        };
      }),
    );
  }

  private async readyContentsWithScores(): Promise<ReadyContentOverviewDto[]> {
    const contents = await this.prisma.content.findMany({
      where: { status: 'ready' },
      orderBy: { createdAt: 'desc' },
    });
    if (contents.length === 0) {
      return [];
    }

    // One query for all scores, newest first; keep the first row seen per
    // (content, platform) = the latest score. Avoids an N+1 per content.
    const scores = await this.prisma.rankingScore.findMany({
      where: { contentId: { in: contents.map((content) => content.id) } },
      orderBy: { computedAt: 'desc' },
    });
    const latestScores = new Map<string, RankingScore[]>();
    const seen = new Set<string>();
    for (const score of scores) {
      const key = `${score.contentId}/${score.platform}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const list = latestScores.get(score.contentId) ?? [];
      list.push(score);
      latestScores.set(score.contentId, list);
    }

    return contents.map((content) => ({
      contentId: content.id,
      title: content.title,
      type: content.type,
      contentPillar: content.contentPillar,
      createdAt: content.createdAt,
      latestScores: (latestScores.get(content.id) ?? []).map((score) => ({
        id: score.id,
        platform: score.platform,
        score: Number(score.score),
        computedAt: score.computedAt,
      })),
      recommendedPlatform: this.topPlatform(latestScores.get(content.id) ?? []),
    }));
  }

  private topPlatform(scores: RankingScore[]): AssetPlatform | null {
    if (scores.length === 0) {
      return null;
    }
    const best = scores.reduce((max, row) => (Number(row.score) > Number(max.score) ? row : max));
    return best.platform;
  }
}

import { Injectable } from '@nestjs/common';
import { AssetPlatform, PostStatus, RankingScore } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toPostPlatform } from '../../common/utils/platform-map.util';
import { ActiveRankingEngineService } from '../ranking/active-ranking-engine.service';
import {
  LATEST_SCORE_ORDER_BY,
  latestScorePerPlatform,
  pickRecommendedScore,
} from '../ranking/ranking.constants';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly activeEngine: ActiveRankingEngineService,
  ) {}

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

    // One query for all scores, newest first; keep the newest row per
    // (content, platform). Avoids an N+1 per content.
    //
    // BUG-P5-02: scoped to the ACTIVE engine, with the same filter, the same
    // ordering (LATEST_SCORE_ORDER_BY) and the same collapse rule
    // (latestScorePerPlatform) as RankingEngineService.getLatestScores. This
    // surface and the per-content ranking read must select the SAME rows
    // before pickRecommendedScore ever runs — a shared tie-break over two
    // differently-scoped row sets would still let the two disagree, which is
    // the guarantee BUG-QA-003 exists to protect.
    const scores = await this.prisma.rankingScore.findMany({
      where: {
        contentId: { in: contents.map((content) => content.id) },
        engineVersion: this.activeEngine.version,
      },
      orderBy: LATEST_SCORE_ORDER_BY,
    });

    const rowsByContent = new Map<string, RankingScore[]>();
    for (const score of scores) {
      const list = rowsByContent.get(score.contentId) ?? [];
      list.push(score);
      rowsByContent.set(score.contentId, list);
    }
    const latestScores = new Map<string, RankingScore[]>(
      [...rowsByContent].map(([contentId, rows]) => [contentId, latestScorePerPlatform(rows)]),
    );

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
    // SHARED tie-break with RankingEngineService.getRecommendation so the
    // scheduler overview and the publish-time override recompute can never
    // disagree on a tie (BUG-QA-003).
    return pickRecommendedScore(scores)?.platform ?? null;
  }
}

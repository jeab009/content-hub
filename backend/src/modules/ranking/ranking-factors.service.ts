import { Injectable } from '@nestjs/common';
import { AssetPlatform, ContentPillar, PostStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toPostPlatform } from '../../common/utils/platform-map.util';
import { currentPeriodStart } from '../../common/utils/cadence-period.util';
import {
  API_AVAILABILITY_VALUE,
  FACTOR_WEIGHTS,
  NEUTRAL_FACTOR_VALUE,
  RECENT_POSTS_WINDOW_DAYS,
  RankingFactor,
  clamp01,
  round4,
} from './ranking.constants';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PCT_MAX = 100;

/** Post statuses that count as "went live" for distribution/cadence math. */
const LIVE_POST_STATUSES: PostStatus[] = [PostStatus.posted, PostStatus.posted_unconfirmed];

/**
 * Computes the four explainable v1 ranking factors. Each method returns a
 * complete RankingFactor (raw inputs + weight + normalized 0..1 value +
 * contribution) so the persisted reasoning payload needs no further
 * interpretation. Factors degrade to NEUTRAL_FACTOR_VALUE — never throw —
 * when their data source is empty (no metrics yet, no policy row, etc.).
 */
@Injectable()
export class RankingFactorsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Engagement/earnings history for (content pillar, platform), from the
   * metrics table. Normalization: platformAvg / (platformAvg + overallAvg)
   * across all platforms for the same pillar — exactly 0.5 when this
   * platform performs at the pillar's cross-platform average, above 0.5
   * when it outperforms it. Empty history (the launch state) is neutral.
   */
  async engagementHistory(
    pillar: ContentPillar | null,
    platform: AssetPlatform,
  ): Promise<RankingFactor> {
    const weight = FACTOR_WEIGHTS.engagementHistory;
    if (pillar === null) {
      return this.neutral('engagement_history', weight, { reason: 'content_has_no_pillar' });
    }

    const pillarFilter = { post: { content: { contentPillar: pillar } } };
    const [platformAgg, overallAgg] = await Promise.all([
      this.prisma.metric.aggregate({
        _avg: { engagement: true, revenue: true },
        _count: { _all: true },
        where: { platform: toPostPlatform(platform), ...pillarFilter },
      }),
      this.prisma.metric.aggregate({
        _avg: { engagement: true },
        _count: { _all: true },
        where: pillarFilter,
      }),
    ]);

    const sampleSize = platformAgg._count._all;
    const platformAvg = platformAgg._avg.engagement ?? 0;
    const overallAvg = overallAgg._avg.engagement ?? 0;

    if (sampleSize === 0 || overallAvg + platformAvg === 0) {
      return this.neutral('engagement_history', weight, {
        pillar,
        sampleSize,
        reason: 'no_engagement_history',
      });
    }

    const value = round4(clamp01(platformAvg / (platformAvg + overallAvg)));
    return this.factor('engagement_history', weight, value, {
      pillar,
      sampleSize,
      platformAvgEngagement: round4(platformAvg),
      pillarAvgEngagementAllPlatforms: round4(overallAvg),
      platformAvgRevenue: round4(Number(platformAgg._avg.revenue ?? 0)),
    });
  }

  /**
   * Constant per-platform weight for API automation depth (auto earnings/
   * metrics sync vs. manual reporting). See API_AVAILABILITY_VALUE.
   */
  apiAvailability(platform: AssetPlatform): RankingFactor {
    const value = API_AVAILABILITY_VALUE[platform];
    return this.factor('api_availability', FACTOR_WEIGHTS.apiAvailability, value, {
      platform,
      automatedApiSync: value >= NEUTRAL_FACTOR_VALUE,
    });
  }

  /**
   * How under/over-served this content's pillar is versus its target ratio
   * (pillar_ratio_policies), measured against the pillar distribution of
   * posts that went live in the last RECENT_POSTS_WINDOW_DAYS days.
   * value = clamp01(0.5 + (targetPct - actualPct)/100): an under-target
   * pillar scores above 0.5 (publish it sooner), over-target below 0.5.
   */
  async pillarAlignment(pillar: ContentPillar | null): Promise<RankingFactor> {
    const weight = FACTOR_WEIGHTS.pillarAlignment;
    if (pillar === null) {
      return this.neutral('pillar_alignment', weight, { reason: 'content_has_no_pillar' });
    }

    const policy = await this.prisma.pillarRatioPolicy.findFirst({
      where: { contentPillar: pillar },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!policy) {
      return this.neutral('pillar_alignment', weight, { pillar, reason: 'no_ratio_policy' });
    }

    const windowStart = new Date(Date.now() - RECENT_POSTS_WINDOW_DAYS * MS_PER_DAY);
    const liveWindowFilter = { status: { in: LIVE_POST_STATUSES }, postedAt: { gte: windowStart } };
    const [totalRecent, pillarRecent] = await Promise.all([
      this.prisma.post.count({ where: liveWindowFilter }),
      this.prisma.post.count({
        where: { ...liveWindowFilter, content: { contentPillar: pillar } },
      }),
    ]);

    const targetPct = Number(policy.targetRatioPct);
    const actualPct = totalRecent === 0 ? 0 : (pillarRecent / totalRecent) * PCT_MAX;
    const value = round4(clamp01(NEUTRAL_FACTOR_VALUE + (targetPct - actualPct) / PCT_MAX));
    return this.factor('pillar_alignment', weight, value, {
      pillar,
      targetRatioPct: targetPct,
      actualRatioPct: round4(actualPct),
      recentLivePosts: totalRecent,
      recentLivePostsForPillar: pillarRecent,
      windowDays: RECENT_POSTS_WINDOW_DAYS,
    });
  }

  /**
   * Cadence pressure: how far the platform is below its cadence target
   * (platform_cadence_targets) for the current period.
   * value = clamp01(1 - published/target): a platform that has posted
   * nothing this period scores 1.0, one at/over target scores 0.
   */
  async cadencePressure(platform: AssetPlatform): Promise<RankingFactor> {
    const weight = FACTOR_WEIGHTS.cadencePressure;
    const target = await this.prisma.platformCadenceTarget.findFirst({
      where: { platform },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!target || target.targetPostsPerPeriod <= 0) {
      return this.neutral('cadence_pressure', weight, { platform, reason: 'no_cadence_target' });
    }

    const periodStart = currentPeriodStart(target.periodUnit);
    const publishedThisPeriod = await this.prisma.post.count({
      where: {
        platform: toPostPlatform(platform),
        status: { in: LIVE_POST_STATUSES },
        postedAt: { gte: periodStart },
      },
    });

    const value = round4(clamp01(1 - publishedThisPeriod / target.targetPostsPerPeriod));
    return this.factor('cadence_pressure', weight, value, {
      platform,
      targetPostsPerPeriod: target.targetPostsPerPeriod,
      periodUnit: target.periodUnit,
      periodStart: periodStart.toISOString(),
      publishedThisPeriod,
    });
  }

  private neutral(
    name: RankingFactor['name'],
    weight: number,
    input: RankingFactor['input'],
  ): RankingFactor {
    return this.factor(name, weight, NEUTRAL_FACTOR_VALUE, { ...input, neutral: true });
  }

  private factor(
    name: RankingFactor['name'],
    weight: number,
    value: number,
    input: RankingFactor['input'],
  ): RankingFactor {
    return { name, input, weight, value, contribution: round4(weight * value) };
  }
}

import { Injectable } from '@nestjs/common';
import { AssetPlatform, ContentPillar } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toPostPlatform } from '../../common/utils/platform-map.util';
import { RankingFactorsService } from './ranking-factors.service';
import { NEUTRAL_FACTOR_VALUE, RankingFactor, clamp01, round4 } from './ranking.constants';
import {
  ENGAGEMENT_REVENUE_BLEND,
  FACTOR_WEIGHTS_V2,
  OVERRIDE_LOOKBACK_DAYS,
  OVERRIDE_MIN_SAMPLE_SIZE,
  OVERRIDE_RATE_NORMALIZER,
} from './ranking-v2.constants';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The five explainable v2 ranking factors.
 *
 * Three of them — api_availability, pillar_alignment, cadence_pressure — are
 * computed by delegating to the FROZEN v1 service and then re-weighting the
 * result. That is deliberate: it makes "v2 uses the same formula as v1 for
 * these factors" a structural fact rather than a claim maintained by hand, so
 * the two engines can never quietly drift apart. Only the weight (and hence
 * the contribution) differs.
 *
 * The other two are genuinely new: engagement_history now blends revenue in
 * alongside engagement, and override_feedback is new in v2 entirely.
 */
@Injectable()
export class RankingFactorsV2Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly v1Factors: RankingFactorsService,
  ) {}

  /** Unchanged v1 formula, v2 weight. */
  apiAvailability(platform: AssetPlatform): RankingFactor {
    return reweight(this.v1Factors.apiAvailability(platform), FACTOR_WEIGHTS_V2.apiAvailability);
  }

  /** Unchanged v1 formula, v2 weight. */
  async pillarAlignment(pillar: ContentPillar | null): Promise<RankingFactor> {
    return reweight(
      await this.v1Factors.pillarAlignment(pillar),
      FACTOR_WEIGHTS_V2.pillarAlignment,
    );
  }

  /** Unchanged v1 formula, v2 weight. */
  async cadencePressure(platform: AssetPlatform): Promise<RankingFactor> {
    return reweight(
      await this.v1Factors.cadencePressure(platform),
      FACTOR_WEIGHTS_V2.cadencePressure,
    );
  }

  /**
   * Engagement AND earnings history for (pillar, platform).
   *
   * v1 scored engagement alone — it surfaced platformAvgRevenue in `input` but
   * never let it touch the value, so a platform that earned well but engaged
   * modestly was scored as if the money did not exist. v2 blends the two
   * (ENGAGEMENT_REVENUE_BLEND) so the actual business objective moves the
   * score.
   *
   * Each component uses v1's relative normalization — platformAvg /
   * (platformAvg + pillarAvgAcrossPlatforms) — which sits at exactly 0.5 when
   * this platform performs at the pillar's cross-platform average. A component
   * whose denominator is zero (e.g. nobody has earned anything on this pillar
   * yet) falls back to neutral instead of dragging the blend to zero.
   */
  async engagementHistory(
    pillar: ContentPillar | null,
    platform: AssetPlatform,
  ): Promise<RankingFactor> {
    const weight = FACTOR_WEIGHTS_V2.engagementHistory;
    if (pillar === null) {
      return neutral('engagement_history', weight, { reason: 'content_has_no_pillar' });
    }

    const pillarFilter = { post: { content: { contentPillar: pillar } } };
    const [platformAgg, overallAgg] = await Promise.all([
      this.prisma.metric.aggregate({
        _avg: { engagement: true, revenue: true },
        _count: { _all: true },
        where: { platform: toPostPlatform(platform), ...pillarFilter },
      }),
      this.prisma.metric.aggregate({
        _avg: { engagement: true, revenue: true },
        _count: { _all: true },
        where: pillarFilter,
      }),
    ]);

    const sampleSize = platformAgg._count._all;
    const platformEngagement = platformAgg._avg.engagement ?? 0;
    const overallEngagement = overallAgg._avg.engagement ?? 0;
    const platformRevenue = Number(platformAgg._avg.revenue ?? 0);
    const overallRevenue = Number(overallAgg._avg.revenue ?? 0);

    if (sampleSize === 0) {
      return neutral('engagement_history', weight, {
        pillar,
        sampleSize,
        reason: 'no_engagement_history',
      });
    }

    const engagementComponent = relativeShare(platformEngagement, overallEngagement);
    const revenueComponent = relativeShare(platformRevenue, overallRevenue);
    const value = round4(
      clamp01(
        engagementComponent * ENGAGEMENT_REVENUE_BLEND.engagementShare +
          revenueComponent * ENGAGEMENT_REVENUE_BLEND.revenueShare,
      ),
    );

    return factor('engagement_history', weight, value, {
      pillar,
      sampleSize,
      platformAvgEngagement: round4(platformEngagement),
      pillarAvgEngagementAllPlatforms: round4(overallEngagement),
      platformAvgRevenue: round4(platformRevenue),
      pillarAvgRevenueAllPlatforms: round4(overallRevenue),
      engagementComponent: round4(engagementComponent),
      revenueComponent: round4(revenueComponent),
      engagementShare: ENGAGEMENT_REVENUE_BLEND.engagementShare,
      revenueShare: ENGAGEMENT_REVENUE_BLEND.revenueShare,
    });
  }

  /**
   * NEW in v2. Learns from the admin's own past publish decisions for this
   * pillar, over the last OVERRIDE_LOOKBACK_DAYS days:
   *
   * - the engine recommended this platform and the admin published elsewhere
   *   → the recommendation was rejected → down-weight (awayRate);
   * - the admin overrode a different recommendation and chose THIS platform
   *   → a revealed preference → up-weight (towardRate).
   *
   * value = clamp01(0.5 + (towardRate − awayRate) / OVERRIDE_RATE_NORMALIZER).
   *
   * Below OVERRIDE_MIN_SAMPLE_SIZE decisions the factor returns a flat neutral:
   * with one admin, three decisions are anecdote, and letting them move the
   * score would bake a single off-day into every future recommendation (R4).
   *
   * The raw counts go into `input` so the UI can show exactly why the signal
   * moved — the factor stays auditable and arguable, never a black box (C-D).
   */
  async overrideFeedback(
    pillar: ContentPillar | null,
    platform: AssetPlatform,
  ): Promise<RankingFactor> {
    const weight = FACTOR_WEIGHTS_V2.overrideFeedback;
    if (pillar === null) {
      return neutral('override_feedback', weight, { reason: 'content_has_no_pillar' });
    }

    const windowStart = new Date(Date.now() - OVERRIDE_LOOKBACK_DAYS * MS_PER_DAY);
    // Every post that carries a recommendation is one decision the admin made:
    // they were shown a recommendation and either took it or did not. Status is
    // not filtered — a publish that later failed still recorded a real choice.
    const decisions = await this.prisma.post.findMany({
      where: {
        recommendedPlatform: { not: null },
        createdAt: { gte: windowStart },
        content: { contentPillar: pillar },
      },
      select: { recommendedPlatform: true, selectedPlatform: true, wasOverride: true },
    });

    const sampleSize = decisions.length;
    const recommendedCount = decisions.filter((row) => row.recommendedPlatform === platform).length;
    const overriddenAwayCount = decisions.filter(
      (row) => row.recommendedPlatform === platform && row.wasOverride,
    ).length;
    const selectedAsOverrideCount = decisions.filter(
      (row) => row.wasOverride && row.selectedPlatform === platform,
    ).length;

    const baseInput = {
      pillar,
      platform,
      sampleSize,
      recommendedCount,
      overriddenAwayCount,
      selectedAsOverrideCount,
      lookbackDays: OVERRIDE_LOOKBACK_DAYS,
      minSampleSize: OVERRIDE_MIN_SAMPLE_SIZE,
    };

    if (sampleSize < OVERRIDE_MIN_SAMPLE_SIZE) {
      return neutral('override_feedback', weight, {
        ...baseInput,
        reason: 'below_min_sample_size',
      });
    }

    const awayRate = overriddenAwayCount / sampleSize;
    const towardRate = selectedAsOverrideCount / sampleSize;
    const value = round4(
      clamp01(NEUTRAL_FACTOR_VALUE + (towardRate - awayRate) / OVERRIDE_RATE_NORMALIZER),
    );

    return factor('override_feedback', weight, value, {
      ...baseInput,
      awayRate: round4(awayRate),
      towardRate: round4(towardRate),
      normalizer: OVERRIDE_RATE_NORMALIZER,
    });
  }
}

/**
 * v1's relative-share normalization: 0.5 when this platform matches the
 * pillar's cross-platform average, higher when it beats it. Neutral when
 * there is nothing to compare (both sides zero).
 */
function relativeShare(platformAvg: number, overallAvg: number): number {
  const denominator = platformAvg + overallAvg;
  return denominator === 0 ? NEUTRAL_FACTOR_VALUE : clamp01(platformAvg / denominator);
}

/** Same formula, different weight — the contribution must follow the weight. */
function reweight(source: RankingFactor, weight: number): RankingFactor {
  return { ...source, weight, contribution: round4(weight * source.value) };
}

function neutral(
  name: RankingFactor['name'],
  weight: number,
  input: RankingFactor['input'],
): RankingFactor {
  return factor(name, weight, NEUTRAL_FACTOR_VALUE, { ...input, neutral: true });
}

function factor(
  name: RankingFactor['name'],
  weight: number,
  value: number,
  input: RankingFactor['input'],
): RankingFactor {
  return { name, input, weight, value, contribution: round4(weight * value) };
}

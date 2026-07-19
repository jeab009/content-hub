import { AssetPlatform } from '@prisma/client';
import { PLATFORM_TIE_BREAK_ORDER } from './ranking.constants';

/**
 * Ranking engine v2 constants. Deliberately a SEPARATE file from
 * ranking.constants.ts: v1's weights and platform set are frozen so every v1
 * test passes unchanged and any v1-tagged score row stays attributable to v1
 * logic (the reason EngineVersion exists). v2 shares only the genuinely
 * shared primitives — clamp01, round4, the RankingFactor shape, and the
 * pickRecommendedScore tie-break.
 */

/**
 * Platforms the v2 engine scores: all four. Built by APPENDING to the v1 pair
 * via PLATFORM_TIE_BREAK_ORDER, so Facebook and YouTube keep index 0 and 1 and
 * their tie-break outcomes are identical to v1's.
 */
export const RANKED_PLATFORMS_V2: readonly AssetPlatform[] = PLATFORM_TIE_BREAK_ORDER;

/**
 * v2 factor weights. Must sum to 1.0 (unit-tested, same as v1) so the total
 * stays in 0..1 and each `contribution` reads directly as "share of the final
 * score".
 *
 * Rationale for the shift away from v1 (0.35/0.20/0.20/0.25): real metrics and
 * override history now exist, so weight moves toward earnings/engagement and
 * the admin's revealed preferences, and the api_availability thumb-on-the-scale
 * — which mattered most when all history was empty — is trimmed 0.20 → 0.15.
 * override_feedback is capped at 0.20 so a sparse, single-admin signal can
 * never dominate the score (risk R4).
 */
export const FACTOR_WEIGHTS_V2 = {
  engagementHistory: 0.3,
  overrideFeedback: 0.2,
  cadencePressure: 0.2,
  pillarAlignment: 0.15,
  apiAvailability: 0.15,
} as const;

/**
 * Engagement:revenue mix inside the v2 engagement_history factor. v1 scored
 * engagement alone (it exposed platformAvgRevenue in `input` but never used
 * it); v2 blends revenue in so the business objective — payout — actually
 * moves the score. 50/50 is the provisional default, to be tuned at UAT with
 * real data (same provisional pattern as the pillar-ratio/cadence targets).
 */
export const ENGAGEMENT_REVENUE_BLEND = {
  engagementShare: 0.5,
  revenueShare: 0.5,
} as const;

/** Lookback window for the override-feedback read model. */
export const OVERRIDE_LOOKBACK_DAYS = 90;

/**
 * Minimum number of override decisions for a pillar before the
 * override_feedback factor is allowed to move off neutral. Below this the
 * factor returns NEUTRAL_FACTOR_VALUE — with a single admin, two or three
 * decisions are anecdote, not signal, and letting them swing the score would
 * bake one bad call into every future recommendation (risk R4).
 */
export const OVERRIDE_MIN_SAMPLE_SIZE = 5;

/**
 * Divisor on (towardRate − awayRate) in the override factor. Both rates are
 * in 0..1, so their difference spans −1..1; a normalizer of 2 maps that onto
 * ±0.5 around the 0.5 neutral point, i.e. the factor's value spans the full
 * 0..1 like every other factor.
 *
 * Combined with the 0.20 weight, the override signal moves a total score by at
 * most ±0.10 — a tenth of the score range. Note that the extremes are only
 * reachable on a UNANIMOUS history (every single decision for this pillar in
 * the window was an override away from, or toward, this platform); any mixed
 * record lands well inside that. Together with the min-sample floor below,
 * that keeps the factor advisory rather than decisive (risk R4).
 */
export const OVERRIDE_RATE_NORMALIZER = 2;

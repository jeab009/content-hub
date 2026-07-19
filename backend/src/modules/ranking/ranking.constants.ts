import { AssetPlatform, Prisma } from '@prisma/client';

/**
 * Platforms the **v1** ranking engine scores. Facebook and YouTube are the two
 * platforms with a working connect flow + publish adapter in Pass B. FROZEN at
 * two entries: v1's computeScores iterates this list, so adding to it changes
 * how many score rows v1 writes. Phase 5's four-platform scoring set lives in
 * RANKED_PLATFORMS_V2 (ranking-v2.constants.ts) instead.
 *
 * ORDER IS SEMANTIC: these two entries lead PLATFORM_TIE_BREAK_ORDER, the
 * documented tie-break order for recommendations — on equal scores the
 * platform earlier in that list wins (see pickRecommendedScore). Reordering
 * changes recommendation outcomes.
 */
export const RANKED_PLATFORMS: readonly AssetPlatform[] = [
  AssetPlatform.facebook,
  AssetPlatform.youtube,
];

/**
 * Tie-break order for recommendations across ALL platforms — the v1 pair
 * followed by the Phase 5 additions, APPENDED and never reordered.
 *
 * Why this is separate from RANKED_PLATFORMS: that constant does double duty
 * in v1 — it is both the *set of platforms the v1 engine scores* and the
 * tie-break order. Phase 5 only wants to extend the latter. Appending
 * tiktok/line_oa to RANKED_PLATFORMS itself would silently make the FROZEN v1
 * engine emit four score rows per content instead of two (it iterates this
 * list in computeScores), changing v1 behavior and breaking its tests. So the
 * two concerns are split here: v1 keeps scoring its two platforms, while the
 * shared tie-break can rank all four.
 *
 * Facebook and YouTube keep index 0 and 1, so every existing tie-break
 * outcome is bit-for-bit unchanged.
 */
export const PLATFORM_TIE_BREAK_ORDER: readonly AssetPlatform[] = [
  ...RANKED_PLATFORMS,
  AssetPlatform.tiktok,
  AssetPlatform.line_oa,
];

/** Minimal shape the recommendation tie-break needs from a score row. */
export interface ScoreLike {
  platform: AssetPlatform;
  score: Prisma.Decimal | number;
}

/**
 * The single, shared "which platform does this set of scores recommend?"
 * rule. Highest score wins; ties break deterministically toward the platform
 * that appears earlier in PLATFORM_TIE_BREAK_ORDER (a platform not in the list
 * sorts last). Returns null for an empty set. Shared by v1 AND v2 — the reason
 * the tie-break order covers all four platforms.
 *
 * Both the per-content ranking path (RankingEngineService.getRecommendation,
 * which the publish-time override recompute reads) and the batched scheduler
 * overview (SchedulerService.topPlatform) MUST route through this so their
 * recommendations can never disagree on a tie — see BUG-QA-003.
 */
export function pickRecommendedScore<T extends ScoreLike>(scores: readonly T[]): T | null {
  if (scores.length === 0) {
    return null;
  }
  const rank = (platform: AssetPlatform): number => {
    const index = PLATFORM_TIE_BREAK_ORDER.indexOf(platform);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return scores.reduce((best, row) => {
    const delta = Number(row.score) - Number(best.score);
    if (delta > 0) {
      return row;
    }
    if (delta < 0) {
      return best;
    }
    return rank(row.platform) < rank(best.platform) ? row : best;
  });
}

/**
 * Factor value used when a factor has no data to speak from (e.g. no
 * engagement history yet). 0.5 is the exact midpoint of every factor's
 * 0..1 range, so "we know nothing" neither boosts nor punishes a platform.
 */
export const NEUTRAL_FACTOR_VALUE = 0.5;

/**
 * API-availability factor input per platform: platforms with automated
 * earnings/metrics sync via official APIs (Facebook Graph, YouTube Data)
 * score high; manual-reporting platforms (TikTok, LINE OA in this system's
 * current integration state) score low. A plain constant map — revisit when
 * Phase 5 adapters land.
 */
export const API_AVAILABILITY_VALUE: Record<AssetPlatform, number> = {
  [AssetPlatform.facebook]: 1.0,
  [AssetPlatform.youtube]: 1.0,
  [AssetPlatform.tiktok]: 0.4,
  [AssetPlatform.line_oa]: 0.4,
};

/**
 * v1 factor weights. Must sum to 1.0 so the total score stays in 0..1 and
 * each factor's `contribution` is directly readable as "share of the final
 * score". Checked by a unit test, not runtime code.
 */
export const FACTOR_WEIGHTS = {
  engagementHistory: 0.35,
  apiAvailability: 0.2,
  pillarAlignment: 0.2,
  cadencePressure: 0.25,
} as const;

/** Lookback window for the recent-posts pillar-distribution factor. */
export const RECENT_POSTS_WINDOW_DAYS = 30;

export type RankingFactorName =
  | 'engagement_history'
  | 'api_availability'
  | 'pillar_alignment'
  | 'cadence_pressure'
  // Phase 5, v2 only. Additive union member — no v1 code path emits it.
  | 'override_feedback';

/**
 * One explainable factor of a ranking score. `value` is the normalized
 * 0..1 factor score, `contribution = weight * value`, and `input` carries
 * the raw numbers the value was derived from so the UI can render "why".
 */
export interface RankingFactor {
  name: RankingFactorName;
  input: Record<string, string | number | boolean | null>;
  weight: number;
  value: number;
  contribution: number;
}

/** Shape persisted into ranking_scores.reasoning (jsonb). */
export interface RankingReasoning {
  engineVersion: string;
  factors: RankingFactor[];
  total: number;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Rounds to 4 decimal places — matches the Decimal(10,4) score column. */
export function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

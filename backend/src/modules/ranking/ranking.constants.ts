import { AssetPlatform } from '@prisma/client';

/**
 * Platforms the v1 ranking engine scores. Facebook and YouTube are the two
 * platforms with a working connect flow + publish adapter in Pass B; TikTok
 * and LINE OA join in Phase 5 by extending this list (the engine itself is
 * platform-count agnostic).
 */
export const RANKED_PLATFORMS: readonly AssetPlatform[] = [
  AssetPlatform.facebook,
  AssetPlatform.youtube,
];

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
  'engagement_history' | 'api_availability' | 'pillar_alignment' | 'cadence_pressure';

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

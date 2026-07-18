import type { AssetPlatform, ReadyContentOverview, ReadyContentScore } from '@/lib/api-client';

/**
 * Pure decision helpers for the publish confirm flow. The backend is the
 * source of truth for `wasOverride` (it recomputes server-side), but the UI
 * needs the same judgment locally to drive the modal: show which platform is
 * recommended, detect when the admin has picked a different one, and require
 * an override reason at that point.
 */

/**
 * True when the admin's chosen platform differs from the ranking
 * recommendation. A null recommendation (no scores yet) is never an
 * override — there is nothing to deviate from.
 */
export function isOverride(
  selected: AssetPlatform,
  recommended: AssetPlatform | null,
): boolean {
  return recommended !== null && selected !== recommended;
}

/**
 * Whether the override-reason field must be filled. We require a reason
 * whenever the admin overrides the recommendation so the deviation is
 * auditable (the confirm button stays disabled until then).
 */
export function overrideReasonRequired(
  selected: AssetPlatform,
  recommended: AssetPlatform | null,
): boolean {
  return isOverride(selected, recommended);
}

/**
 * True when the publish confirm button may be enabled: a password is present,
 * and if this is an override the reason has been provided.
 */
export function canSubmitPublish(params: {
  selected: AssetPlatform;
  recommended: AssetPlatform | null;
  password: string;
  overrideReason: string;
}): boolean {
  if (params.password.trim().length === 0) {
    return false;
  }
  if (
    overrideReasonRequired(params.selected, params.recommended) &&
    params.overrideReason.trim().length === 0
  ) {
    return false;
  }
  return true;
}

/** The score row for a content's recommended platform, or null if absent. */
export function recommendedScore(content: ReadyContentOverview): ReadyContentScore | null {
  if (content.recommendedPlatform === null) {
    return null;
  }
  return (
    content.latestScores.find((row) => row.platform === content.recommendedPlatform) ?? null
  );
}

/** True when a content has no ranking scores yet and needs a recompute. */
export function needsRanking(content: ReadyContentOverview): boolean {
  return content.latestScores.length === 0;
}

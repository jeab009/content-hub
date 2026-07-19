import type {
  AssetPlatform,
  PostPlatform,
  ReadyContentOverview,
  ReadyContentScore,
} from '@/lib/api-client';

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

/**
 * Bridges the two platform enums that deliberately coexist in the schema —
 * `Platform` (posts, metrics, comments, connected accounts; names LINE `line`)
 * and `AssetPlatform` (ranking scores, cadence targets, content assets; names
 * it `line_oa`). Mirrors the backend's POST_TO_ASSET_PLATFORM.
 *
 * Only LINE actually differs, which is exactly why this must be a real map:
 * with four platforms live, a naive cast silently produces `'line'` where an
 * AssetPlatform is expected and every lookup keyed on it misses.
 */
const POST_TO_ASSET_PLATFORM: Record<PostPlatform, AssetPlatform> = {
  facebook: 'facebook',
  youtube: 'youtube',
  tiktok: 'tiktok',
  line: 'line_oa',
};

export function toAssetPlatform(platform: PostPlatform): AssetPlatform {
  return POST_TO_ASSET_PLATFORM[platform];
}

// --- Manual-external record (Phase 5B.1) ---

/**
 * Platforms whose delivered publish path is "post natively, then record it
 * here" (phase5-project-plan.md Decision 1): TikTok's Content Posting API
 * needs an audited app, and a LINE OA broadcast is a push to followers rather
 * than an addressable feed post. Neither is a live integration in this build.
 *
 * This drives a HINT only. The normal publish path stays open for all four —
 * the backend registers mock adapters for TikTok/LINE and will dispatch them.
 */
export const MANUAL_RECORD_PLATFORMS: AssetPlatform[] = ['tiktok', 'line_oa'];

export function isManualRecordPlatform(platform: AssetPlatform): boolean {
  return MANUAL_RECORD_PLATFORMS.includes(platform);
}

/** Mirrors RecordManualExternalDto's MaxLength constraints so the UI fails first. */
export const EXTERNAL_POST_ID_MAX_LENGTH = 255;
export const EXTERNAL_POST_URL_MAX_LENGTH = 2048;

/**
 * Mirrors the DTO's `@IsUrl({ require_protocol: true, protocols: ['http','https'] })`.
 * Blank is valid — the field is optional, because a LINE OA broadcast has a
 * message id but no public permalink.
 */
export function isValidExternalPostUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return true;
  }
  if (trimmed.length > EXTERNAL_POST_URL_MAX_LENGTH) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Blank is valid (optional field); anything present must fit the DTO's limit. */
export function isValidExternalPostId(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= EXTERNAL_POST_ID_MAX_LENGTH;
}

/**
 * True when the manual-record confirm button may be enabled. Same shape of
 * judgment as canSubmitPublish — password present, override reason present
 * when overriding — plus this path's own required field, the platform-native
 * post id, and a well-formed optional URL.
 */
export function canSubmitManualRecord(params: {
  selected: AssetPlatform;
  recommended: AssetPlatform | null;
  externalPostId: string;
  externalPostUrl: string;
  password: string;
  overrideReason: string;
}): boolean {
  if (!isValidExternalPostId(params.externalPostId)) {
    return false;
  }
  if (!isValidExternalPostUrl(params.externalPostUrl)) {
    return false;
  }
  return canSubmitPublish({
    selected: params.selected,
    recommended: params.recommended,
    password: params.password,
    overrideReason: params.overrideReason,
  });
}

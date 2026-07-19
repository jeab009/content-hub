import { CommentPriority, Platform, PostStatus } from '@prisma/client';

/**
 * Platforms whose comments can be pulled via an API adapter (FB + YouTube
 * this phase). TikTok / LINE OA join in Phase 5. Mirrors metrics.constants
 * API_CAPABLE_PLATFORMS so ingestion only ever reaches an implemented adapter.
 */
export const COMMENT_API_CAPABLE_PLATFORMS: readonly Platform[] = [
  Platform.facebook,
  Platform.youtube,
];

/**
 * Post statuses whose comments are worth reading — a post must be live (or
 * believed live) to have any. Mirrors METRIC_ELIGIBLE_STATUSES.
 */
export const COMMENT_ELIGIBLE_STATUSES: readonly PostStatus[] = [
  PostStatus.posted,
  PostStatus.posted_unconfirmed,
];

/**
 * SLA hours per priority (provisional defaults — admin confirms at UAT, the
 * same PROVISIONAL pattern as pillar-ratio / cadence). `slaDueAt =
 * collectedAt + SLA_HOURS[priority]`; `null` means no SLA clock (spam).
 * A comment is SLA-breached when `slaDueAt < now AND repliedAt IS NULL` —
 * computed in the read-model, never stored, so it stays correct as time passes.
 */
export const SLA_HOURS_BY_PRIORITY: Readonly<Record<CommentPriority, number | null>> = {
  [CommentPriority.complaint]: 4,
  [CommentPriority.question]: 24,
  [CommentPriority.spam]: null,
  [CommentPriority.general]: 48,
};

/**
 * Escalation rolling-window spike detector (provisional — Analyst + admin
 * tune with real data, plan §8.3). A spike is active when
 * `negativeCount >= ESCALATION_THRESHOLD` over the trailing
 * `ESCALATION_WINDOW_MINUTES`.
 *
 * WINDOW vs DEDUP BUCKET (System Analyst condition C5): the negative COUNT is
 * taken over the rolling window `[now - WINDOW, now]`, but the alert is
 * DEDUPED on `windowStart` = the floor of `now` to the top of the hour. The
 * guaranteed cadence is therefore "at most ONE alert per rule per hourly
 * bucket". A sustained spike that straddles a bucket boundary can legitimately
 * raise a second alert in the new bucket — this is intended (a spike still
 * active an hour later is worth re-surfacing) and bounded (never more than one
 * per hour), so it neither floods (dedup) nor goes silent (boundary re-alert).
 */
export const ESCALATION_WINDOW_MINUTES = 60;
export const ESCALATION_THRESHOLD = 5;
export const ESCALATION_RULE_KEY = 'negative_spike';

/** PDPA storage-limitation TTL — hard-delete comments older than this (on collectedAt). */
export const RETENTION_MONTHS = 12;

/** Inbox pagination guard-rails (System Analyst condition C9). */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/**
 * Length caps (System Analyst condition C9). Reply message maps to the
 * tightest platform comment limit we support; template body is generous but
 * bounded so a template can't smuggle an oversized payload into a reply.
 */
export const MAX_REPLY_MESSAGE_LENGTH = 2000;
export const MAX_TEMPLATE_TITLE_LENGTH = 120;
export const MAX_TEMPLATE_BODY_LENGTH = 2000;

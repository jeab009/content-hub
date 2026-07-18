import { Platform, PostStatus } from '@prisma/client';

/**
 * Platforms whose metrics can be pulled automatically via an API adapter
 * (makedown.md §6). TikTok / LINE OA have no public metrics API, so their
 * numbers arrive only through the manual-entry endpoint.
 */
export const API_CAPABLE_PLATFORMS: readonly Platform[] = [Platform.facebook, Platform.youtube];

/**
 * Post statuses whose metrics are worth reading — a post must actually be
 * live (or believed live) to have any. Mirrors the scheduler's
 * "counts as live" set.
 */
export const METRIC_ELIGIBLE_STATUSES: readonly PostStatus[] = [
  PostStatus.posted,
  PostStatus.posted_unconfirmed,
];

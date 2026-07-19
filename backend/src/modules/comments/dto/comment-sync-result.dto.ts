import { Platform } from '@prisma/client';

export type CommentSyncOutcome = 'synced' | 'skipped' | 'failed';

export interface CommentSyncItemResult {
  postId: string;
  platform: Platform;
  outcome: CommentSyncOutcome;
  /** Comments newly inserted for this post (dedup skips existing). */
  inserted?: number;
  /** Present on skipped/failed — why the post produced no new comments. */
  reason?: string;
}

/**
 * Summary of a comment-sync run. Per-post failures never abort the batch —
 * mirrors SyncResultDto (metrics). `inserted` is the count of NEW rows across
 * the batch (re-sync inserts zero, thanks to the dedup index).
 */
export class CommentSyncResultDto {
  ranAt!: Date;
  eligible!: number;
  synced!: number;
  skipped!: number;
  failed!: number;
  inserted!: number;
  items!: CommentSyncItemResult[];
}

import { Platform } from '@prisma/client';

export type SyncOutcome = 'synced' | 'skipped' | 'failed';

export interface SyncItemResult {
  postId: string;
  platform: Platform;
  outcome: SyncOutcome;
  /** Present on skipped/failed — why the post produced no new metric. */
  reason?: string;
}

/**
 * Summary of a metric-sync run. Per-post failures never abort the batch —
 * each post's outcome is reported independently so one stale token can't
 * hide every other platform's numbers.
 */
export class SyncResultDto {
  ranAt!: Date;
  eligible!: number;
  synced!: number;
  skipped!: number;
  failed!: number;
  items!: SyncItemResult[];
}

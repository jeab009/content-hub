import { ConflictException } from '@nestjs/common';
import { PostStatus } from '@prisma/client';

/**
 * Thrown on any post status transition outside the state machine in
 * docs/publish-orchestration-addendum.md §4 (e.g. publishing a `posted`
 * post, auto-retrying `posted_unconfirmed`). Extends ConflictException so
 * it surfaces as HTTP 409 without a bespoke exception filter.
 */
export class InvalidPostStateTransitionError extends ConflictException {
  constructor(from: PostStatus, attempted: string) {
    super(`Post in status "${from}" cannot ${attempted}`);
  }
}

/**
 * Statuses a publish dispatch may claim from (addendum §3: the pre-write
 * conditional UPDATE requires status IN ('draft','failed')). Notably
 * `posted_unconfirmed` is excluded — it exits ONLY via the two explicit
 * admin resolution actions.
 */
export const DISPATCHABLE_STATUSES: readonly PostStatus[] = [PostStatus.draft, PostStatus.failed];

export function isDispatchable(status: PostStatus): boolean {
  return DISPATCHABLE_STATUSES.includes(status);
}

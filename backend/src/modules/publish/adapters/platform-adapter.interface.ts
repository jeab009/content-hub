import { AssetPlatform, ConnectedAccount, Content, Post } from '@prisma/client';

/**
 * Everything an adapter needs to publish one post. The decrypted access
 * token travels separately from the account row: ConnectedAccountsService.
 * getValidToken() is the only sanctioned decryption path, so the row itself
 * never carries plaintext. `accessToken: null` means the caller could not
 * obtain a token — adapters must reject that with PublisherTokenError
 * (even in dry-run, so a rehearsal is faithful to the live path).
 */
export interface PublishArgs {
  post: Post;
  content: Content;
  account: ConnectedAccount;
  accessToken: string | null;
}

export interface PublishResult {
  externalPostId: string;
}

/**
 * A single point-in-time reading of a live post's performance, as returned
 * by an adapter's fetchMetrics. `revenue` is in major currency units (THB),
 * 2 decimal places — the platform's monetization payout for this post, NOT
 * a computed/estimated figure (see makedown.md §6). `reach` and
 * `engagement` are cumulative counts as of `fetchMetrics` time.
 */
export interface MetricSnapshot {
  reach: number;
  engagement: number;
  revenue: number;
}

/**
 * Everything an adapter needs to read one post's metrics. Like PublishArgs,
 * the decrypted token travels separately and `accessToken: null` means the
 * caller could not obtain one — adapters reject that with PublisherTokenError
 * even in mock mode, so a rehearsal is faithful to the live path.
 */
export interface FetchMetricsArgs {
  post: Post;
  account: ConnectedAccount;
  accessToken: string | null;
}

/**
 * Contract every platform adapter implements. Pass B ships publish() for
 * Facebook and YouTube; Phase 3 fills in fetchMetrics (earnings/reach
 * ingestion). fetchComments/replyComment stay typed stubs that throw
 * PlatformCapabilityNotImplementedError until Phase 4. Adapters honor the
 * PUBLISHER_IMPL_* env flags: in `mock` mode (the mandatory default outside
 * production) publish() and fetchMetrics() perform no network I/O — publish
 * returns a deterministic dry-run id, fetchMetrics returns a deterministic
 * synthetic snapshot derived from the post.
 */
export interface PlatformAdapter {
  readonly platform: AssetPlatform;
  publish(args: PublishArgs): Promise<PublishResult>;
  fetchMetrics(args: FetchMetricsArgs): Promise<MetricSnapshot>;
  fetchComments(post: Post): Promise<never>;
  replyComment(post: Post, externalCommentId: string, message: string): Promise<never>;
}

/** Prefix for dry-run external ids so they can never be mistaken for real platform ids. */
export const DRY_RUN_EXTERNAL_ID_PREFIX = 'dry-run';

export function buildDryRunExternalId(platform: AssetPlatform, postId: string): string {
  return `${DRY_RUN_EXTERNAL_ID_PREFIX}-${platform}-${postId}`;
}

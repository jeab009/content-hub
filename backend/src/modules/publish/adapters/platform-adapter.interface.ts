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
 * Everything an adapter needs to read one post's comments. Like
 * FetchMetricsArgs, the decrypted token travels separately and
 * `accessToken: null` means the caller could not obtain one — adapters reject
 * that with PublisherTokenError even in mock mode, so a rehearsal is faithful
 * to the live path. `sincePageToken` supports incremental fetch where the
 * platform API allows it (risk R4); the mock ignores it.
 */
export interface FetchCommentsArgs {
  post: Post;
  account: ConnectedAccount;
  accessToken: string | null;
  sincePageToken?: string;
}

/**
 * One platform-native comment as returned by an adapter. `externalCommentId`
 * is the stable, platform-native id and the dedup-key half — it MUST be
 * non-null and non-empty (System Analyst condition C3: the partial unique
 * index gives zero protection for a null key, so a null would silently
 * re-insert on every sync). `author` and `text` are PII and must be redacted
 * before any log line (redact-comment-meta.util). `replyable` captures the
 * per-comment reply capability (risk R3).
 */
export interface CommentSnapshot {
  externalCommentId: string;
  author: string;
  authorExternalId: string | null;
  text: string;
  createdAt: Date;
  replyable: boolean;
}

/**
 * Everything an adapter needs to post one reply. `accessToken: null` is
 * rejected with PublisherTokenError even in mock mode, faithful to live.
 */
export interface ReplyCommentArgs {
  post: Post;
  account: ConnectedAccount;
  accessToken: string | null;
  externalCommentId: string;
  message: string;
}

export interface CommentReplyResult {
  replyExternalId: string;
}

/**
 * Contract every platform adapter implements. Pass B ships publish() for
 * Facebook and YouTube; Phase 3 filled in fetchMetrics (earnings/reach
 * ingestion); Phase 4 fills in fetchComments/replyComment (comment
 * aggregation + reply). Adapters honor the PUBLISHER_IMPL_* env flags: in
 * `mock` mode (the mandatory default outside production) every method performs
 * no network I/O — publish returns a deterministic dry-run id, fetchMetrics a
 * synthetic snapshot, fetchComments a deterministic synthetic thread, and
 * replyComment a deterministic dry-run reply id. TikTok/LINE OA have no
 * adapter yet (Phase 5) — the PlatformAdapterRegistry rejects them, so those
 * platforms remain unimplemented for every capability.
 */
export interface PlatformAdapter {
  readonly platform: AssetPlatform;
  publish(args: PublishArgs): Promise<PublishResult>;
  fetchMetrics(args: FetchMetricsArgs): Promise<MetricSnapshot>;
  fetchComments(args: FetchCommentsArgs): Promise<CommentSnapshot[]>;
  replyComment(args: ReplyCommentArgs): Promise<CommentReplyResult>;
}

/** Prefix for dry-run external ids so they can never be mistaken for real platform ids. */
export const DRY_RUN_EXTERNAL_ID_PREFIX = 'dry-run';

export function buildDryRunExternalId(platform: AssetPlatform, postId: string): string {
  return `${DRY_RUN_EXTERNAL_ID_PREFIX}-${platform}-${postId}`;
}

/** Deterministic dry-run reply id — never mistakable for a real platform id. */
export function buildDryRunReplyId(platform: AssetPlatform, externalCommentId: string): string {
  return `${DRY_RUN_EXTERNAL_ID_PREFIX}-reply-${platform}-${externalCommentId}`;
}

/** Stable dry-run comment id half of the (platform, externalCommentId) dedup key. */
export function buildMockCommentId(platform: AssetPlatform, postId: string, index: number): string {
  return `mock-${platform}-${postId}-${index}`;
}

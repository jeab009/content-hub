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
 * Contract every platform adapter implements. Pass B ships publish() for
 * Facebook and YouTube; fetchMetrics/fetchComments/replyComment are typed
 * stubs that throw PlatformCapabilityNotImplementedError until Phase 3/4
 * fill them in. Adapters honor the PUBLISHER_IMPL_* env flags: in `mock`
 * mode (the mandatory default outside production) publish() performs no
 * network I/O and returns a deterministic dry-run external id.
 */
export interface PlatformAdapter {
  readonly platform: AssetPlatform;
  publish(args: PublishArgs): Promise<PublishResult>;
  fetchMetrics(post: Post): Promise<never>;
  fetchComments(post: Post): Promise<never>;
  replyComment(post: Post, externalCommentId: string, message: string): Promise<never>;
}

/** Prefix for dry-run external ids so they can never be mistaken for real platform ids. */
export const DRY_RUN_EXTERNAL_ID_PREFIX = 'dry-run';

export function buildDryRunExternalId(platform: AssetPlatform, postId: string): string {
  return `${DRY_RUN_EXTERNAL_ID_PREFIX}-${platform}-${postId}`;
}

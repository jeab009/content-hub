import {
  PublisherAmbiguousError,
  PublisherRejectedError,
  PublisherTokenError,
  PublisherValidationError,
} from '../publish/adapters/publisher.errors';

/**
 * Maps a reply dispatch failure to a STABLE reason CODE (System Analyst
 * condition C7). The raw FB/YT error string can embed the submitted reply
 * `message` (and quoted author), so it must NEVER be audited — only this
 * closed set of codes is. New error shapes fall through to `unknown_error`.
 */
export type ReplyFailureReason =
  | 'token_unavailable'
  | 'validation_failed'
  | 'platform_rejected'
  | 'platform_ambiguous'
  | 'unknown_error';

export function mapReplyFailureReason(error: unknown): ReplyFailureReason {
  if (error instanceof PublisherTokenError) return 'token_unavailable';
  if (error instanceof PublisherValidationError) return 'validation_failed';
  if (error instanceof PublisherRejectedError) return 'platform_rejected';
  if (error instanceof PublisherAmbiguousError) return 'platform_ambiguous';
  return 'unknown_error';
}

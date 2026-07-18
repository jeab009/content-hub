/**
 * Typed error taxonomy for platform adapters. The publish execution flow
 * maps these onto post statuses per docs/publish-orchestration-addendum.md:
 *
 * - Errors raised BEFORE any network dispatch (token missing, validation,
 *   config) → post status `failed` — confirmed nothing went out, safe to
 *   retry.
 * - A clean error RESPONSE from the platform (it answered "no") → also
 *   `failed` — the platform itself confirmed nothing was created.
 * - An exception/timeout AFTER the publish call was dispatched → status
 *   `posted_unconfirmed` — outcome at the platform is unknown; NEVER
 *   auto-retried, a human must resolve.
 *
 * Any error that is not one of these types is treated like
 * PublisherAmbiguousError (fail toward "do not double-post").
 */

/** Base class so `instanceof PublisherError` catches the whole family. */
export abstract class PublisherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Pre-dispatch: no usable access token was provided to the adapter. */
export class PublisherTokenError extends PublisherError {}

/** Pre-dispatch: the post/content cannot be represented on this platform. */
export class PublisherValidationError extends PublisherError {}

/**
 * The platform received the request and answered with an error response —
 * a confirmed "not created", safe to mark failed/retryable.
 */
export class PublisherRejectedError extends PublisherError {}

/**
 * The publish call was dispatched but its outcome is unknown (connection
 * drop, read timeout). Maps to `posted_unconfirmed`; never auto-retried.
 */
export class PublisherAmbiguousError extends PublisherError {}

/** Phase 3/4 capability stubs (metrics, comments) — not built in Pass B. */
export class PlatformCapabilityNotImplementedError extends PublisherError {}

/** True when the error proves the platform did NOT create a post. */
export function isConfirmedNotPosted(error: unknown): boolean {
  return (
    error instanceof PublisherTokenError ||
    error instanceof PublisherValidationError ||
    error instanceof PublisherRejectedError
  );
}

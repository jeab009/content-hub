import type { Comment, ListCommentsQuery } from '@/lib/api-client';

/**
 * Pure decision helpers for the comment inbox + reply composer. Kept free of
 * React/fetch so the branching (filter param building, SLA-breach derivation,
 * reply-enable rules, template insertion) is unit-testable in isolation — the
 * same posture as publish-logic.ts.
 */

/** The reply message hard cap (mirrors backend MAX_REPLY_MESSAGE_LENGTH / C9). */
export const MAX_REPLY_MESSAGE_LENGTH = 2000;

/**
 * Builds the querystring for `GET /api/comments`, emitting ONLY the params the
 * backend ListCommentsQueryDto whitelists (platform, sentiment, priority,
 * slaBreach, replied, page, pageSize). Any other key would 400. Undefined
 * filters are omitted so an empty filter set sends no query at all.
 */
export function buildCommentQuery(query: ListCommentsQuery = {}): string {
  const params = new URLSearchParams();
  if (query.platform) params.set('platform', query.platform);
  if (query.sentiment) params.set('sentiment', query.sentiment);
  if (query.priority) params.set('priority', query.priority);
  if (query.slaBreach !== undefined) params.set('slaBreach', String(query.slaBreach));
  if (query.replied !== undefined) params.set('replied', String(query.replied));
  if (query.page !== undefined) params.set('page', String(query.page));
  if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * True when a comment is past its SLA and still unreplied. The backend already
 * computes `slaBreach` on the response (never stored, so it stays correct as
 * time passes); this mirrors that rule locally so the UI can re-derive it —
 * e.g. against a freshly-clocked `now` — without trusting a stale flag.
 * Spam (no `slaDueAt`) has no clock and can never breach.
 */
export function isSlaBreached(comment: Comment, now: Date = new Date()): boolean {
  if (comment.slaDueAt === null || comment.repliedAt !== null) {
    return false;
  }
  return new Date(comment.slaDueAt).getTime() < now.getTime();
}

/**
 * Whether the reply button may be offered for this comment. The server is
 * authoritative (returns 409 on a non-replyable or already-replied comment),
 * but the UI disables the control to avoid a doomed round-trip (R3 belt-and-
 * suspenders).
 */
export function canReply(comment: Comment): boolean {
  return comment.replyable && comment.repliedAt === null;
}

/**
 * True when the reply confirm button may be enabled: a non-empty message
 * within the length cap, and the step-up password present.
 */
export function canSubmitReply(params: { message: string; password: string }): boolean {
  const message = params.message.trim();
  if (message.length === 0 || message.length > MAX_REPLY_MESSAGE_LENGTH) {
    return false;
  }
  return params.password.trim().length > 0;
}

/** Characters remaining before the reply hits the cap (may go negative). */
export function remainingReplyChars(message: string): number {
  return MAX_REPLY_MESSAGE_LENGTH - message.length;
}

/**
 * Inserts a canned template body into the current message. An empty draft is
 * replaced outright; otherwise the template is appended after a blank line so
 * the admin's existing text is never clobbered.
 */
export function insertTemplate(current: string, templateBody: string): string {
  if (current.trim().length === 0) {
    return templateBody;
  }
  return `${current.trimEnd()}\n\n${templateBody}`;
}

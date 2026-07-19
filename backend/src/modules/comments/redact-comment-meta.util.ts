import { createHash } from 'node:crypto';
import { Comment } from '@prisma/client';

/**
 * Builds audit `meta` for a comment as REFERENCES, not values (System Analyst
 * ADR-P4-5 / condition C1). Raw `author`/`text` are personal data (PDPA) and
 * must never reach a long-lived audit line — this helper emits a stable,
 * non-reversible author reference hash and the text LENGTH (shape, not
 * content). The central redactor (redact.util) is the belt-and-braces second
 * layer: even if a raw field slipped into meta it would be masked, but call
 * sites should always build meta through this helper.
 */
export interface RedactedCommentMeta {
  commentId: string;
  platform: string;
  authorRef: string;
  textLength: number;
  sentiment: string | null;
  priority: string | null;
  // Index signature so this is assignable to the audit meta Record and a
  // failure `reason` code can be spread alongside it.
  [key: string]: unknown;
}

/** First 12 hex chars of a SHA-256 — stable across runs, not reversible. */
function authorRef(comment: Pick<Comment, 'authorExternalId' | 'author'>): string {
  const basis = comment.authorExternalId ?? comment.author;
  return createHash('sha256').update(basis).digest('hex').slice(0, 12);
}

export function redactCommentMeta(
  comment: Pick<
    Comment,
    'id' | 'platform' | 'authorExternalId' | 'author' | 'text' | 'sentiment' | 'priority'
  >,
): RedactedCommentMeta {
  return {
    commentId: comment.id,
    platform: comment.platform,
    authorRef: authorRef(comment),
    textLength: comment.text.length,
    sentiment: comment.sentiment,
    priority: comment.priority,
  };
}

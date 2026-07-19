import type {
  Comment,
  CommentPriority,
  CommentSentiment,
  PostPlatform,
  SentimentSource,
} from '@/lib/api-client';
import { isSlaBreached } from '@/lib/comment-logic';

/**
 * Comment-domain label + badge helpers. Every badge pairs a colour with TEXT
 * (colour alone never conveys state — accessibility rule carried from
 * content-labels CLEARANCE/PACE badges). Platform reuses the Post platform
 * labels since a Comment.platform IS a Prisma `Platform`.
 */

/** Filter dropdown option sets — only the two platforms that produce comments. */
/**
 * All four platforms as of Phase 5: every adapter now implements fetchComments,
 * and comments attach to manually-recorded TikTok/LINE posts too.
 */
export const COMMENT_PLATFORMS: PostPlatform[] = ['facebook', 'youtube', 'tiktok', 'line'];
export const COMMENT_SENTIMENTS: CommentSentiment[] = ['positive', 'negative', 'neutral'];
export const COMMENT_PRIORITIES: CommentPriority[] = ['complaint', 'question', 'spam', 'general'];

const SENTIMENT_LABELS: Record<CommentSentiment, string> = {
  positive: 'Positive',
  negative: 'Negative',
  neutral: 'Neutral',
};

const SENTIMENT_BADGE: Record<CommentSentiment, string> = {
  positive: 'bg-success',
  negative: 'bg-danger',
  neutral: 'bg-secondary',
};

const PRIORITY_LABELS: Record<CommentPriority, string> = {
  complaint: 'Complaint',
  question: 'Question',
  spam: 'Spam',
  general: 'General',
};

const PRIORITY_BADGE: Record<CommentPriority, string> = {
  complaint: 'bg-danger',
  question: 'bg-info text-dark',
  spam: 'bg-secondary',
  general: 'bg-primary',
};

const SENTIMENT_SOURCE_LABELS: Record<SentimentSource, string> = {
  rule_based: 'Rule-based',
  model: 'Model',
};

const UNCLASSIFIED_BADGE = 'bg-light text-dark border';

export interface BadgeSpec {
  label: string;
  className: string;
}

/** Sentiment chip — null (not yet classified) renders a neutral "Unclassified". */
function sentimentBadge(value: CommentSentiment | null): BadgeSpec {
  if (value === null) {
    return { label: 'Unclassified', className: UNCLASSIFIED_BADGE };
  }
  return { label: SENTIMENT_LABELS[value], className: SENTIMENT_BADGE[value] };
}

/** Priority chip — null renders a neutral "Untriaged". */
function priorityBadge(value: CommentPriority | null): BadgeSpec {
  if (value === null) {
    return { label: 'Untriaged', className: UNCLASSIFIED_BADGE };
  }
  return { label: PRIORITY_LABELS[value], className: PRIORITY_BADGE[value] };
}

/**
 * SLA chip. Breach beats every other state (it is the thing the admin must
 * act on), then replied, then "no clock" (spam), then a plain due date.
 */
function slaBadge(comment: Comment, now: Date = new Date()): BadgeSpec {
  if (isSlaBreached(comment, now)) {
    return { label: 'SLA breached', className: 'bg-danger' };
  }
  if (comment.repliedAt !== null) {
    return { label: 'Replied', className: 'bg-success' };
  }
  if (comment.slaDueAt === null) {
    return { label: 'No SLA', className: UNCLASSIFIED_BADGE };
  }
  return {
    label: `Due ${new Date(comment.slaDueAt).toLocaleString()}`,
    className: 'bg-info text-dark',
  };
}

export const commentLabels = {
  sentiment: (value: CommentSentiment | null): string =>
    value === null ? 'Unclassified' : SENTIMENT_LABELS[value],
  sentimentBadge,
  priority: (value: CommentPriority | null): string =>
    value === null ? 'Untriaged' : PRIORITY_LABELS[value],
  priorityBadge,
  sentimentSource: (value: SentimentSource | null): string =>
    value === null ? '—' : SENTIMENT_SOURCE_LABELS[value],
  slaBadge,
};

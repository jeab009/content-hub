import { Comment, CommentPriority, Platform, Sentiment, SentimentSource } from '@prisma/client';

/**
 * Inbox row shape. The authenticated admin IS authorized to read author/text
 * on-screen (ADR-P4-5), so they ARE returned here — the redaction rule is a
 * LOGGING control (audit/exception), not a control on this response.
 * `slaBreach` is computed (never stored) so it stays correct as time passes.
 */
export class CommentResponseDto {
  id!: string;
  postId!: string;
  platform!: Platform;
  author!: string;
  text!: string;
  sentiment!: Sentiment | null;
  sentimentSource!: SentimentSource | null;
  priority!: CommentPriority | null;
  slaDueAt!: Date | null;
  slaBreach!: boolean;
  replyable!: boolean;
  repliedAt!: Date | null;
  replyText!: string | null;
  collectedAt!: Date;

  static fromEntity(comment: Comment, now: Date = new Date()): CommentResponseDto {
    return {
      id: comment.id,
      postId: comment.postId,
      platform: comment.platform,
      author: comment.author,
      text: comment.text,
      sentiment: comment.sentiment,
      sentimentSource: comment.sentimentSource,
      priority: comment.priority,
      slaDueAt: comment.slaDueAt,
      slaBreach:
        comment.slaDueAt !== null &&
        comment.repliedAt === null &&
        comment.slaDueAt.getTime() < now.getTime(),
      replyable: comment.replyable,
      repliedAt: comment.repliedAt,
      replyText: comment.replyText,
      collectedAt: comment.collectedAt,
    };
  }
}

export class PaginatedCommentsDto {
  items!: CommentResponseDto[];
  page!: number;
  pageSize!: number;
  total!: number;
}

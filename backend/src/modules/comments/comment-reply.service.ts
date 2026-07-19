import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Comment } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { ConnectedAccountsService } from '../connected-accounts/connected-accounts.service';
import { PlatformAdapterRegistry } from '../publish/adapters/platform-adapter.registry';
import { StepUpAuthService } from '../publish/step-up-auth.service';
import { toAssetPlatform } from '../../common/utils/platform-map.util';
import { ReplyCommentDto } from './dto/reply-comment.dto';
import { CommentResponseDto } from './dto/comment-response.dto';
import { redactCommentMeta } from './redact-comment-meta.util';
import { mapReplyFailureReason } from './reply-failure-reason.util';

/**
 * Reply flow (capability d) — the one write to the platform, so it carries the
 * FULL publish-grade authority stack: step-up re-auth (C4 typed failure
 * action), the DB-level claim-first idempotency guard (no double-reply), and
 * PII-redacted audit (C1/C7). NEVER automatic — one comment, one explicit
 * admin action, one password.
 */
@Injectable()
export class CommentReplyService {
  private readonly logger = new Logger(CommentReplyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly connectedAccounts: ConnectedAccountsService,
    private readonly adapterRegistry: PlatformAdapterRegistry,
    private readonly stepUpAuth: StepUpAuthService,
  ) {}

  async reply(
    commentId: string,
    dto: ReplyCommentDto,
    userId: string,
    ip?: string,
  ): Promise<CommentResponseDto> {
    // 1. Step-up re-auth — failure audited under the reply-specific action (C4).
    await this.stepUpAuth.assertFreshPassword(userId, dto.password, ip, 'comment_reply_failed');

    // 2. Load the comment.
    const comment = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    // 3. Capability guard — server is authoritative even though the UI disables it (R3).
    if (!comment.replyable) {
      throw new ConflictException('This comment type does not accept replies');
    }
    if (comment.repliedAt) {
      throw new ConflictException('This comment has already been replied to');
    }

    // 4. Idempotency claim — race-proof "claim first" via a conditional update
    //    (analogue of the publish optimistic-concurrency guard). Only the
    //    winner (count === 1) proceeds to dispatch.
    const claimed = await this.prisma.comment.updateMany({
      where: { id: commentId, repliedAt: null },
      data: { repliedAt: new Date(), repliedBy: userId },
    });
    if (claimed.count === 0) {
      throw new ConflictException('This comment has already been replied to');
    }

    try {
      const result = await this.dispatchReply(comment, dto.message, userId);
      this.auditLog.record({
        actor: userId,
        action: 'comment_reply_sent',
        result: 'success',
        ip,
        // References only — never author/text/message (C1/C7).
        meta: redactCommentMeta(comment),
      });
      return CommentResponseDto.fromEntity(result);
    } catch (error) {
      // Roll back the claim so a legitimate retry is possible (mirrors how a
      // failed publish frees its (content, platform) pair).
      await this.prisma.comment.updateMany({
        where: { id: commentId },
        data: { repliedAt: null, repliedBy: null },
      });
      const reason = mapReplyFailureReason(error);
      this.auditLog.record({
        actor: userId,
        action: 'comment_reply_failed',
        result: 'failure',
        ip,
        // MAPPED reason code, never the raw upstream error string (C7).
        meta: { ...redactCommentMeta(comment), reason },
      });
      this.logger.warn(`Reply failed for comment ${comment.id}: ${reason}`);
      throw error;
    }
  }

  /** Resolve account + token, dispatch the reply, and persist the outcome. */
  private async dispatchReply(comment: Comment, message: string, userId: string): Promise<Comment> {
    const post = await this.prisma.post.findUnique({ where: { id: comment.postId } });
    if (!post) {
      throw new NotFoundException('Post for comment not found');
    }
    const account = await this.prisma.connectedAccount.findFirst({
      where: { userId, platform: comment.platform, status: 'connected' },
    });
    if (!account) {
      throw new ConflictException('No connected account for this platform; reconnect required');
    }
    if (!comment.externalCommentId) {
      throw new ConflictException('Comment has no platform id; cannot reply');
    }

    const accessToken = await this.connectedAccounts.getValidToken(account.id, userId);
    const adapter = this.adapterRegistry.getFor(toAssetPlatform(comment.platform));
    const { replyExternalId } = await adapter.replyComment({
      post,
      account,
      accessToken,
      externalCommentId: comment.externalCommentId,
      message,
    });

    return this.prisma.comment.update({
      where: { id: comment.id },
      data: { replyText: message, replyExternalId },
    });
  }
}

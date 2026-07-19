import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { RETENTION_MONTHS } from './comments.constants';
import { redactCommentMeta } from './redact-comment-meta.util';

export interface RetentionPurgeResult {
  deletedCount: number;
  cutoff: Date;
}

/**
 * PDPA storage-limitation controls (capability/exit #7 + condition C2).
 *
 * - `purgeExpired`: bulk hard-delete of comments older than 12 months on
 *   `collectedAt` (the platform timestamp). Audit records COUNTS ONLY — no
 *   author/text. `Comment.post onDelete: Restrict` restricts deleting a Post,
 *   not its comments, so this delete is allowed.
 * - `eraseOne`: single-comment erasure so a data-subject "delete my comment
 *   now" request (PDPA §30/§33) can be honored in-app — the bulk purge alone
 *   does NOT satisfy erasure (C2). Audited by reference (counts/ref only).
 */
@Injectable()
export class CommentRetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async purgeExpired(userId: string, now: Date = new Date()): Promise<RetentionPurgeResult> {
    const cutoff = subtractMonths(now, RETENTION_MONTHS);
    const { count } = await this.prisma.comment.deleteMany({
      where: { collectedAt: { lt: cutoff } },
    });

    this.auditLog.record({
      actor: userId,
      action: 'comment_retention_purged',
      result: 'success',
      meta: { deletedCount: count, cutoff: cutoff.toISOString() },
    });

    return { deletedCount: count, cutoff };
  }

  /** PDPA data-subject erasure — hard-delete one comment on request (C2). */
  async eraseOne(commentId: string, userId: string): Promise<void> {
    const comment = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    await this.prisma.comment.delete({ where: { id: commentId } });

    this.auditLog.record({
      actor: userId,
      action: 'comment_erased',
      result: 'success',
      // Reference only (authorRef hash + textLength) — never raw author/text.
      meta: redactCommentMeta(comment),
    });
  }
}

/** Subtracts whole months, clamping the day so month-end boundaries are safe. */
function subtractMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const targetMonth = result.getMonth() - months;
  result.setMonth(targetMonth);
  return result;
}

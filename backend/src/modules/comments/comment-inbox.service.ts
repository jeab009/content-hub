import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListCommentsQueryDto } from './dto/list-comments-query.dto';
import { CommentResponseDto, PaginatedCommentsDto } from './dto/comment-response.dto';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './comments.constants';

/**
 * Inbox read-model (capability c) — pure aggregation over the append-only
 * comments table, no writes (mirrors DashboardService). Filters combine as
 * ANDed `where` clauses; `slaBreach` is a computed clause (`slaDueAt < now AND
 * repliedAt IS NULL`), never a stored column. `spam` is tag + filter only, no
 * auto-hide (no-auto-action boundary).
 */
@Injectable()
export class CommentInboxService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListCommentsQueryDto, now: Date = new Date()): Promise<PaginatedCommentsDto> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const where = this.buildWhere(query, now);

    const [total, comments] = await Promise.all([
      this.prisma.comment.count({ where }),
      this.prisma.comment.findMany({
        where,
        orderBy: [{ slaDueAt: { sort: 'asc', nulls: 'last' } }, { collectedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: comments.map((comment) => CommentResponseDto.fromEntity(comment, now)),
      page,
      pageSize,
      total,
    };
  }

  private buildWhere(query: ListCommentsQueryDto, now: Date): Prisma.CommentWhereInput {
    const where: Prisma.CommentWhereInput = {};
    if (query.platform) where.platform = query.platform;
    if (query.sentiment) where.sentiment = query.sentiment;
    if (query.priority) where.priority = query.priority;

    if (query.replied === true) where.repliedAt = { not: null };
    if (query.replied === false) where.repliedAt = null;

    if (query.slaBreach === true) {
      // Overdue AND unreplied. Combined with an explicit `replied` filter these
      // simply AND together (a replied comment is never SLA-breached anyway).
      where.slaDueAt = { lt: now };
      where.repliedAt = null;
    }
    return where;
  }
}

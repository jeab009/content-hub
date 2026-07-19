import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { AUDIT_LOG_DEFAULT_PAGE_SIZE, AUDIT_LOG_MAX_PAGE_SIZE } from './audit-log.constants';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';
import { AuditLogResponseDto, PaginatedAuditLogsDto } from './dto/audit-log-response.dto';

/**
 * Read side of the audit trail. Separate from AuditLogService so the WRITE
 * path keeps exactly one public method (`record`) and no query surface — the
 * thing that writes audit rows should not also be the thing that reads them.
 */
@Injectable()
export class AuditLogQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListAuditLogsQueryDto): Promise<PaginatedAuditLogsDto> {
    const page = query.page ?? 1;
    const pageSize = Math.min(
      query.pageSize ?? AUDIT_LOG_DEFAULT_PAGE_SIZE,
      AUDIT_LOG_MAX_PAGE_SIZE,
    );
    const where = this.buildWhere(query);

    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        // Newest first; `id` is the deterministic secondary key so pagination
        // is stable when many rows share a timestamp (a recompute batch can
        // emit several within the same millisecond).
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { items: rows.map(AuditLogResponseDto.fromEntity), page, pageSize, total };
  }

  private buildWhere(query: ListAuditLogsQueryDto): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = {};
    if (query.action) where.action = query.action;
    if (query.actor) where.actor = query.actor;
    if (query.result) where.result = query.result;

    if (query.from || query.to) {
      where.timestamp = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lt: new Date(query.to) } : {}),
      };
    }
    return where;
  }
}

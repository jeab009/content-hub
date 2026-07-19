import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../guards/session-auth.guard';
import { AdminGuard } from '../guards/admin.guard';
import { AuditLogQueryService } from './audit-log-query.service';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';
import { PaginatedAuditLogsDto } from './dto/audit-log-response.dto';

/**
 * Admin-only read over the durable audit trail (Phase 5D.1). Persisting the
 * trail is only half the value — it also has to be reachable without a psql
 * session, or "we have an audit trail" stays a claim rather than a control.
 *
 * Guard stack matches every other admin read: SessionAuthGuard + AdminGuard.
 * No CsrfGuard — this is a GET, and the repo's convention is CSRF on mutations
 * only. Read-only: there is deliberately no write, edit or delete route, since
 * an audit trail an operator can edit is not an audit trail.
 *
 * Nothing is re-redacted on the way out because nothing sensitive was ever
 * written in (see AuditLogResponseDto).
 */
@Controller('api/audit-logs')
@UseGuards(SessionAuthGuard, AdminGuard)
export class AuditLogController {
  constructor(private readonly auditLogQuery: AuditLogQueryService) {}

  /** Paginated, filterable by action / actor / result / date range. */
  @Get()
  list(@Query() query: ListAuditLogsQueryDto): Promise<PaginatedAuditLogsDto> {
    return this.auditLogQuery.list(query);
  }
}

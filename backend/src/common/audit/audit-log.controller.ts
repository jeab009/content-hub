import { Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../guards/session-auth.guard';
import { AdminGuard } from '../guards/admin.guard';
import { CsrfGuard } from '../guards/csrf.guard';
import { AuditLogQueryService } from './audit-log-query.service';
import { AuditRetentionService } from './audit-retention.service';
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
  constructor(
    private readonly auditLogQuery: AuditLogQueryService,
    private readonly auditRetention: AuditRetentionService,
  ) {}

  /** Paginated, filterable by action / actor / result / date range. */
  @Get()
  list(@Query() query: ListAuditLogsQueryDto): Promise<PaginatedAuditLogsDto> {
    return this.auditLogQuery.list(query);
  }

  /**
   * Runs the retention sweep: overwrites attempted login identifiers older than
   * the window. It does NOT delete rows — see AuditRetentionService.
   *
   * A POST (it mutates) so it carries CsrfGuard, but no step-up password: this
   * only ever *removes* personal data, so the blast radius of an accidental run
   * is "PDPA exposure got smaller", and gating a privacy control behind extra
   * friction discourages running it.
   *
   * Manual for now; it belongs on the deferred cron bundle alongside the
   * metrics and comment sweeps.
   */
  @Post('retention/anonymize')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  anonymize(): Promise<{ anonymizedCount: number; cutoff: Date }> {
    return this.auditRetention.anonymizeExpiredActors();
  }
}

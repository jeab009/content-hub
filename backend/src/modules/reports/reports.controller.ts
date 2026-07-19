import { Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { ReportExportService } from './report-export.service';
import { ReportQueryDto } from './dto/report-query.dto';

/**
 * CSV report exports. Admin-only and read-only, so no CsrfGuard — the same
 * convention as DashboardController: CSRF defends state-changing requests, and
 * a GET download initiated from a browser link cannot carry a custom header
 * anyway. Every export still writes an audit row, because "who pulled this
 * data out of the system, and when" is exactly what a download needs on record.
 *
 * PDPA: the comment report is aggregate-only (see ReportExportService), and no
 * audit meta below carries PII — only the report name and the filters used.
 */
@Controller('api/reports')
@UseGuards(SessionAuthGuard, AdminGuard)
export class ReportsController {
  constructor(
    private readonly reports: ReportExportService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get('revenue.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="revenue-report.csv"')
  async revenue(
    @Query() query: ReportQueryDto,
    @CurrentUserId() userId: string,
    @Req() request: Request,
  ): Promise<string> {
    const csv = await this.reports.revenueCsv(query);
    this.audit('revenue', query, userId, request.ip);
    return csv;
  }

  @Get('override-log.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="override-log-report.csv"')
  async overrideLog(
    @Query() query: ReportQueryDto,
    @CurrentUserId() userId: string,
    @Req() request: Request,
  ): Promise<string> {
    const csv = await this.reports.overrideLogCsv(query);
    this.audit('override_log', query, userId, request.ip);
    return csv;
  }

  @Get('comment-summary.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="comment-summary-report.csv"')
  async commentSummary(
    @Query() query: ReportQueryDto,
    @CurrentUserId() userId: string,
    @Req() request: Request,
  ): Promise<string> {
    const csv = await this.reports.commentSummaryCsv(query);
    this.audit('comment_summary', query, userId, request.ip);
    return csv;
  }

  /**
   * Records the export. `filters` are the admin's own query parameters
   * (dates/platform/contentId) — business identifiers, never personal data.
   */
  private audit(
    report: 'revenue' | 'override_log' | 'comment_summary',
    query: ReportQueryDto,
    userId: string,
    ip?: string,
  ): void {
    this.auditLog.record({
      actor: userId,
      action: 'report_exported',
      result: 'success',
      ip,
      meta: {
        report,
        format: 'csv',
        filters: {
          from: query.from ?? null,
          to: query.to ?? null,
          platform: query.platform ?? null,
          contentId: query.contentId ?? null,
        },
      },
    });
  }
}

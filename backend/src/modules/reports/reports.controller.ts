import { Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { ReportExportService } from './report-export.service';
import { ReportQueryDto } from './dto/report-query.dto';
import { CommerceExportService } from '../commerce/commerce-export.service';
import { CommerceReportQueryDto } from '../commerce/dto/commerce-report-query.dto';
import { PaidExportService } from '../paid/paid-export.service';
import { PaidReportQueryDto } from '../paid/dto/paid-report-query.dto';

/**
 * CSV report exports. Admin-only and read-only, so no CsrfGuard — the same
 * convention as DashboardController: CSRF defends state-changing requests, and
 * a GET download initiated from a browser link cannot carry a custom header
 * anyway. Every export still writes an audit row, because "who pulled this
 * data out of the system, and when" is exactly what a download needs on record.
 *
 * PDPA: the comment report is aggregate-only (see ReportExportService), and no
 * audit meta below carries PII — only the report name and the filters used.
 *
 * `commerce.csv` (6A.9) is mounted HERE — a SEPARATE report, never a column
 * on `revenue.csv` — so the export-audit convention and `Content-Disposition`
 * headers stay in one place. This controller is deliberately the ONE file
 * allowed to see both `ReportExportService` and `CommerceExportService`
 * (the ESLint zone bans the whole `modules/commerce` directory from
 * importing `**\/reports/**`, and bans every payout-side file EXCEPT this
 * one from importing commerce) — the price of that exemption is the frozen
 * CSV headers in `src/testing/separation/csv-header-freeze.spec.ts`.
 *
 * `paid.csv` (7A.4) is mounted the same way, via `PaidExportService` — a
 * THIRD separate report, never a column on `revenue.csv` or `commerce.csv`.
 * This controller is now the one file in the codebase permitted to see all
 * three export services; the price is the same frozen-header test, extended.
 */
@Controller('api/reports')
@UseGuards(SessionAuthGuard, AdminGuard)
export class ReportsController {
  constructor(
    private readonly reports: ReportExportService,
    private readonly commerceExport: CommerceExportService,
    private readonly paidExport: PaidExportService,
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

  @Get('commerce.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="commerce-report.csv"')
  async commerce(
    @Query() query: CommerceReportQueryDto,
    @CurrentUserId() userId: string,
    @Req() request: Request,
  ): Promise<string> {
    const csv = await this.commerceExport.commerceCsv(query);
    this.auditLog.record({
      actor: userId,
      action: 'commerce_report_exported',
      result: 'success',
      ip: request.ip,
      meta: {
        report: 'commerce',
        format: 'csv',
        filters: {
          from: query.from ?? null,
          to: query.to ?? null,
          channel: query.channel ?? null,
          productId: query.productId ?? null,
        },
      },
    });
    return csv;
  }

  @Get('paid.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="paid-report.csv"')
  async paid(
    @Query() query: PaidReportQueryDto,
    @CurrentUserId() userId: string,
    @Req() request: Request,
  ): Promise<string> {
    const csv = await this.paidExport.paidCsv(query);
    this.auditLog.record({
      actor: userId,
      action: 'paid_report_exported',
      result: 'success',
      ip: request.ip,
      meta: {
        report: 'paid',
        format: 'csv',
        filters: {
          from: query.from ?? null,
          to: query.to ?? null,
          campaignId: query.campaignId ?? null,
        },
      },
    });
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

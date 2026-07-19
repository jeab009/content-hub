import { Module } from '@nestjs/common';
import { AdminGuard } from '../../common/guards/admin.guard';
import { ReportsController } from './reports.controller';
import { ReportExportService } from './report-export.service';

/**
 * Phase 5A.6 — CSV report exports (revenue drill-down, override log, comment
 * summary). Read-only aggregation over the existing tables via PrismaModule;
 * PDF export is the Phase 5C tail and is deliberately not here.
 */
@Module({
  controllers: [ReportsController],
  providers: [ReportExportService, AdminGuard],
  exports: [ReportExportService],
})
export class ReportsModule {}

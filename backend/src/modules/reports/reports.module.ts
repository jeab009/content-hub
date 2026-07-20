import { Module } from '@nestjs/common';
import { AdminGuard } from '../../common/guards/admin.guard';
import { ReportsController } from './reports.controller';
import { ReportExportService } from './report-export.service';
import { CommerceExportService } from '../commerce/commerce-export.service';

/**
 * Phase 5A.6 — CSV report exports (revenue drill-down, override log, comment
 * summary). Read-only aggregation over the existing tables via PrismaModule;
 * PDF export is the Phase 5C tail and is deliberately not here.
 *
 * Phase 6A.9 adds `CommerceExportService` as its OWN provider here, rather
 * than importing the whole `CommerceModule` — deliberately, not out of
 * laziness: the static boundary scan
 * (`src/testing/separation/commerce-boundary.spec.ts`) bans the literal
 * token `CommerceModule` anywhere under `src/modules/reports`, and
 * `CommerceExportService` needs nothing from that module (only the
 * globally-provided `PrismaService`). Importing `CommerceModule` here would
 * also pull in `ContentModule`/`PublishModule` transitively, which a CSV
 * export module has no business depending on. `ReportsController` is the
 * one file allowed to see both export services (design §3.2 / the
 * frozen-header test is the price of that exemption).
 */
@Module({
  controllers: [ReportsController],
  providers: [ReportExportService, CommerceExportService, AdminGuard],
  exports: [ReportExportService],
})
export class ReportsModule {}

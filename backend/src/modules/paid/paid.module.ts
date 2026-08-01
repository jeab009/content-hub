import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PaidController } from './paid.controller';
import { PaidCampaignService } from './paid-campaign.service';
import { PaidPerformanceService } from './paid-performance.service';
import { PaidReadService } from './paid-read.service';

/**
 * Paid/ads visibility module (design §2.6/§3.1, WBS 7A). Imports
 * `ContentModule` ONLY (for the read-only content-existence lookup used by
 * the campaign form's content picker, via `ContentService.findOne` — never
 * a raw Prisma `include` reaching across the boundary) — no
 * `MetricsModule`, `DashboardModule`, `RankingModule`, `CommerceModule`, or
 * `PublishModule` (System Analyst condition P-B4: `PaidModule`'s import
 * graph must stay exactly `{ContentModule, common/*}`).
 *
 * `PaidExportService` is deliberately NOT exported from here — it is
 * registered directly as its own provider in `ReportsModule`, mirroring
 * exactly how `CommerceExportService` is wired for `commerce.csv` (see
 * `reports.module.ts`'s own docblock for why: importing this whole module
 * into `ReportsModule` would also pull in `ContentModule` transitively,
 * which a CSV export module has no business depending on).
 *
 * No step-up anywhere (System Analyst SA-P3) — this module never imports
 * `PublishModule`, which is what keeps this import graph a clean leaf and
 * avoids Commerce's transitive `PublishModule` coupling (Phase 6 finding
 * §5.2, avoided here per the System Analyst's own verification, §2 Layer 2).
 */
@Module({
  imports: [ContentModule],
  controllers: [PaidController],
  providers: [PaidCampaignService, PaidPerformanceService, PaidReadService, AdminGuard],
})
export class PaidModule {}

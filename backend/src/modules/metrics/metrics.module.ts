import { Module } from '@nestjs/common';
import { AdminGuard } from '../../common/guards/admin.guard';
import { ConnectedAccountsModule } from '../connected-accounts/connected-accounts.module';
import { PublishModule } from '../publish/publish.module';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { MetricIngestionService } from './metric-ingestion.service';

/**
 * Phase 3 metrics ingestion. Reuses PublishModule's PlatformAdapterRegistry
 * (single source of truth for mock/live gating) and ConnectedAccountsService
 * (the only sanctioned token-decryption path).
 */
@Module({
  imports: [ConnectedAccountsModule, PublishModule],
  controllers: [MetricsController],
  providers: [MetricsService, MetricIngestionService, AdminGuard],
  exports: [MetricsService, MetricIngestionService],
})
export class MetricsModule {}

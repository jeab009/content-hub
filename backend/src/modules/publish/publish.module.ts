import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RedisThrottlerStorageModule } from '../../common/throttler/redis-throttler-storage.module';
import { RedisThrottlerStorageService } from '../../common/throttler/redis-throttler-storage.service';
import { ConnectedAccountsModule } from '../connected-accounts/connected-accounts.module';
import { ContentModule } from '../content/content.module';
import { RankingModule } from '../ranking/ranking.module';
import { PUBLISH_QUEUE } from '../queue/queue.constants';
import { PostsController } from './posts.controller';
import { PublishOrchestratorService } from './publish-orchestrator.service';
import { PublishExecutionService } from './publish-execution.service';
import { PostResolutionService } from './post-resolution.service';
import { StepUpAuthService } from './step-up-auth.service';
import { PublishProcessor } from './publish.processor';
import { FacebookAdapter } from './adapters/facebook.adapter';
import { YouTubeAdapter } from './adapters/youtube.adapter';
import { TikTokAdapter } from './adapters/tiktok.adapter';
import { LineAdapter } from './adapters/line.adapter';
import { PlatformAdapterRegistry } from './adapters/platform-adapter.registry';

/**
 * Phase 2 Pass B — manual publish orchestration per
 * docs/publish-orchestration-addendum.md. ThrottlerModule is configured
 * here with the same Redis-backed storage as AuthModule so the
 * password-carrying publish endpoints share login-grade rate limiting
 * (dynamic-module providers are per-importing-module in Nest, hence the
 * repeat registration rather than a cross-module import).
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: PUBLISH_QUEUE }),
    ThrottlerModule.forRootAsync({
      imports: [RedisThrottlerStorageModule],
      useFactory: (storage: RedisThrottlerStorageService) => ({
        throttlers: [{ name: 'default', ttl: 15 * 60 * 1000, limit: 5 }],
        storage,
      }),
      inject: [RedisThrottlerStorageService],
    }),
    ConnectedAccountsModule,
    ContentModule,
    RankingModule,
  ],
  controllers: [PostsController],
  providers: [
    PublishOrchestratorService,
    PublishExecutionService,
    PostResolutionService,
    StepUpAuthService,
    PublishProcessor,
    FacebookAdapter,
    YouTubeAdapter,
    TikTokAdapter,
    LineAdapter,
    PlatformAdapterRegistry,
    AdminGuard,
  ],
  // Phase 3: MetricsModule reuses the same adapters (single source of truth
  // for mock/live gating) to read post metrics, so the registry is exported.
  // Phase 4: CommentsModule reuses the registry (fetchComments/replyComment)
  // AND the StepUpAuthService (reply carries the same publish-grade step-up).
  exports: [PlatformAdapterRegistry, StepUpAuthService],
})
export class PublishModule {}

import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { RedisThrottlerStorageModule } from '../../common/throttler/redis-throttler-storage.module';
import { RedisThrottlerStorageService } from '../../common/throttler/redis-throttler-storage.service';
import { ContentModule } from '../content/content.module';
import { PublishModule } from '../publish/publish.module';
import { AdminGuard } from '../../common/guards/admin.guard';
import { COMMERCE_STEP_UP_LIMIT, COMMERCE_STEP_UP_TTL_MS } from './commerce.constants';
import { CommerceAdapterRegistry } from './adapters/commerce-adapter.registry';
import { MockShopeeAdapter } from './adapters/mock-shopee.adapter';
import { MockTikTokShopAdapter } from './adapters/mock-tiktok-shop.adapter';
import { ShopeeAdapter } from './adapters/shopee.adapter';
import { TikTokShopAdapter } from './adapters/tiktok-shop.adapter';

/**
 * Commerce / affiliate module (6A). The ThrottlerModule registration below
 * shipped empty at the 6.0 gate (see git history) for exactly the reason
 * documented there: throttler config is per-importing-module in this
 * codebase (same repeat registration in `publish.module.ts` and
 * `comments.module.ts`), and the placement endpoint 6A.5 adds carries a
 * password — an unthrottled password-carrying route is a credential oracle.
 *
 * Imports `ContentModule` (for `CopyrightGateService`, already exported) and
 * `PublishModule` (for `StepUpAuthService`, already exported — no edit to
 * `PublishModule` was needed; see phase6-system-analysis.md §5.1).
 *
 * Deliberately NOT imported here: MetricsModule, DashboardModule,
 * RankingModule. The ESLint zones in `.eslintrc.cjs` forbid it in both
 * directions, and the whole phase rests on commerce and payout never sharing
 * a read path.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [RedisThrottlerStorageModule],
      useFactory: (storage: RedisThrottlerStorageService) => ({
        throttlers: [
          { name: 'default', ttl: COMMERCE_STEP_UP_TTL_MS, limit: COMMERCE_STEP_UP_LIMIT },
        ],
        storage,
      }),
      inject: [RedisThrottlerStorageService],
    }),
    ContentModule,
    PublishModule,
  ],
  providers: [
    CommerceAdapterRegistry,
    MockShopeeAdapter,
    MockTikTokShopAdapter,
    ShopeeAdapter,
    TikTokShopAdapter,
    AdminGuard,
  ],
  exports: [CommerceAdapterRegistry],
})
export class CommerceModule {}

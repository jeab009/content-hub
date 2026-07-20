import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { RedisThrottlerStorageModule } from '../../common/throttler/redis-throttler-storage.module';
import { RedisThrottlerStorageService } from '../../common/throttler/redis-throttler-storage.service';
import { COMMERCE_STEP_UP_LIMIT, COMMERCE_STEP_UP_TTL_MS } from './commerce.constants';

/**
 * Phase 6.0 gate — module skeleton only. No controllers, no services, no
 * endpoints: 6.0 lands the schema and the separation proof, and 6A adds the
 * commerce surface.
 *
 * It exists now for one reason: **the ThrottlerModule registration**.
 * Throttler config in this codebase is per-importing-module (see the same
 * repeat registration in `publish.module.ts` and `comments.module.ts` — it is
 * a dynamic module, so its providers do not cross module boundaries). The
 * placement endpoint 6A adds carries a password, and if the module were
 * created later, in the same change as that endpoint, the natural mistake is
 * to assume the throttler is inherited. It is not, and an unthrottled
 * password-carrying route is a credential oracle.
 *
 * Registering it here, empty, means 6A cannot ship that endpoint without a
 * rate limit already in place. QC MAJOR-2 / requirement 7: `commerce.constants`
 * already documented this registration as existing before the file did — the
 * comment is now true.
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
  ],
})
export class CommerceModule {}

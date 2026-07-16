import { Module } from '@nestjs/common';
import { RedisThrottlerStorageService } from './redis-throttler-storage.service';

/**
 * Dedicated module for RedisThrottlerStorageService so it can be provided
 * into ThrottlerModule.forRootAsync's own DI context via `imports`.
 *
 * NestJS resolves `useFactory`/`inject` for a dynamic module (like
 * ThrottlerModule.forRootAsync) against providers visible *to that dynamic
 * module*, not against the providers of whichever module happens to import
 * it. Declaring RedisThrottlerStorageService only in AuthModule's own
 * `providers` array made it invisible to ThrottlerModule's factory,
 * causing a "can't resolve dependencies" crash on startup. Exporting it
 * from this small module and adding this module to ThrottlerModule's
 * `imports` fixes that.
 */
@Module({
  providers: [RedisThrottlerStorageService],
  exports: [RedisThrottlerStorageService],
})
export class RedisThrottlerStorageModule {}

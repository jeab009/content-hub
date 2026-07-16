import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordPolicyService } from './services/password-policy.service';
import { RedisThrottlerStorageService } from '../../common/throttler/redis-throttler-storage.service';
import { RedisThrottlerStorageModule } from '../../common/throttler/redis-throttler-storage.module';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [RedisThrottlerStorageModule],
      useFactory: (storage: RedisThrottlerStorageService) => ({
        throttlers: [{ name: 'default', ttl: 15 * 60 * 1000, limit: 5 }],
        storage,
      }),
      inject: [RedisThrottlerStorageService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordPolicyService],
  exports: [AuthService, PasswordPolicyService],
})
export class AuthModule {}

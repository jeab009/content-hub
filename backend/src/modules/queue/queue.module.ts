import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { ConnectedAccountsModule } from '../connected-accounts/connected-accounts.module';
import { QueueService } from './queue.service';
import { SystemHealthProcessor } from './processors/system-health.processor';
import { TokenRefreshProcessor } from './processors/token-refresh.processor';
import { SYSTEM_HEALTH_QUEUE, TOKEN_REFRESH_QUEUE } from './queue.constants';

export { SYSTEM_HEALTH_QUEUE, TOKEN_REFRESH_QUEUE };

/**
 * BullMQ skeleton (approved architecture). Uses Redis logical DB 0,
 * deliberately separate from the session store (DB 1, configured in
 * main.ts) so a `FLUSHDB` against one never wipes the other.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const appConfig = configService.get<AppConfig>('app');
        if (!appConfig) {
          throw new Error('App config not loaded');
        }
        return {
          connection: {
            host: appConfig.redis.host,
            port: appConfig.redis.port,
            password: appConfig.redis.password,
            db: appConfig.redis.queueDb,
          },
        };
      },
    }),
    BullModule.registerQueue({ name: SYSTEM_HEALTH_QUEUE }, { name: TOKEN_REFRESH_QUEUE }),
    ConnectedAccountsModule,
  ],
  providers: [QueueService, SystemHealthProcessor, TokenRefreshProcessor],
  exports: [QueueService],
})
export class QueueModule {}

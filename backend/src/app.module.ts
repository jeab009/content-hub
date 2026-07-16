import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { PrismaModule } from './modules/prisma/prisma.module';
import { AuditLogModule } from './common/audit/audit-log.module';
import { AuthModule } from './modules/auth/auth.module';
import { ConnectedAccountsModule } from './modules/connected-accounts/connected-accounts.module';
import { QueueModule } from './modules/queue/queue.module';
import { ContentModule } from './modules/content/content.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    PrismaModule,
    AuditLogModule,
    AuthModule,
    ConnectedAccountsModule,
    QueueModule,
    ContentModule,
  ],
})
export class AppModule {}

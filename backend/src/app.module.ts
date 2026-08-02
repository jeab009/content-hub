import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { PrismaModule } from './modules/prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { AuditLogModule } from './common/audit/audit-log.module';
import { AuthModule } from './modules/auth/auth.module';
import { ConnectedAccountsModule } from './modules/connected-accounts/connected-accounts.module';
import { QueueModule } from './modules/queue/queue.module';
import { ContentModule } from './modules/content/content.module';
import { RankingModule } from './modules/ranking/ranking.module';
import { PublishModule } from './modules/publish/publish.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { CommentsModule } from './modules/comments/comments.module';
import { PdpaRetentionModule } from './modules/pdpa-retention/pdpa-retention.module';
import { ReportsModule } from './modules/reports/reports.module';
import { CommerceModule } from './modules/commerce/commerce.module';
import { PaidModule } from './modules/paid/paid.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    PrismaModule,
    HealthModule,
    AuditLogModule,
    AuthModule,
    ConnectedAccountsModule,
    // QueueModule (BullModule.forRootAsync) must load before PublishModule's
    // BullModule.registerQueue picks up the shared connection config.
    QueueModule,
    ContentModule,
    RankingModule,
    PublishModule,
    SchedulerModule,
    MetricsModule,
    DashboardModule,
    CommentsModule,
    // Must come after CommentsModule (needs its exported
    // CommentRetentionService) and after QueueModule (needs the shared
    // BullMQ connection config QueueModule's forRootAsync registers).
    PdpaRetentionModule,
    ReportsModule,
    CommerceModule,
    PaidModule,
  ],
})
export class AppModule {}

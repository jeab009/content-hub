import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RedisThrottlerStorageModule } from '../../common/throttler/redis-throttler-storage.module';
import { RedisThrottlerStorageService } from '../../common/throttler/redis-throttler-storage.service';
import { ConnectedAccountsModule } from '../connected-accounts/connected-accounts.module';
import { PublishModule } from '../publish/publish.module';
import { CommentsController } from './comments.controller';
import { CommentTemplatesController } from './comment-templates.controller';
import { CommentIngestionService } from './comment-ingestion.service';
import { CommentInboxService } from './comment-inbox.service';
import { CommentReplyService } from './comment-reply.service';
import { CommentTriageService } from './comment-triage.service';
import { EscalationService } from './escalation.service';
import { CommentRetentionService } from './comment-retention.service';
import { CommentTemplatesService } from './comment-templates.service';
import { RuleBasedThaiSentimentClassifier } from './sentiment/rule-based-thai-sentiment.classifier';
import { ModelSentimentClassifier } from './sentiment/model-sentiment.classifier';
import { sentimentClassifierProvider } from './sentiment/sentiment-classifier.provider';

/**
 * Phase 4 comment aggregation. Reuses PublishModule's PlatformAdapterRegistry
 * (mock/live gating) + StepUpAuthService (publish-grade reply step-up) and
 * ConnectedAccountsService (the only sanctioned token-decryption path) — the
 * exact import set MetricsModule uses, plus step-up.
 *
 * ThrottlerModule is registered here with the same Redis-backed storage as
 * PublishModule/AuthModule so the password-carrying reply/purge routes and the
 * quota-sensitive sync route share login-grade rate limiting (dynamic-module
 * providers are per-importing-module in Nest, hence the repeat registration).
 */
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
    ConnectedAccountsModule,
    PublishModule,
  ],
  controllers: [CommentsController, CommentTemplatesController],
  providers: [
    CommentIngestionService,
    CommentInboxService,
    CommentReplyService,
    CommentTriageService,
    EscalationService,
    CommentRetentionService,
    CommentTemplatesService,
    RuleBasedThaiSentimentClassifier,
    ModelSentimentClassifier,
    sentimentClassifierProvider,
    AdminGuard,
  ],
  exports: [CommentIngestionService, CommentRetentionService],
})
export class CommentsModule {}

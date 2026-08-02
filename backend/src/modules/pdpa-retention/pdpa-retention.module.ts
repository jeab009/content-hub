import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CommentsModule } from '../comments/comments.module';
import { PdpaRetentionProcessor } from './pdpa-retention.processor';
import { PdpaRetentionSchedulerService } from './pdpa-retention.service';
import { PDPA_RETENTION_QUEUE } from './pdpa-retention.constants';

/**
 * L-2 (pre-production security review) — scheduled PDPA retention sweep.
 * `AuditRetentionService` is not listed here: `AuditLogModule` is `@Global`
 * and exports it, so it's already injectable in `PdpaRetentionProcessor`
 * with no import needed. `CommentsModule` is imported for
 * `CommentRetentionService` (not global) — see pdpa-retention.service.ts's
 * docblock for why this queue registers `BullModule.registerQueue` directly
 * here rather than importing `QueueModule`.
 */
@Module({
  imports: [BullModule.registerQueue({ name: PDPA_RETENTION_QUEUE }), CommentsModule],
  providers: [PdpaRetentionSchedulerService, PdpaRetentionProcessor],
})
export class PdpaRetentionModule {}

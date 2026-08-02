import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  PDPA_RETENTION_CRON,
  PDPA_RETENTION_JOB_NAME,
  PDPA_RETENTION_QUEUE,
  PDPA_RETENTION_SCHEDULER_ID,
} from './pdpa-retention.constants';

/**
 * Registers the daily repeatable PDPA retention job, mirroring
 * `QueueService`'s `upsertJobScheduler` pattern exactly (idempotent —
 * replaces any existing scheduler with the same id rather than
 * accumulating duplicate repeatable jobs across restarts/redeploys).
 *
 * Deliberately its own module/service rather than added to `QueueService`:
 * this queue's processor needs `CommentRetentionService`
 * (`CommentsModule`-exported), and `CommentsModule` imports `PublishModule`,
 * which itself calls `BullModule.registerQueue(...)` expecting `QueueModule`'s
 * `BullModule.forRootAsync` connection config to already be registered.
 * Importing `CommentsModule` into `QueueModule` would create exactly that
 * cycle. `PublishModule` already proves the correct pattern: call
 * `BullModule.registerQueue(...)` directly in the module that needs it,
 * without importing `QueueModule` — this module does the same.
 */
@Injectable()
export class PdpaRetentionSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(PdpaRetentionSchedulerService.name);

  constructor(@InjectQueue(PDPA_RETENTION_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      PDPA_RETENTION_SCHEDULER_ID,
      { pattern: PDPA_RETENTION_CRON },
      { name: PDPA_RETENTION_JOB_NAME, data: {} },
    );

    this.logger.log('Registered repeatable job: PDPA retention sweep (daily, 03:15)');
  }
}

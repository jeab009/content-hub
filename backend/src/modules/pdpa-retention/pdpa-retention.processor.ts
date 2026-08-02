import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { CommentRetentionService } from '../comments/comment-retention.service';
import { AuditRetentionService } from '../../common/audit/audit-retention.service';
import { PDPA_RETENTION_QUEUE, PDPA_RETENTION_SYSTEM_ACTOR } from './pdpa-retention.constants';

/**
 * L-2 (pre-production security review): both PDPA retention controls
 * (`CommentRetentionService.purgeExpired` — 12-month comment hard-delete,
 * `AuditRetentionService.anonymizeExpiredActors` — 90-day audit-actor
 * anonymize-in-place) were correctly implemented and already exercised by
 * this repo's own test suite, but neither had a scheduled trigger — an
 * admin had to remember to call the two POST endpoints by hand. This
 * processor calls the exact same service methods the endpoints call, so
 * there is one implementation of each retention rule, not a scheduled copy
 * that could drift from the manual path.
 */
@Processor(PDPA_RETENTION_QUEUE)
export class PdpaRetentionProcessor extends WorkerHost {
  private readonly logger = new Logger(PdpaRetentionProcessor.name);

  constructor(
    private readonly commentRetention: CommentRetentionService,
    private readonly auditRetention: AuditRetentionService,
  ) {
    super();
  }

  async process(job: Job): Promise<{ commentsDeleted: number; auditActorsAnonymized: number }> {
    const commentResult = await this.commentRetention.purgeExpired(PDPA_RETENTION_SYSTEM_ACTOR);
    const auditResult = await this.auditRetention.anonymizeExpiredActors();

    this.logger.log(
      `PDPA retention sweep (job ${job.id}): purged ${commentResult.deletedCount} expired ` +
        `comment(s), anonymized ${auditResult.anonymizedCount} expired audit actor(s)`,
    );

    return {
      commentsDeleted: commentResult.deletedCount,
      auditActorsAnonymized: auditResult.anonymizedCount,
    };
  }
}

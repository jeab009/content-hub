import { Job } from 'bullmq';
import { PdpaRetentionProcessor } from './pdpa-retention.processor';
import { CommentRetentionService } from '../comments/comment-retention.service';
import { AuditRetentionService } from '../../common/audit/audit-retention.service';
import { PDPA_RETENTION_SYSTEM_ACTOR } from './pdpa-retention.constants';

function buildJob(): Job {
  return { id: 'job-1' } as Job;
}

describe('PdpaRetentionProcessor', () => {
  let commentRetention: { purgeExpired: jest.Mock };
  let auditRetention: { anonymizeExpiredActors: jest.Mock };
  let processor: PdpaRetentionProcessor;

  beforeEach(() => {
    commentRetention = {
      purgeExpired: jest.fn().mockResolvedValue({ deletedCount: 3, cutoff: new Date() }),
    };
    auditRetention = {
      anonymizeExpiredActors: jest
        .fn()
        .mockResolvedValue({ anonymizedCount: 2, cutoff: new Date() }),
    };
    processor = new PdpaRetentionProcessor(
      commentRetention as unknown as CommentRetentionService,
      auditRetention as unknown as AuditRetentionService,
    );
  });

  it('runs both retention sweeps and reports their combined counts', async () => {
    const result = await processor.process(buildJob());

    expect(result).toEqual({ commentsDeleted: 3, auditActorsAnonymized: 2 });
  });

  it('calls comment purge with the system actor, not an admin user id — there is no session behind a cron job', async () => {
    await processor.process(buildJob());

    expect(commentRetention.purgeExpired).toHaveBeenCalledWith(PDPA_RETENTION_SYSTEM_ACTOR);
  });

  it('calls the exact same service methods the manual endpoints call — one implementation, not a scheduled copy', async () => {
    await processor.process(buildJob());

    expect(commentRetention.purgeExpired).toHaveBeenCalledTimes(1);
    expect(auditRetention.anonymizeExpiredActors).toHaveBeenCalledTimes(1);
  });

  it('runs both sweeps even when nothing is expired (zero counts, not skipped)', async () => {
    commentRetention.purgeExpired.mockResolvedValue({ deletedCount: 0, cutoff: new Date() });
    auditRetention.anonymizeExpiredActors.mockResolvedValue({
      anonymizedCount: 0,
      cutoff: new Date(),
    });

    const result = await processor.process(buildJob());

    expect(result).toEqual({ commentsDeleted: 0, auditActorsAnonymized: 0 });
  });
});

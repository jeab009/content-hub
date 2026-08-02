import { Queue } from 'bullmq';
import { PdpaRetentionSchedulerService } from './pdpa-retention.service';
import {
  PDPA_RETENTION_CRON,
  PDPA_RETENTION_JOB_NAME,
  PDPA_RETENTION_SCHEDULER_ID,
} from './pdpa-retention.constants';

describe('PdpaRetentionSchedulerService', () => {
  it('registers exactly one repeatable job, by a stable scheduler id, on the daily cron pattern', async () => {
    const queue = { upsertJobScheduler: jest.fn().mockResolvedValue(undefined) };
    const service = new PdpaRetentionSchedulerService(queue as unknown as Queue);

    await service.onModuleInit();

    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      PDPA_RETENTION_SCHEDULER_ID,
      { pattern: PDPA_RETENTION_CRON },
      { name: PDPA_RETENTION_JOB_NAME, data: {} },
    );
  });
});

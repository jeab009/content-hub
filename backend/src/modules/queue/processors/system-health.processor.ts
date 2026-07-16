import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SYSTEM_HEALTH_QUEUE } from '../queue.constants';

/**
 * No-op ping job, run every 5 minutes. Its only purpose in Phase 1 is to
 * prove the BullMQ + Redis wiring is alive end-to-end (worker connects,
 * picks up a scheduled job, completes it) — a real health-check payload
 * (DB connectivity, disk space, etc.) is a Phase 2+ concern.
 */
@Processor(SYSTEM_HEALTH_QUEUE)
export class SystemHealthProcessor extends WorkerHost {
  private readonly logger = new Logger(SystemHealthProcessor.name);

  async process(job: Job): Promise<{ ok: true; checkedAt: string }> {
    this.logger.log(`system-health ping (job ${job.id})`);
    return { ok: true, checkedAt: new Date().toISOString() };
  }
}

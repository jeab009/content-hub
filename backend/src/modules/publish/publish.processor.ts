import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PUBLISH_QUEUE } from '../queue/queue.constants';
import { PublishExecutionService, ExecutionOutcome } from './publish-execution.service';
import { PublishJobData } from './publish-orchestrator.service';

/**
 * Thin BullMQ shell around PublishExecutionService (which holds all the
 * logic and the unit tests). Even if BullMQ redelivers a job, the
 * conditional claim inside execute() guarantees at most one dispatch per
 * post version — a redelivered job simply loses the claim and exits.
 */
@Processor(PUBLISH_QUEUE)
export class PublishProcessor extends WorkerHost {
  private readonly logger = new Logger(PublishProcessor.name);

  constructor(private readonly publishExecution: PublishExecutionService) {
    super();
  }

  async process(job: Job<PublishJobData>): Promise<{ outcome: ExecutionOutcome }> {
    const outcome = await this.publishExecution.execute(job.data);
    this.logger.log(`Publish job ${job.id} (post ${job.data.postId}) → ${outcome}`);
    return { outcome };
  }
}

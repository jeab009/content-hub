import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SYSTEM_HEALTH_QUEUE, TOKEN_REFRESH_QUEUE } from './queue.constants';

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const DAILY_CRON = '0 3 * * *'; // 03:00 server time — low-traffic window for the refresh sweep.

const SYSTEM_HEALTH_JOB_NAME = 'ping';
const TOKEN_REFRESH_JOB_NAME = 'sweep-expiring-tokens';

/**
 * Registers the two repeatable jobs required by the approved architecture:
 * a 5-minute no-op health ping, and a daily connected-account token-refresh
 * sweep. Idempotent — `upsertJobScheduler` replaces any existing scheduler
 * with the same id rather than accumulating duplicate repeatable jobs across
 * restarts/redeploys (a classic BullMQ footgun).
 */
@Injectable()
export class QueueService implements OnModuleInit {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue(SYSTEM_HEALTH_QUEUE) private readonly systemHealthQueue: Queue,
    @InjectQueue(TOKEN_REFRESH_QUEUE) private readonly tokenRefreshQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.systemHealthQueue.upsertJobScheduler(
      'system-health-ping',
      { every: FIVE_MINUTES_MS },
      { name: SYSTEM_HEALTH_JOB_NAME, data: {} },
    );

    await this.tokenRefreshQueue.upsertJobScheduler(
      'connected-accounts-daily-refresh',
      { pattern: DAILY_CRON },
      { name: TOKEN_REFRESH_JOB_NAME, data: {} },
    );

    this.logger.log(
      'Registered repeatable jobs: system-health ping (5min), token-refresh sweep (daily)',
    );
  }
}

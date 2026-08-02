import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../prisma/prisma.service';

export type HealthCheckStatus = 'ok' | 'error';

export interface HealthCheckResult {
  status: HealthCheckStatus;
  checks: {
    database: HealthCheckStatus;
    redis: HealthCheckStatus;
  };
  timestamp: string;
}

const CHECK_TIMEOUT_MS = 2000;

/**
 * DEVOPS-3 / L-1 (pre-production security review): a TCP-connect check only
 * confirms the process is listening, not that it can actually serve a
 * request — this is the difference between "up" and "healthy". Checks both
 * dependencies this app cannot function without: Postgres (via the same
 * `PrismaService` every request uses) and Redis (via a dedicated client, so
 * a health-check ping never contends with real session/queue traffic and a
 * real outage on one Redis logical DB is never masked by a lucky connection
 * to another).
 */
@Injectable()
export class HealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HealthService.name);
  private redisClient!: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const appConfig = this.configService.get<AppConfig>('app');
    if (!appConfig) {
      throw new Error('App config not loaded');
    }
    this.redisClient = new Redis({
      host: appConfig.redis.host,
      port: appConfig.redis.port,
      password: appConfig.redis.password,
      // Bounds every command (including PING) so a hung/unreachable Redis
      // fails this check quickly rather than leaving the health endpoint
      // hanging — a health check that can hang indefinitely is worse than
      // one with no dependency check at all.
      commandTimeout: CHECK_TIMEOUT_MS,
      maxRetriesPerRequest: 1,
    });
    this.redisClient.on('error', (error) => {
      // ioredis emits 'error' on every failed background reconnect attempt;
      // without a listener that would crash the process. Logged, not
      // rethrown — checkRedis() below reports the actual per-request state.
      this.logger.warn(`Health-check Redis client error: ${error.message}`);
    });
  }

  onModuleDestroy(): void {
    this.redisClient?.disconnect();
  }

  async check(): Promise<HealthCheckResult> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    return {
      status: database === 'ok' && redis === 'ok' ? 'ok' : 'error',
      checks: { database, redis },
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDatabase(): Promise<HealthCheckStatus> {
    try {
      await this.withTimeout(this.prisma.$queryRaw`SELECT 1`, CHECK_TIMEOUT_MS);
      return 'ok';
    } catch (error) {
      this.logger.error(
        `Database health check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 'error';
    }
  }

  private async checkRedis(): Promise<HealthCheckStatus> {
    try {
      const pong = await this.redisClient.ping();
      return pong === 'PONG' ? 'ok' : 'error';
    } catch (error) {
      this.logger.error(
        `Redis health check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 'error';
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms),
      ),
    ]);
  }
}

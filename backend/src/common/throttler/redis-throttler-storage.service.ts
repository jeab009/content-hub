import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import Redis from 'ioredis';
import { AppConfig } from '../../config/configuration';

/**
 * Redis-backed ThrottlerStorage (approved architecture: "Rate limiting via
 * NestJS ThrottlerModule (Redis-backed)"). The bundled in-memory storage
 * would reset on every process restart/redeploy and wouldn't be shared
 * across horizontally-scaled instances, defeating the point of a login
 * rate limit. Uses the same Redis instance as sessions/queue but a
 * dedicated key prefix; does not require a separate logical DB.
 */
@Injectable()
export class RedisThrottlerStorageService implements ThrottlerStorage, OnModuleDestroy {
  private readonly client: Redis;
  private static readonly KEY_PREFIX = 'throttle:';

  constructor(configService: ConfigService) {
    const appConfig = configService.get<AppConfig>('app');
    if (!appConfig) {
      throw new Error('App config not loaded');
    }
    this.client = new Redis({
      host: appConfig.redis.host,
      port: appConfig.redis.port,
      password: appConfig.redis.password,
      db: appConfig.redis.sessionDb,
    });
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitKey = `${RedisThrottlerStorageService.KEY_PREFIX}${throttlerName}:${key}`;
    const blockKey = `${hitKey}:blocked`;

    const blockedTtlMs = await this.client.pttl(blockKey);
    if (blockedTtlMs > 0) {
      return {
        totalHits: limit + 1,
        timeToExpire: Math.ceil(blockedTtlMs / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockedTtlMs / 1000),
      };
    }

    const totalHits = await this.client.incr(hitKey);
    if (totalHits === 1) {
      await this.client.pexpire(hitKey, ttl);
    }
    const remainingTtlMs = await this.client.pttl(hitKey);

    const isBlocked = totalHits > limit;
    if (isBlocked && blockDuration > 0) {
      await this.client.set(blockKey, '1', 'PX', blockDuration);
    }

    return {
      totalHits,
      timeToExpire: Math.ceil((remainingTtlMs > 0 ? remainingTtlMs : ttl) / 1000),
      isBlocked,
      timeToBlockExpire: isBlocked ? Math.ceil(blockDuration / 1000) : 0,
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}

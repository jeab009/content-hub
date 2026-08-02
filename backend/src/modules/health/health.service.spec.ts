import { ConfigService } from '@nestjs/config';
import { HealthService } from './health.service';
import { PrismaService } from '../prisma/prisma.service';

const REDIS_APP_CONFIG = {
  redis: { host: 'localhost', port: 6379, password: undefined },
};

describe('HealthService', () => {
  let prisma: { $queryRaw: jest.Mock };
  let configService: { get: jest.Mock };
  let service: HealthService;

  beforeEach(() => {
    prisma = { $queryRaw: jest.fn() };
    configService = { get: jest.fn().mockReturnValue(REDIS_APP_CONFIG) };
    service = new HealthService(
      prisma as unknown as PrismaService,
      configService as unknown as ConfigService,
    );
    // Deliberately do NOT call the real onModuleInit() — it constructs a
    // real ioredis client that attempts a live network connection. Set the
    // stub directly instead, so these tests exercise HealthService's own
    // ok/error mapping and Promise.all shape, not a live network dependency.
    (
      service as unknown as { redisClient: { ping: jest.Mock; disconnect: jest.Mock } }
    ).redisClient = { ping: jest.fn(), disconnect: jest.fn() };
  });

  function stubRedisPing(result: 'PONG' | Error): void {
    const redisClient = (service as unknown as { redisClient: { ping: jest.Mock } }).redisClient;
    if (result instanceof Error) {
      redisClient.ping.mockRejectedValue(result);
    } else {
      redisClient.ping.mockResolvedValue(result);
    }
  }

  it('reports ok when both database and redis are reachable', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    stubRedisPing('PONG');

    const result = await service.check();

    expect(result.status).toBe('ok');
    expect(result.checks).toEqual({ database: 'ok', redis: 'ok' });
    expect(result.timestamp).toEqual(expect.any(String));
  });

  it('reports error (not a thrown exception) when the database is unreachable', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    stubRedisPing('PONG');

    const result = await service.check();

    expect(result.status).toBe('error');
    expect(result.checks).toEqual({ database: 'error', redis: 'ok' });
  });

  it('reports error when redis is unreachable, independently of the database check', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    stubRedisPing(new Error('ECONNREFUSED'));

    const result = await service.check();

    expect(result.status).toBe('error');
    expect(result.checks).toEqual({ database: 'ok', redis: 'error' });
  });

  it('reports error when both dependencies are unreachable', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    stubRedisPing(new Error('ECONNREFUSED'));

    const result = await service.check();

    expect(result.status).toBe('error');
    expect(result.checks).toEqual({ database: 'error', redis: 'error' });
  });
});

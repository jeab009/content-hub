import { HttpStatus } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let health: { check: jest.Mock };
  let controller: HealthController;
  let response: { status: jest.Mock };

  beforeEach(() => {
    health = { check: jest.fn() };
    controller = new HealthController(health as unknown as HealthService);
    response = { status: jest.fn().mockReturnThis() };
  });

  it('responds 200 when the health check reports ok', async () => {
    const result = {
      status: 'ok' as const,
      checks: { database: 'ok' as const, redis: 'ok' as const },
      timestamp: '2026-08-02T00:00:00.000Z',
    };
    health.check.mockResolvedValue(result);

    const body = await controller.check(response as never);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(body).toEqual(result);
  });

  it('responds 503, WITH the full checks detail in the body, when unhealthy', async () => {
    const result = {
      status: 'error' as const,
      checks: { database: 'error' as const, redis: 'ok' as const },
      timestamp: '2026-08-02T00:00:00.000Z',
    };
    health.check.mockResolvedValue(result);

    const body = await controller.check(response as never);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    // The whole point of setting status via the Response object rather than
    // throwing: the RedactingExceptionFilter would have collapsed this to a
    // bare `message` string and dropped which check actually failed.
    expect(body).toEqual(result);
  });
});

import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { HealthCheckResult, HealthService } from './health.service';

/**
 * Deliberately unauthenticated — a load balancer / orchestrator health
 * check has no session, and this endpoint reveals nothing beyond "database
 * reachable: yes/no, redis reachable: yes/no" (SA-4-style: no PII, no
 * internal error detail — see HealthService, which logs the real error
 * message server-side but returns only ok/error to the client).
 *
 * The response body is set directly via the Response object rather than by
 * returning/throwing, because the global RedactingExceptionFilter rewrites
 * every HttpException's body down to a single `message` string — throwing a
 * ServiceUnavailableException here would have silently dropped the
 * per-check `checks` detail this endpoint exists to provide.
 */
@Controller('api/health')
@Public()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async check(@Res({ passthrough: true }) response: Response): Promise<HealthCheckResult> {
    const result = await this.health.check();
    response.status(result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}

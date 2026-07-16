import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { redactSensitive } from '../utils/redact.util';

/**
 * Global exception filter. Security decision #4: NestJS's default exception
 * handling serializes the raw exception object (and, for unhandled errors,
 * the full stack) into logs — that path bypasses the request/response
 * logging interceptor entirely and can leak a token embedded in an error
 * (e.g. a Meta API error payload echoing back part of the request). This
 * filter redacts before logging AND before it ever reaches the client.
 */
@Catch()
export class RedactingExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const clientMessage =
      exception instanceof HttpException ? exception.getResponse() : 'Internal server error';

    this.logger.error(
      JSON.stringify({
        method: request.method,
        path: request.url,
        status,
        error: redactSensitive(exception),
      }),
    );

    response.status(status).json({
      success: false,
      statusCode: status,
      message:
        typeof clientMessage === 'string'
          ? clientMessage
          : ((clientMessage as Record<string, unknown>).message ?? 'Error'),
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}

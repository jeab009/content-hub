import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { redactSensitive } from '../utils/redact.util';

/**
 * Logs every request/response pair with sensitive fields redacted
 * (security decision #4, normal-path half — the exception-path half is
 * RedactingExceptionFilter). Applied globally in main.ts.
 */
@Injectable()
export class RedactingLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, originalUrl } = request;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.log(
            JSON.stringify({
              method,
              path: originalUrl,
              durationMs: Date.now() - start,
              query: redactSensitive(request.query),
              body: redactSensitive(request.body),
            }),
          );
        },
        error: () => {
          // Error responses are logged by RedactingExceptionFilter; avoid
          // double-logging here.
        },
      }),
    );
  }
}

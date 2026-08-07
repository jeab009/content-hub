import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import session from 'express-session';
import RedisStore from 'connect-redis';
import Redis from 'ioredis';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';
import { assertAdapterFlagsAreSafe } from './config/assert-adapter-flags-safe';
import { RedactingExceptionFilter } from './common/filters/redacting-exception.filter';
import { RedactingLoggingInterceptor } from './common/interceptors/redacting-logging.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const appConfig = configService.get<AppConfig>('app');
  if (!appConfig) {
    throw new Error('App config not loaded');
  }

  // Trust exactly one hop: SETUP-CHECKLIST.md §5.1 requires a TLS-terminating
  // reverse proxy in front of this backend in every real deployment, so
  // every request this process sees arrives over plain HTTP even when the
  // browser used HTTPS. Without this, Express's req.secure is always false,
  // and express-session's `cookie.secure: true` (enabled below whenever
  // NODE_ENV=production) silently refuses to ever set the session cookie —
  // login succeeds server-side (audit log, Redis session write) but the
  // browser never receives it, so every subsequent request looks
  // unauthenticated. `1` (not `true`) trusts only the immediate proxy's
  // X-Forwarded-* headers, not an arbitrary chain — correct for the
  // single-reverse-proxy topology this app is deployed behind.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Dedicated Redis connection for sessions, logical DB 1 — kept separate
  // from BullMQ's DB 0 (approved architecture) so a queue-side FLUSHDB never
  // logs everyone out, and vice versa.
  const sessionRedisClient = new Redis({
    host: appConfig.redis.host,
    port: appConfig.redis.port,
    password: appConfig.redis.password,
    db: appConfig.redis.sessionDb,
  });

  app.use(
    helmet({
      // This API is deliberately cross-origin from its frontend (separate
      // ports/origins in every environment, session cookie carried via CORS
      // credentials — see corsOrigin below). Helmet's default
      // Cross-Origin-Resource-Policy is 'same-origin', which would make
      // browsers block the frontend's own fetch() calls before they reach
      // this server's CORS headers.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    session({
      store: new RedisStore({ client: sessionRedisClient, prefix: 'sess:' }),
      secret: appConfig.session.secret,
      name: appConfig.session.cookieName,
      resave: false,
      saveUninitialized: false,
      rolling: true, // sliding TTL: every response refreshes the expiry
      cookie: {
        httpOnly: true,
        // Secure requires HTTPS; only enforced in production so local HTTP
        // dev isn't silently broken. Deploy behind TLS in every real
        // environment — see README "Running in production".
        secure: appConfig.nodeEnv === 'production',
        sameSite: 'lax',
        maxAge: appConfig.session.ttlMs,
      },
    }),
  );

  app.enableCors({
    origin: appConfig.corsOrigin.split(',').map((origin) => origin.trim()),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new RedactingExceptionFilter());
  app.useGlobalInterceptors(new RedactingLoggingInterceptor());

  assertAdapterFlagsAreSafe(appConfig);

  await app.listen(appConfig.port);
  // eslint-disable-next-line no-console
  console.log(`Content Hub backend listening on port ${appConfig.port}`);
}

bootstrap();

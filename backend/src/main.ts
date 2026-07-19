import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import session from 'express-session';
import RedisStore from 'connect-redis';
import Redis from 'ioredis';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';
import { RedactingExceptionFilter } from './common/filters/redacting-exception.filter';
import { RedactingLoggingInterceptor } from './common/interceptors/redacting-logging.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const appConfig = configService.get<AppConfig>('app');
  if (!appConfig) {
    throw new Error('App config not loaded');
  }

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

  assertPublisherFlagsAreSafe(appConfig);

  await app.listen(appConfig.port);
  // eslint-disable-next-line no-console
  console.log(`Content Hub backend listening on port ${appConfig.port}`);
}

/**
 * PublisherModule security condition #4: every PUBLISHER_IMPL_* flag
 * (FACEBOOK / YOUTUBE / TIKTOK / LINE) MUST default to "mock". This is a
 * defense-in-depth check on top of the Joi default/enum validation in
 * env.validation.ts — it specifically guards against a non-production
 * environment (local dev, CI, a demo box) being accidentally pointed at a
 * real platform adapter, which would make real API calls / real posts from
 * a non-production run. Refuses to boot in that case rather than merely
 * warning, because a silently-live publisher in a demo environment is
 * exactly the kind of mistake this assertion exists to catch before it
 * posts something.
 */
function assertPublisherFlagsAreSafe(appConfig: AppConfig): void {
  const nonMockFlags = [
    appConfig.publisher.facebookImpl !== 'mock' ? 'PUBLISHER_IMPL_FACEBOOK' : null,
    appConfig.publisher.youtubeImpl !== 'mock' ? 'PUBLISHER_IMPL_YOUTUBE' : null,
    appConfig.publisher.tiktokImpl !== 'mock' ? 'PUBLISHER_IMPL_TIKTOK' : null,
    appConfig.publisher.lineImpl !== 'mock' ? 'PUBLISHER_IMPL_LINE' : null,
  ].filter((flag): flag is string => flag !== null);

  if (nonMockFlags.length === 0) {
    return;
  }

  if (appConfig.nodeEnv !== 'production') {
    throw new Error(
      `Refusing to boot: ${nonMockFlags.join(', ')} resolved to a real publisher implementation ` +
        `while NODE_ENV="${appConfig.nodeEnv}" (not "production"). Real platform adapters must only ` +
        'run in production. Set the flag(s) back to "mock" for local/dev/CI use.',
    );
  }

  // eslint-disable-next-line no-console
  console.warn(
    `WARNING: ${nonMockFlags.join(', ')} resolved to a real publisher implementation in production. ` +
      'Confirm this is intentional — real posts will be made to the live platform.',
  );
}

bootstrap();

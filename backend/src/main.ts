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

  await app.listen(appConfig.port);
  // eslint-disable-next-line no-console
  console.log(`Content Hub backend listening on port ${appConfig.port}`);
}

bootstrap();

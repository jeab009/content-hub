import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * No module imports needed: `PrismaModule` and `ConfigModule` are both
 * `@Global()`, and this module deliberately reaches nothing else — a health
 * endpoint that depended on business modules would defeat its own purpose
 * (it must stay up/reportable even if a feature module is misbehaving).
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}

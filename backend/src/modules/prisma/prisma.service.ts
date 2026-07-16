import {
  INestApplication,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Thin wrapper around PrismaClient. All data access in this codebase MUST go
 * through this client's generated, parameterized query builder methods
 * (`findUnique`, `create`, `update`, ...). `$queryRawUnsafe` /
 * `$executeRawUnsafe` are banned repo-wide (security decision #5, enforced
 * by the ESLint rule in .eslintrc.cjs) — do not add them here.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to PostgreSQL via Prisma');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async enableShutdownHooks(app: INestApplication): Promise<void> {
    process.on('beforeExit', () => {
      void app.close();
    });
  }
}

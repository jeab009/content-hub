import { Global, Module } from '@nestjs/common';
import { AdminGuard } from '../guards/admin.guard';
import { AuditLogService } from './audit-log.service';
import { AuditLogQueryService } from './audit-log-query.service';
import { AuditRetentionService } from './audit-retention.service';
import { AuditLogController } from './audit-log.controller';

/**
 * Global so any feature module can inject AuditLogService without every
 * module re-declaring it as an import. PrismaModule is itself @Global, so the
 * audit write path picks up PrismaService with no extra wiring.
 *
 * Only AuditLogService is exported: the query service and controller are the
 * admin read surface (Phase 5D.1) and nothing else should depend on them.
 */
@Global()
@Module({
  controllers: [AuditLogController],
  providers: [AuditLogService, AuditLogQueryService, AuditRetentionService, AdminGuard],
  exports: [AuditLogService],
})
export class AuditLogModule {}

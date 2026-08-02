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
 * AuditLogService and AuditRetentionService are exported. AuditRetentionService
 * is exported (not just internal) so PdpaRetentionModule's scheduled sweep
 * (L-2) can inject it without importing this whole module's admin read
 * surface — @Global already makes it reachable everywhere, this just states
 * the intent explicitly. AuditLogQueryService and the controller remain
 * unexported: they are the admin read surface (Phase 5D.1) and nothing else
 * should depend on them.
 */
@Global()
@Module({
  controllers: [AuditLogController],
  providers: [AuditLogService, AuditLogQueryService, AuditRetentionService, AdminGuard],
  exports: [AuditLogService, AuditRetentionService],
})
export class AuditLogModule {}

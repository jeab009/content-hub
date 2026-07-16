import { Global, Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';

/**
 * Global so any feature module can inject AuditLogService without every
 * module re-declaring it as an import.
 */
@Global()
@Module({
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}

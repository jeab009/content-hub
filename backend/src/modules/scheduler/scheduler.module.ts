import { Module } from '@nestjs/common';
import { AdminGuard } from '../../common/guards/admin.guard';
import { SchedulerController } from './scheduler.controller';
import { SchedulerService } from './scheduler.service';

/**
 * Phase 2 Pass B — scheduler read-model: per-platform cadence progress vs.
 * platform_cadence_targets plus the ready backlog with latest ranking
 * scores. Publishing itself stays manual (PublishModule); this module
 * never dispatches anything.
 */
@Module({
  controllers: [SchedulerController],
  providers: [SchedulerService, AdminGuard],
})
export class SchedulerModule {}

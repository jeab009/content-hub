import { Module } from '@nestjs/common';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RankingModule } from '../ranking/ranking.module';
import { SchedulerController } from './scheduler.controller';
import { SchedulerService } from './scheduler.service';

/**
 * Phase 2 Pass B — scheduler read-model: per-platform cadence progress vs.
 * platform_cadence_targets plus the ready backlog with latest ranking
 * scores. Publishing itself stays manual (PublishModule); this module
 * never dispatches anything.
 */
@Module({
  // RankingModule only for ActiveRankingEngineService: the scheduler's score
  // read must scope to the same engine version as the per-content ranking
  // read or the two can recommend different platforms (BUG-P5-02 /
  // BUG-QA-003). No engine or factor service is pulled in.
  imports: [RankingModule],
  controllers: [SchedulerController],
  providers: [SchedulerService, AdminGuard],
})
export class SchedulerModule {}

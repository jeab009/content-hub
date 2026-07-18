import { Module } from '@nestjs/common';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RankingController } from './ranking.controller';
import { RankingEngineService } from './ranking-engine.service';
import { RankingFactorsService } from './ranking-factors.service';

/**
 * Phase 2 Pass B — rule-based ranking engine v1. Scores content per
 * platform from explainable weighted factors (engagement history, API
 * availability, pillar-ratio alignment, cadence pressure) and persists the
 * full reasoning payload alongside every score.
 */
@Module({
  controllers: [RankingController],
  providers: [RankingEngineService, RankingFactorsService, AdminGuard],
  exports: [RankingEngineService],
})
export class RankingModule {}

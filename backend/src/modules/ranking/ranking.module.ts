import { Module } from '@nestjs/common';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RankingController } from './ranking.controller';
import { RankingEngineService } from './ranking-engine.service';
import { RankingFactorsService } from './ranking-factors.service';
import { RankingEngineV2Service } from './ranking-engine-v2.service';
import { RankingFactorsV2Service } from './ranking-factors-v2.service';
import { RankingEngineSelectorService } from './ranking-engine-selector.service';

/**
 * Rule-based ranking. Both engines live here side by side:
 *
 * - v1 (Phase 2): four explainable weighted factors over Facebook/YouTube.
 *   Frozen — its service, factors, and constants are unchanged so every
 *   v1-tagged score row stays attributable to the logic that produced it.
 * - v2 (Phase 5): five factors over all four platforms — engagement blended
 *   with earnings, plus override_feedback learned from the admin's own past
 *   decisions. Still a transparent weighted rule set, not a model.
 *
 * RankingEngineSelectorService picks between them from the RANKING_ENGINE
 * flag (default v1). RankingEngineService is still the exported read path
 * (getLatestScores/getRecommendation) for the publish and scheduler flows.
 */
@Module({
  controllers: [RankingController],
  providers: [
    RankingEngineService,
    RankingFactorsService,
    RankingEngineV2Service,
    RankingFactorsV2Service,
    RankingEngineSelectorService,
    AdminGuard,
  ],
  exports: [RankingEngineService],
})
export class RankingModule {}

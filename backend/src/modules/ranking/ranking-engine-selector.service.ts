import { Injectable } from '@nestjs/common';
import { EngineVersion, RankingScore } from '@prisma/client';
import { ActiveRankingEngineService } from './active-ranking-engine.service';
import { RankingEngineService } from './ranking-engine.service';
import { RankingEngineV2Service } from './ranking-engine-v2.service';

/**
 * Picks which ranking engine serves a recompute, from the RANKING_ENGINE flag
 * (default 'v1'). One place makes the choice, so no caller has to know the
 * flag exists.
 *
 * There is still exactly ONE read implementation (getLatestScores /
 * getRecommendation on RankingEngineService) shared by both engines — the
 * BUG-QA-003 guarantee that the scheduler and the per-content recommendation
 * can never disagree depends on that. What changed in Phase 5D.1 is that the
 * single read implementation is now SCOPED to the active engine version
 * (BUG-P5-02): reads are engine-agnostic in code, but the row set they read
 * is not allowed to mix engines, because scores from different engines are
 * not comparable.
 */
@Injectable()
export class RankingEngineSelectorService {
  constructor(
    private readonly activeEngine: ActiveRankingEngineService,
    private readonly v1: RankingEngineService,
    private readonly v2: RankingEngineV2Service,
  ) {}

  /**
   * The engine version this instance is configured to run. Delegates to
   * ActiveRankingEngineService so the write path and the (engine-scoped)
   * read path can never resolve the flag differently.
   */
  get activeEngineVersion(): EngineVersion {
    return this.activeEngine.version;
  }

  computeScores(contentId: string, actorId: string): Promise<RankingScore[]> {
    return this.activeEngine.version === EngineVersion.v2
      ? this.v2.computeScores(contentId, actorId)
      : this.v1.computeScores(contentId, actorId);
  }
}

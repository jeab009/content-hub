import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RankingScore } from '@prisma/client';
import { AppConfig } from '../../config/configuration';
import { RankingEngineService } from './ranking-engine.service';
import { RankingEngineV2Service } from './ranking-engine-v2.service';

/**
 * Picks which ranking engine serves a recompute, from the RANKING_ENGINE flag
 * (default 'v1'). One place makes the choice, so no caller has to know the
 * flag exists.
 *
 * Only the WRITE path is versioned. Reads (getLatestScores /
 * getRecommendation) operate on already-persisted rows and stay on the v1
 * service for everyone — the publish flow's was_override recompute must read
 * scores the same way no matter which engine wrote them, and BUG-QA-003's
 * "scheduler and per-content recommendation must never disagree" guarantee
 * depends on there being exactly one read implementation.
 */
@Injectable()
export class RankingEngineSelectorService {
  private readonly engine: 'v1' | 'v2';

  constructor(
    configService: ConfigService,
    private readonly v1: RankingEngineService,
    private readonly v2: RankingEngineV2Service,
  ) {
    this.engine = configService.get<AppConfig>('app')?.ranking.engine ?? 'v1';
  }

  /** The engine version this instance is configured to run. */
  get activeEngineVersion(): 'v1' | 'v2' {
    return this.engine;
  }

  computeScores(contentId: string, actorId: string): Promise<RankingScore[]> {
    return this.engine === 'v2'
      ? this.v2.computeScores(contentId, actorId)
      : this.v1.computeScores(contentId, actorId);
  }
}

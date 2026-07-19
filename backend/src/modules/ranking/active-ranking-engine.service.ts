import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EngineVersion } from '@prisma/client';
import { AppConfig } from '../../config/configuration';

/**
 * The one place that answers "which ranking engine is in effect right now?"
 * as a persisted `EngineVersion`, resolved once from the RANKING_ENGINE flag
 * (default v1).
 *
 * Why this is its own tiny service rather than a getter on
 * RankingEngineSelectorService: the READ path needs the answer too
 * (BUG-P5-02), and the read path lives in two places — the per-content
 * ranking read (RankingEngineService) and the batched scheduler overview
 * (SchedulerService). Both must scope to the SAME engine or they can
 * disagree, which is exactly the failure BUG-QA-003 forbids. Injecting the
 * selector into the scheduler would drag both engines and both factor
 * services into a pure read-model module for one boolean's worth of config;
 * this service carries only the config dependency.
 */
@Injectable()
export class ActiveRankingEngineService {
  private readonly engineVersion: EngineVersion;

  constructor(configService: ConfigService) {
    this.engineVersion =
      configService.get<AppConfig>('app')?.ranking.engine === 'v2'
        ? EngineVersion.v2
        : EngineVersion.v1;
  }

  /** The EngineVersion every score read must scope itself to. */
  get version(): EngineVersion {
    return this.engineVersion;
  }
}

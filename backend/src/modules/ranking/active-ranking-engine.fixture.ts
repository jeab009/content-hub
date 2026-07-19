import { ConfigService } from '@nestjs/config';
import { EngineVersion } from '@prisma/client';
import { ActiveRankingEngineService } from './active-ranking-engine.service';

/**
 * Test-only builder for ActiveRankingEngineService pinned to a chosen engine.
 *
 * Lives in its own file rather than inside a single .spec so that every suite
 * that needs an active-engine stub builds it the SAME way — the two read
 * surfaces (ranking + scheduler) are only provably consistent if their tests
 * configure the engine identically. Not referenced by any runtime module.
 */
export function activeEngine(version: EngineVersion): ActiveRankingEngineService {
  const configService = {
    get: () => ({ ranking: { engine: version } }),
  } as unknown as ConfigService;

  return new ActiveRankingEngineService(configService);
}

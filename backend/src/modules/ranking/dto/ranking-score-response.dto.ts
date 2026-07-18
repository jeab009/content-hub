import { AssetPlatform, EngineVersion, RankingScore } from '@prisma/client';

/**
 * API shape of a ranking_scores row. `score` is exposed as a number (the
 * column is Decimal(10,4), well inside double precision) and `reasoning`
 * is passed through verbatim — it is the explainability payload the UI
 * renders as "why this platform".
 */
export class RankingScoreResponseDto {
  id!: string;
  contentId!: string;
  platform!: AssetPlatform;
  score!: number;
  reasoning!: unknown;
  engineVersion!: EngineVersion;
  computedAt!: Date;

  static fromEntity(entity: RankingScore): RankingScoreResponseDto {
    const dto = new RankingScoreResponseDto();
    dto.id = entity.id;
    dto.contentId = entity.contentId;
    dto.platform = entity.platform;
    dto.score = Number(entity.score);
    dto.reasoning = entity.reasoning;
    dto.engineVersion = entity.engineVersion;
    dto.computedAt = entity.computedAt;
    return dto;
  }
}

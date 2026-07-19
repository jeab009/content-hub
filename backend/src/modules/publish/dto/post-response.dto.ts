import { AssetPlatform, Platform, Post, PostStatus, PublishMethod } from '@prisma/client';

/** API shape of a posts row. Decimal priorityScore exposed as number|null. */
export class PostResponseDto {
  id!: string;
  contentId!: string;
  platform!: Platform;
  status!: PostStatus;
  selectedPlatform!: AssetPlatform | null;
  recommendedPlatform!: AssetPlatform | null;
  wasOverride!: boolean;
  overrideReason!: string | null;
  rankingScoreId!: string | null;
  priorityScore!: number | null;
  externalPostId!: string | null;
  externalPostUrl!: string | null;
  publishMethod!: PublishMethod;
  executedBy!: string | null;
  scheduledAt!: Date | null;
  postedAt!: Date | null;
  version!: number;
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(entity: Post): PostResponseDto {
    const dto = new PostResponseDto();
    dto.id = entity.id;
    dto.contentId = entity.contentId;
    dto.platform = entity.platform;
    dto.status = entity.status;
    dto.selectedPlatform = entity.selectedPlatform;
    dto.recommendedPlatform = entity.recommendedPlatform;
    dto.wasOverride = entity.wasOverride;
    dto.overrideReason = entity.overrideReason;
    dto.rankingScoreId = entity.rankingScoreId;
    dto.priorityScore = entity.priorityScore === null ? null : Number(entity.priorityScore);
    dto.externalPostId = entity.externalPostId;
    dto.externalPostUrl = entity.externalPostUrl;
    dto.publishMethod = entity.publishMethod;
    dto.executedBy = entity.executedBy;
    dto.scheduledAt = entity.scheduledAt;
    dto.postedAt = entity.postedAt;
    dto.version = entity.version;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    return dto;
  }
}

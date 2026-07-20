import {
  CommerceChannel,
  CommercePlacement,
  CommercePlacementStatus,
  CommerceSource,
  PublishMethod,
} from '@prisma/client';

/** API shape of a commerce_placements row. */
export class CommercePlacementResponseDto {
  id!: string;
  contentId!: string;
  channel!: CommerceChannel;
  externalMediaId!: string;
  externalUrl!: string | null;
  status!: CommercePlacementStatus;
  publishMethod!: PublishMethod;
  sourceAssetId!: string | null;
  mediaUrl!: string | null;
  durationSeconds!: number | null;
  note!: string | null;
  version!: number;
  source!: CommerceSource;
  recordedBy!: string;
  placedAt!: Date;
  removedAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(entity: CommercePlacement): CommercePlacementResponseDto {
    const dto = new CommercePlacementResponseDto();
    dto.id = entity.id;
    dto.contentId = entity.contentId;
    dto.channel = entity.channel;
    dto.externalMediaId = entity.externalMediaId;
    dto.externalUrl = entity.externalUrl;
    dto.status = entity.status;
    dto.publishMethod = entity.publishMethod;
    dto.sourceAssetId = entity.sourceAssetId;
    dto.mediaUrl = entity.mediaUrl;
    dto.durationSeconds = entity.durationSeconds;
    dto.note = entity.note;
    dto.version = entity.version;
    dto.source = entity.source;
    dto.recordedBy = entity.recordedBy;
    dto.placedAt = entity.placedAt;
    dto.removedAt = entity.removedAt;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    return dto;
  }
}

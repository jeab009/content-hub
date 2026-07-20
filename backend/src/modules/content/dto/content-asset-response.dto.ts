import { ContentAsset } from '@prisma/client';

export class ContentAssetResponseDto {
  id!: string;
  contentId!: string;
  platform!: string;
  aspectRatio!: string;
  mediaUrl!: string;
  durationSeconds!: number | null;
  createdAt!: Date;

  static fromEntity(asset: ContentAsset): ContentAssetResponseDto {
    const dto = new ContentAssetResponseDto();
    dto.id = asset.id;
    dto.contentId = asset.contentId;
    dto.platform = asset.platform;
    dto.aspectRatio = asset.aspectRatio;
    dto.mediaUrl = asset.mediaUrl;
    dto.durationSeconds = asset.durationSeconds;
    dto.createdAt = asset.createdAt;
    return dto;
  }
}

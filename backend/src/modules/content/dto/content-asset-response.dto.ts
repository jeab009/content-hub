import { ContentAsset } from '@prisma/client';

export class ContentAssetResponseDto {
  id!: string;
  contentId!: string;
  platform!: string;
  aspectRatio!: string;
  mediaUrl!: string;
  createdAt!: Date;

  static fromEntity(asset: ContentAsset): ContentAssetResponseDto {
    const dto = new ContentAssetResponseDto();
    dto.id = asset.id;
    dto.contentId = asset.contentId;
    dto.platform = asset.platform;
    dto.aspectRatio = asset.aspectRatio;
    dto.mediaUrl = asset.mediaUrl;
    dto.createdAt = asset.createdAt;
    return dto;
  }
}

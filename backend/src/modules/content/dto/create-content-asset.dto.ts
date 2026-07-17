import { AspectRatio, AssetPlatform } from '@prisma/client';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * One per-platform/aspect-ratio variant of a piece of Content (e.g. the
 * 9:16 TikTok cut of a source video). `mediaUrl` must come from the upload
 * endpoint's response, same ownership rule as Content.mediaUrl — see
 * assertMediaUrlIsOwned in media-url.util.ts.
 */
export class CreateContentAssetDto {
  @IsEnum(AssetPlatform)
  platform!: AssetPlatform;

  @IsEnum(AspectRatio)
  aspectRatio!: AspectRatio;

  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  mediaUrl!: string;
}

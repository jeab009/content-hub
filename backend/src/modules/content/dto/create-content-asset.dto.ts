import { AspectRatio, AssetPlatform } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

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

  /**
   * Best-effort MP4 duration (Phase 6, WBS 6A.6), carried over verbatim from
   * `POST /api/contents/upload`'s response for this same file. COURTESY ONLY
   * — nothing downstream trusts this value as authority; the Shopee placement
   * boundary is the only place duration is fail-closed enforced, and it is
   * enforced there server-side regardless of what this field says.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(86_400)
  durationSeconds?: number;
}

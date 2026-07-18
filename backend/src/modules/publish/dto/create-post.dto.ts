import { AssetPlatform } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

const OVERRIDE_REASON_MAX_LENGTH = 2000;

/**
 * Body of POST /api/posts — the manual publish request.
 *
 * Deliberately absent fields: `wasOverride`, `recommendedPlatform`,
 * `rankingScoreId`. Those are ALWAYS recomputed server-side from the latest
 * ranking scores (System Analyst hard constraint) — and the global
 * ValidationPipe's forbidNonWhitelisted rejects any request that tries to
 * smuggle them in.
 */
export class CreatePostDto {
  @IsUUID()
  contentId!: string;

  /** The platform the admin chose to publish to (may differ from the recommendation). */
  @IsEnum(AssetPlatform)
  platform!: AssetPlatform;

  /** Step-up re-auth: the admin's own password, verified per request. */
  @IsString()
  @IsNotEmpty()
  password!: string;

  /** Optional human note for why the recommendation was not followed. */
  @IsOptional()
  @IsString()
  @MaxLength(OVERRIDE_REASON_MAX_LENGTH)
  overrideReason?: string;
}

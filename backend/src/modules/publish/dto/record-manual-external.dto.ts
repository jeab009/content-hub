import { AssetPlatform } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  MaxLength,
} from 'class-validator';

const OVERRIDE_REASON_MAX_LENGTH = 2000;
const EXTERNAL_POST_ID_MAX_LENGTH = 255;
const EXTERNAL_POST_URL_MAX_LENGTH = 2048;

/**
 * Body of POST /api/posts/manual-external — the admin published this content
 * natively on the platform (the delivered TikTok/LINE OA path, Decision 1) and
 * is now recording it so the post becomes a first-class tracked entity.
 *
 * Deliberately absent, exactly as in CreatePostDto: `wasOverride`,
 * `recommendedPlatform`, `rankingScoreId`, `status`, `publishMethod`. Those are
 * set server-side — recording a post must not become a back door for writing
 * override facts the ranking engine later learns from. The global
 * ValidationPipe's forbidNonWhitelisted rejects any attempt to smuggle them in.
 */
export class RecordManualExternalDto {
  @IsUUID()
  contentId!: string;

  /** The platform the admin actually posted on. */
  @IsEnum(AssetPlatform)
  platform!: AssetPlatform;

  /** The platform-native id of the post the admin already published. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(EXTERNAL_POST_ID_MAX_LENGTH)
  externalPostId!: string;

  /**
   * Permalink to the live post, for human cross-checking (risk R5).
   * OPTIONAL because not every platform has one: a LINE OA broadcast is a push
   * to followers, so it has a message id but no addressable public URL.
   */
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(EXTERNAL_POST_URL_MAX_LENGTH)
  externalPostUrl?: string;

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

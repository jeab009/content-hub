import { CommerceChannel } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { COMMERCE_PLACEMENT_NOTE_MAX_LENGTH } from '../commerce.constants';

const EXTERNAL_MEDIA_ID_MAX_LENGTH = 255;
const EXTERNAL_URL_MAX_LENGTH = 2048;
const MAX_DURATION_SECONDS = 86_400;

/**
 * Body of POST /api/commerce/placements/manual-external (6A.5). Mirrors
 * `RecordManualExternalDto` 1:1, including what it deliberately OMITS:
 * `status`, `publishMethod`, `source`, `recordedBy`, `version` are set
 * server-side. The global ValidationPipe (whitelist + forbidNonWhitelisted)
 * rejects any attempt to smuggle them in.
 *
 * PDPA: there is no field here for buyer or order information, and `note`
 * is length-capped and never written to audit meta (SA-4 exclusion list).
 */
export class RecordCommercePlacementDto {
  @IsUUID()
  contentId!: string;

  @IsEnum(CommerceChannel)
  channel!: CommerceChannel;

  @IsString()
  @IsNotEmpty()
  @MaxLength(EXTERNAL_MEDIA_ID_MAX_LENGTH)
  externalMediaId!: string;

  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(EXTERNAL_URL_MAX_LENGTH)
  externalUrl?: string;

  /**
   * REQUIRED for channel=shopee and validated fail-closed in the SERVICE
   * (null/absent → 422), not here — optional at the DTO layer only so the
   * service, not class-validator, owns the "null is a rejection" message
   * (see commerce-duration.ts).
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_DURATION_SECONDS)
  durationSeconds?: number;

  /** Pre-fills mediaUrl/durationSeconds when the admin picks an existing asset. */
  @IsOptional()
  @IsUUID()
  sourceAssetId?: string;

  /** Step-up re-auth: the admin's own password, verified per request. */
  @IsString()
  @IsNotEmpty()
  password!: string;

  /** ⚠ Free text, capped at 200 chars (System Analyst A4). Never audited, never exported. */
  @IsOptional()
  @IsString()
  @MaxLength(COMMERCE_PLACEMENT_NOTE_MAX_LENGTH)
  note?: string;
}

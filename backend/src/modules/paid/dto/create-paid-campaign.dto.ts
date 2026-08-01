import { AdCampaignStatus, AdChannel } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PAID_OBJECTIVE_MAX_LENGTH } from '../paid.constants';

const EXTERNAL_CAMPAIGN_NAME_MAX_LENGTH = 255;
const EXTERNAL_CAMPAIGN_ID_MAX_LENGTH = 255;
const MAX_MONEY_AMOUNT = 99_999_999.99;

/**
 * Body of POST /api/paid/campaigns (design §3.4). `channel` is always
 * `meta` this phase (Decision 3); `status`/`isActive`/`retiredAt`/`source`/
 * `createdBy` are otherwise set server-side (default `active`/`true`) —
 * the global ValidationPipe's forbidNonWhitelisted rejects any attempt to
 * smuggle the server-owned ones in.
 */
export class CreatePaidCampaignDto {
  @IsEnum(AdChannel)
  channel!: AdChannel;

  @IsString()
  @IsNotEmpty()
  @MaxLength(EXTERNAL_CAMPAIGN_NAME_MAX_LENGTH)
  externalCampaignName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(EXTERNAL_CAMPAIGN_ID_MAX_LENGTH)
  externalCampaignId?: string;

  /** Free text, capped — see AdCampaign.objective's docblock in schema.prisma. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(PAID_OBJECTIVE_MAX_LENGTH)
  objective!: string;

  @IsOptional()
  @IsUUID()
  contentId?: string;

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  /** INDICATIVE ONLY (SA-P5) — never summed with, or reconciled against, spend. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_MONEY_AMOUNT)
  plannedBudget?: number;

  /** Defaults to THB in the service. THB is the only accepted value in v1 (SA-P6). */
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsEnum(AdCampaignStatus)
  status?: AdCampaignStatus;
}

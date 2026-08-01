import { AdCampaignStatus } from '@prisma/client';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  IsEnum,
} from 'class-validator';
import { PAID_OBJECTIVE_MAX_LENGTH } from '../paid.constants';

const EXTERNAL_CAMPAIGN_NAME_MAX_LENGTH = 255;
const MAX_MONEY_AMOUNT = 99_999_999.99;

/**
 * Body of PATCH /api/paid/campaigns/:id. `channel` and `externalCampaignId`
 * are deliberately NOT editable here — identity fields, same posture as
 * Commerce's `UpdateProductDto` excluding `channel`/`externalProductId`
 * (design §3.4). Changing them is "a different campaign", modelled as
 * retiring this row and creating a new one.
 */
export class UpdatePaidCampaignDto {
  @IsOptional()
  @IsString()
  @MaxLength(EXTERNAL_CAMPAIGN_NAME_MAX_LENGTH)
  externalCampaignName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(PAID_OBJECTIVE_MAX_LENGTH)
  objective?: string;

  @IsOptional()
  @IsUUID()
  contentId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_MONEY_AMOUNT)
  plannedBudget?: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsEnum(AdCampaignStatus)
  status?: AdCampaignStatus;
}

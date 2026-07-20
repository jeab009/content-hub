import { CommerceChannel } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';

/** Query filters for GET /api/commerce/summary. All optional, ANDed. */
export class CommerceSummaryQueryDto {
  @IsOptional()
  @IsEnum(CommerceChannel)
  channel?: CommerceChannel;

  @IsOptional()
  @IsUUID()
  productId?: string;

  /** Conversions whose periodStart is on/after this date. */
  @IsOptional()
  @IsDateString()
  periodStart?: string;

  /** Conversions whose periodEnd is on/before this date. */
  @IsOptional()
  @IsDateString()
  periodEnd?: string;
}

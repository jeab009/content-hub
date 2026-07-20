import { CommerceChannel } from '@prisma/client';
import { IsDateString, IsEnum } from 'class-validator';

/**
 * Query for GET /api/commerce/conversions/overlap-check — a WARN-ONLY probe
 * for the entry form (not a blocking validation): "does a conversion already
 * exist covering part of this period for this channel?"
 */
export class OverlapCheckQueryDto {
  @IsEnum(CommerceChannel)
  channel!: CommerceChannel;

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;
}

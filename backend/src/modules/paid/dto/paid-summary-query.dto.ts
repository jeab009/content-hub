import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/** Query filters for GET /api/paid/summary (design §3.2). All optional, ANDed. */
export class PaidSummaryQueryDto {
  @IsOptional()
  @IsUUID()
  campaignId?: string;

  @IsOptional()
  @IsUUID()
  contentId?: string;

  /** Performance entries whose periodStart is on/after this date. */
  @IsOptional()
  @IsDateString()
  periodStart?: string;

  /** Performance entries whose periodEnd is on/before this date. */
  @IsOptional()
  @IsDateString()
  periodEnd?: string;
}

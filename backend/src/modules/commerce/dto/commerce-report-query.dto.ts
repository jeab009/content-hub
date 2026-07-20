import { CommerceChannel } from '@prisma/client';
import { IsEnum, IsISO8601, IsOptional, IsUUID } from 'class-validator';

/**
 * Filters for GET /api/reports/commerce.csv. Mirrors the SHAPE of the
 * payout `ReportQueryDto` (from/to/entity filters) without importing it —
 * the commerce-side ESLint zone bans everything under `modules/commerce`
 * from importing anything under `modules/reports`, so this is a deliberate,
 * small duplication rather than a shared type across the boundary.
 */
export class CommerceReportQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsEnum(CommerceChannel)
  channel?: CommerceChannel;

  @IsOptional()
  @IsUUID()
  productId?: string;
}

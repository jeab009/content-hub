import { IsISO8601, IsOptional, IsUUID } from 'class-validator';

/**
 * Filters for GET /api/reports/paid.csv. Mirrors the SHAPE of
 * `CommerceReportQueryDto` (from/to/entity filters) without importing it —
 * the paid-side ESLint zone bans everything under `modules/paid` from
 * importing anything under `modules/commerce` or `modules/reports`, so this
 * is a deliberate, small duplication rather than a shared type across the
 * boundary.
 */
export class PaidReportQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsUUID()
  campaignId?: string;
}

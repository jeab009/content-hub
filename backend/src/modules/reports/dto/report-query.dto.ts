import { AssetPlatform } from '@prisma/client';
import { IsEnum, IsISO8601, IsOptional, IsUUID } from 'class-validator';

/**
 * Shared filters for the CSV report endpoints. All optional — an unfiltered
 * export is the common case. `from`/`to` are ISO-8601 dates bounding the
 * reporting period.
 */
export class ReportQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsEnum(AssetPlatform)
  platform?: AssetPlatform;

  @IsOptional()
  @IsUUID()
  contentId?: string;
}

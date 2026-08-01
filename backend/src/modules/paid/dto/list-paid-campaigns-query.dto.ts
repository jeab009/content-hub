import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

const SEARCH_MAX_LENGTH = 255;

/** Coerce the string query values 'true'/'false' into booleans (matches ListProductsQueryDto). */
function toBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
}

/** Query filters for GET /api/paid/campaigns (design §3.2). All optional, ANDed. */
export class ListPaidCampaignsQueryDto {
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(SEARCH_MAX_LENGTH)
  q?: string;

  @IsOptional()
  @IsUUID()
  contentId?: string;
}

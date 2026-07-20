import { CommerceChannel } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

const SEARCH_MAX_LENGTH = 255;

/** Coerce the string query values 'true'/'false' into booleans (matches ListCommentsQueryDto). */
function toBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
}

/** Query filters for GET /api/commerce/products. All optional, ANDed. */
export class ListProductsQueryDto {
  @IsOptional()
  @IsEnum(CommerceChannel)
  channel?: CommerceChannel;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(SEARCH_MAX_LENGTH)
  q?: string;
}

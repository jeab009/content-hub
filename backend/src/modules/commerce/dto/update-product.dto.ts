import {
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const NAME_MAX_LENGTH = 500;
const SKU_MAX_LENGTH = 255;
const PRODUCT_URL_MAX_LENGTH = 2048;
const MAX_MONEY_AMOUNT = 99_999_999.99;
const MAX_COMMISSION_RATE_PCT = 100;

/**
 * Body of PATCH /api/commerce/products/:id. `channel` and
 * `externalProductId` are deliberately NOT editable here — they are the
 * table's natural key; changing them is "a different product", modelled as
 * retiring this row and creating a new one. Use POST .../retire to
 * soft-retire (never a hard delete).
 */
export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX_LENGTH)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SKU_MAX_LENGTH)
  sku?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(PRODUCT_URL_MAX_LENGTH)
  productUrl?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_MONEY_AMOUNT)
  listPrice?: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_COMMISSION_RATE_PCT)
  commissionRatePct?: number;
}

import { CommerceChannel } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const EXTERNAL_PRODUCT_ID_MAX_LENGTH = 255;
const NAME_MAX_LENGTH = 500;
const SKU_MAX_LENGTH = 255;
const PRODUCT_URL_MAX_LENGTH = 2048;
const MAX_MONEY_AMOUNT = 99_999_999.99;
const MAX_COMMISSION_RATE_PCT = 100;

/**
 * Body of POST /api/commerce/products (6A.2). `channel` and
 * `externalProductId` together are the natural key (`UNIQUE(channel,
 * externalProductId)`); a duplicate create is a 409, not a silent upsert.
 *
 * `status`, `isActive`, `retiredAt`, `source`, `createdBy` are all set
 * server-side — the global ValidationPipe's forbidNonWhitelisted rejects any
 * attempt to smuggle them in, the same pattern every other create DTO in
 * this codebase uses.
 */
export class CreateProductDto {
  @IsEnum(CommerceChannel)
  channel!: CommerceChannel;

  @IsString()
  @IsNotEmpty()
  @MaxLength(EXTERNAL_PRODUCT_ID_MAX_LENGTH)
  externalProductId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(NAME_MAX_LENGTH)
  name!: string;

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

  /** Defaults to THB in the service. Currently the only accepted value (SA-9). */
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  /** INDICATIVE ONLY — never multiplied by sales anywhere (R9). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_COMMISSION_RATE_PCT)
  commissionRatePct?: number;
}

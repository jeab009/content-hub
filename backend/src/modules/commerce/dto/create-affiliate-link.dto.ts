import { IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

const URL_MAX_LENGTH = 2048;
const TRACKING_CODE_MAX_LENGTH = 255;
const SUB_ID_MAX_LENGTH = 255;

/**
 * Body of POST /api/commerce/products/:id/links (6A.3). `channel` is
 * deliberately absent — it is a property of the product, inherited, never
 * denormalised onto the link (design refinement vs the plan, see
 * schema.prisma's AffiliateLink docblock).
 */
export class CreateAffiliateLinkDto {
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @IsNotEmpty()
  @MaxLength(URL_MAX_LENGTH)
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(TRACKING_CODE_MAX_LENGTH)
  trackingCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SUB_ID_MAX_LENGTH)
  subId?: string;
}

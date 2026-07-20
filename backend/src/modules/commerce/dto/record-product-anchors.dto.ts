import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';

const MAX_ANCHORS_PER_REQUEST = 50;

/**
 * One product to anchor, optionally paired with the affiliate link that
 * earned the attribution. Object form, NOT two parallel arrays — System
 * Analyst condition C5.
 *
 * The design's original DTO used `productIds: string[]` alongside an
 * index-aligned `affiliateLinkIds?: (string | null)[]`, decorated
 * `@IsUUID('4', { each: true })`. class-validator applies `each` to EVERY
 * element including `null`, so a documented `null` entry ("no link") is
 * unreachable — it always fails validation. Worse, the two arrays' lengths
 * were never asserted equal, so an index-aligned pairing could silently
 * misalign and attach the wrong link to the wrong product, which the
 * composite FK `(affiliate_link_id, product_id)` would then reject with a
 * 500-shaped FK error instead of a clean 400. The object form removes the
 * whole alignment class of bug: `affiliateLinkId` is simply absent (not
 * `null`) when there is no link, which `@IsOptional()` expresses natively.
 */
export class AnchorItemDto {
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsUUID()
  affiliateLinkId?: string;
}

/** Body of POST /api/posts/:id/product-anchors and the placement equivalent. */
export class RecordProductAnchorsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_ANCHORS_PER_REQUEST)
  @ValidateNested({ each: true })
  @Type(() => AnchorItemDto)
  anchors!: AnchorItemDto[];
}

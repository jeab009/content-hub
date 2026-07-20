import { CommerceSource, ProductAnchor } from '@prisma/client';

/** API shape of a product_anchors row. */
export class ProductAnchorResponseDto {
  id!: string;
  postId!: string | null;
  placementId!: string | null;
  productId!: string;
  affiliateLinkId!: string | null;
  anchorPosition!: number | null;
  anchoredAt!: Date;
  removedAt!: Date | null;
  source!: CommerceSource;
  recordedBy!: string;
  createdAt!: Date;

  static fromEntity(entity: ProductAnchor): ProductAnchorResponseDto {
    const dto = new ProductAnchorResponseDto();
    dto.id = entity.id;
    dto.postId = entity.postId;
    dto.placementId = entity.placementId;
    dto.productId = entity.productId;
    dto.affiliateLinkId = entity.affiliateLinkId;
    dto.anchorPosition = entity.anchorPosition;
    dto.anchoredAt = entity.anchoredAt;
    dto.removedAt = entity.removedAt;
    dto.source = entity.source;
    dto.recordedBy = entity.recordedBy;
    dto.createdAt = entity.createdAt;
    return dto;
  }
}

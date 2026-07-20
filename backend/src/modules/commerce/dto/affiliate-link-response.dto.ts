import { AffiliateLink, CommerceSource } from '@prisma/client';

/** API shape of an affiliate_links row. */
export class AffiliateLinkResponseDto {
  id!: string;
  productId!: string;
  url!: string;
  trackingCode!: string | null;
  subId!: string | null;
  isActive!: boolean;
  retiredAt!: Date | null;
  source!: CommerceSource;
  createdBy!: string;
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(entity: AffiliateLink): AffiliateLinkResponseDto {
    const dto = new AffiliateLinkResponseDto();
    dto.id = entity.id;
    dto.productId = entity.productId;
    dto.url = entity.url;
    dto.trackingCode = entity.trackingCode;
    dto.subId = entity.subId;
    dto.isActive = entity.isActive;
    dto.retiredAt = entity.retiredAt;
    dto.source = entity.source;
    dto.createdBy = entity.createdBy;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    return dto;
  }
}

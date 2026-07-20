import { CommerceChannel, CommerceProduct, CommerceSource } from '@prisma/client';

/** API shape of a commerce_products row. Decimal fields exposed as number|null. */
export class CommerceProductResponseDto {
  id!: string;
  channel!: CommerceChannel;
  externalProductId!: string;
  name!: string;
  sku!: string | null;
  productUrl!: string | null;
  listPrice!: number | null;
  currency!: string;
  commissionRatePct!: number | null;
  isActive!: boolean;
  retiredAt!: Date | null;
  source!: CommerceSource;
  createdBy!: string;
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(entity: CommerceProduct): CommerceProductResponseDto {
    const dto = new CommerceProductResponseDto();
    dto.id = entity.id;
    dto.channel = entity.channel;
    dto.externalProductId = entity.externalProductId;
    dto.name = entity.name;
    dto.sku = entity.sku;
    dto.productUrl = entity.productUrl;
    dto.listPrice = entity.listPrice === null ? null : Number(entity.listPrice);
    dto.currency = entity.currency;
    dto.commissionRatePct =
      entity.commissionRatePct === null ? null : Number(entity.commissionRatePct);
    dto.isActive = entity.isActive;
    dto.retiredAt = entity.retiredAt;
    dto.source = entity.source;
    dto.createdBy = entity.createdBy;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    return dto;
  }
}

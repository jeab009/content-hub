import { CommerceChannel, CommerceConversion, CommerceSource } from '@prisma/client';

/** API shape of a commerce_conversions row. Decimal fields exposed as number|null. */
export class CommerceConversionResponseDto {
  id!: string;
  channel!: CommerceChannel;
  periodStart!: Date;
  periodEnd!: Date;
  ordersCount!: number | null;
  itemsSold!: number | null;
  grossSalesAmount!: number | null;
  commissionAmount!: number;
  currency!: string;
  postId!: string | null;
  placementId!: string | null;
  productId!: string | null;
  affiliateLinkId!: string | null;
  statementRef!: string | null;
  reversalOfId!: string | null;
  source!: CommerceSource;
  recordedBy!: string;
  createdAt!: Date;

  static fromEntity(entity: CommerceConversion): CommerceConversionResponseDto {
    const dto = new CommerceConversionResponseDto();
    dto.id = entity.id;
    dto.channel = entity.channel;
    dto.periodStart = entity.periodStart;
    dto.periodEnd = entity.periodEnd;
    dto.ordersCount = entity.ordersCount;
    dto.itemsSold = entity.itemsSold;
    dto.grossSalesAmount =
      entity.grossSalesAmount === null ? null : Number(entity.grossSalesAmount);
    dto.commissionAmount = Number(entity.commissionAmount);
    dto.currency = entity.currency;
    dto.postId = entity.postId;
    dto.placementId = entity.placementId;
    dto.productId = entity.productId;
    dto.affiliateLinkId = entity.affiliateLinkId;
    dto.statementRef = entity.statementRef;
    dto.reversalOfId = entity.reversalOfId;
    dto.source = entity.source;
    dto.recordedBy = entity.recordedBy;
    dto.createdAt = entity.createdAt;
    return dto;
  }
}

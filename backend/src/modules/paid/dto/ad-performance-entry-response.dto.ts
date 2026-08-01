import { AdPerformanceEntry, AdSource } from '@prisma/client';

/** API shape of an ad_performance_entries row. Decimal fields exposed as number. */
export class AdPerformanceEntryResponseDto {
  id!: string;
  campaignId!: string;
  spend!: number;
  reach!: number | null;
  impressions!: number | null;
  clicks!: number | null;
  resultType!: string | null;
  resultCount!: number | null;
  currency!: string;
  periodStart!: Date;
  periodEnd!: Date;
  sourceRef!: string | null;
  correctsEntryId!: string | null;
  source!: AdSource;
  recordedBy!: string;
  createdAt!: Date;

  static fromEntity(entity: AdPerformanceEntry): AdPerformanceEntryResponseDto {
    const dto = new AdPerformanceEntryResponseDto();
    dto.id = entity.id;
    dto.campaignId = entity.campaignId;
    dto.spend = Number(entity.spend);
    dto.reach = entity.reach;
    dto.impressions = entity.impressions;
    dto.clicks = entity.clicks;
    dto.resultType = entity.resultType;
    dto.resultCount = entity.resultCount;
    dto.currency = entity.currency;
    dto.periodStart = entity.periodStart;
    dto.periodEnd = entity.periodEnd;
    dto.sourceRef = entity.sourceRef;
    dto.correctsEntryId = entity.correctsEntryId;
    dto.source = entity.source;
    dto.recordedBy = entity.recordedBy;
    dto.createdAt = entity.createdAt;
    return dto;
  }
}

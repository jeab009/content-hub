import { Metric, MetricSource, Platform } from '@prisma/client';

/** API shape of a metrics row. Decimal revenue exposed as a number. */
export class MetricResponseDto {
  id!: string;
  postId!: string;
  platform!: Platform;
  reach!: number;
  engagement!: number;
  revenue!: number;
  source!: MetricSource;
  collectedAt!: Date;
  createdAt!: Date;

  static fromEntity(entity: Metric): MetricResponseDto {
    const dto = new MetricResponseDto();
    dto.id = entity.id;
    dto.postId = entity.postId;
    dto.platform = entity.platform;
    dto.reach = entity.reach;
    dto.engagement = entity.engagement;
    dto.revenue = Number(entity.revenue);
    dto.source = entity.source;
    dto.collectedAt = entity.collectedAt;
    dto.createdAt = entity.createdAt;
    return dto;
  }
}

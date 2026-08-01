import { AdCampaign, AdCampaignStatus, AdChannel, AdSource } from '@prisma/client';

/** API shape of an ad_campaigns row. Decimal fields exposed as number|null. */
export class AdCampaignResponseDto {
  id!: string;
  channel!: AdChannel;
  externalCampaignName!: string;
  externalCampaignId!: string | null;
  objective!: string;
  contentId!: string | null;
  startDate!: Date;
  endDate!: Date | null;
  plannedBudget!: number | null;
  currency!: string;
  status!: AdCampaignStatus;
  isActive!: boolean;
  retiredAt!: Date | null;
  source!: AdSource;
  createdBy!: string;
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(entity: AdCampaign): AdCampaignResponseDto {
    const dto = new AdCampaignResponseDto();
    dto.id = entity.id;
    dto.channel = entity.channel;
    dto.externalCampaignName = entity.externalCampaignName;
    dto.externalCampaignId = entity.externalCampaignId;
    dto.objective = entity.objective;
    dto.contentId = entity.contentId;
    dto.startDate = entity.startDate;
    dto.endDate = entity.endDate;
    dto.plannedBudget = entity.plannedBudget === null ? null : Number(entity.plannedBudget);
    dto.currency = entity.currency;
    dto.status = entity.status;
    dto.isActive = entity.isActive;
    dto.retiredAt = entity.retiredAt;
    dto.source = entity.source;
    dto.createdBy = entity.createdBy;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    return dto;
  }
}

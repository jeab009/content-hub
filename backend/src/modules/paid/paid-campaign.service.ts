import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AdCampaign, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { ContentService } from '../content/content.service';
import { assertPaidSupportedCurrency } from './paid-currency.util';
import { PAID_DEFAULT_CURRENCY } from './paid.constants';
import { CreatePaidCampaignDto } from './dto/create-paid-campaign.dto';
import { UpdatePaidCampaignDto } from './dto/update-paid-campaign.dto';
import { ListPaidCampaignsQueryDto } from './dto/list-paid-campaigns-query.dto';

/**
 * Ad campaign record CRUD + soft-retire (design §3.1/3.2, WBS 7A.1).
 * Soft-retire only — never a hard delete, same discipline as
 * `CommerceCatalogService.retireProduct` — so a retired campaign stays
 * reachable for every performance entry that references it.
 *
 * `PaidModule`'s only cross-module dependency is `ContentModule` (System
 * Analyst condition P-B4) — used here solely to validate that an optional
 * `contentId` picker value refers to a real, existing content row, via
 * `ContentService.findOne`, never via a raw Prisma `include` reaching across
 * the boundary (there is none — Layer 1, no Prisma relation).
 */
@Injectable()
export class PaidCampaignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly content: ContentService,
  ) {}

  async create(dto: CreatePaidCampaignDto, userId: string): Promise<AdCampaign> {
    const currency = assertPaidSupportedCurrency(dto.currency ?? PAID_DEFAULT_CURRENCY);
    if (dto.contentId) {
      await this.content.findOne(dto.contentId);
    }

    const campaign = await this.createOrConflict(
      {
        channel: dto.channel,
        externalCampaignName: dto.externalCampaignName,
        externalCampaignId: dto.externalCampaignId ?? null,
        objective: dto.objective,
        contentId: dto.contentId ?? null,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        plannedBudget:
          dto.plannedBudget !== undefined ? new Prisma.Decimal(dto.plannedBudget) : null,
        currency,
        status: dto.status ?? undefined,
        createdBy: userId,
      },
      dto.channel,
      dto.externalCampaignId,
    );

    this.auditLog.record({
      actor: userId,
      action: 'ad_campaign_created',
      result: 'success',
      // objective/externalCampaignName/externalCampaignId are EXCLUDED
      // (System Analyst SA-P4 blanket exclusion — all four paid free-text/
      // identifier fields, not only sourceRef; see paid.constants.ts).
      meta: { campaignId: campaign.id, channel: campaign.channel },
    });

    return campaign;
  }

  async update(id: string, dto: UpdatePaidCampaignDto, userId: string): Promise<AdCampaign> {
    await this.findOrThrow(id);
    if (dto.contentId) {
      await this.content.findOne(dto.contentId);
    }

    const data: Prisma.AdCampaignUpdateInput = {
      ...(dto.externalCampaignName !== undefined && {
        externalCampaignName: dto.externalCampaignName,
      }),
      ...(dto.objective !== undefined && { objective: dto.objective }),
      ...(dto.contentId !== undefined && { contentId: dto.contentId }),
      ...(dto.startDate !== undefined && { startDate: new Date(dto.startDate) }),
      ...(dto.endDate !== undefined && { endDate: new Date(dto.endDate) }),
      ...(dto.plannedBudget !== undefined && {
        plannedBudget: new Prisma.Decimal(dto.plannedBudget),
      }),
      ...(dto.currency !== undefined && { currency: assertPaidSupportedCurrency(dto.currency) }),
      ...(dto.status !== undefined && { status: dto.status }),
    };

    const campaign = await this.prisma.adCampaign.update({ where: { id }, data });

    this.auditLog.record({
      actor: userId,
      action: 'ad_campaign_updated',
      result: 'success',
      meta: { campaignId: id, changedFields: Object.keys(data) },
    });

    return campaign;
  }

  async retire(id: string, userId: string): Promise<AdCampaign> {
    await this.findOrThrow(id);

    const campaign = await this.prisma.adCampaign.update({
      where: { id },
      data: { isActive: false, retiredAt: new Date() },
    });

    this.auditLog.record({
      actor: userId,
      action: 'ad_campaign_retired',
      result: 'success',
      meta: { campaignId: id },
    });

    return campaign;
  }

  async list(query: ListPaidCampaignsQueryDto): Promise<AdCampaign[]> {
    const where: Prisma.AdCampaignWhereInput = {
      ...(query.isActive !== undefined && { isActive: query.isActive }),
      ...(query.contentId && { contentId: query.contentId }),
      ...(query.q && {
        externalCampaignName: { contains: query.q, mode: Prisma.QueryMode.insensitive },
      }),
    };

    return this.prisma.adCampaign.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  async findOrThrow(id: string): Promise<AdCampaign> {
    const campaign = await this.prisma.adCampaign.findUnique({ where: { id } });
    if (!campaign) {
      throw new NotFoundException('Ad campaign not found');
    }
    return campaign;
  }

  /** Translates the UNIQUE(channel, externalCampaignId) violation into a 409. */
  private async createOrConflict(
    data: Prisma.AdCampaignUncheckedCreateInput,
    channel: string,
    externalCampaignId: string | undefined,
  ): Promise<AdCampaign> {
    try {
      return await this.prisma.adCampaign.create({ data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          `A ${channel} campaign with external id "${externalCampaignId}" already exists.`,
        );
      }
      throw error;
    }
  }
}

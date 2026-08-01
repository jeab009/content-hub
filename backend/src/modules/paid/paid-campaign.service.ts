import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

    const startDate = new Date(dto.startDate);
    const endDate = dto.endDate ? new Date(dto.endDate) : null;
    // BUG-7A-01: this must reject BEFORE reaching Postgres, mirroring the
    // P2002-to-409 translation below — the DB CHECK
    // (ad_campaigns_date_range_chk) already stops the bad row, but a raw
    // PrismaClientUnknownRequestError surfaced as an opaque 500 instead of
    // naming the field, the exact failure mode this codebase already knows
    // how to avoid one line away.
    this.assertValidDateRange(startDate, endDate);

    const campaign = await this.createOrConflict(
      {
        channel: dto.channel,
        externalCampaignName: dto.externalCampaignName,
        externalCampaignId: dto.externalCampaignId ?? null,
        objective: dto.objective,
        contentId: dto.contentId ?? null,
        startDate,
        endDate,
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
    const existing = await this.findOrThrow(id);
    if (dto.contentId) {
      await this.content.findOne(dto.contentId);
    }

    // BUG-7A-01: a partial update can change either boundary alone, so the
    // check must run against the EFFECTIVE range (existing value merged with
    // whichever field this request overrides), not just the two incoming
    // fields in isolation — an update that only sends a new `endDate` must
    // still be checked against the campaign's existing `startDate`.
    const effectiveStartDate = dto.startDate ? new Date(dto.startDate) : existing.startDate;
    const effectiveEndDate =
      dto.endDate !== undefined ? (dto.endDate ? new Date(dto.endDate) : null) : existing.endDate;
    this.assertValidDateRange(effectiveStartDate, effectiveEndDate);

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

  /**
   * BUG-7A-01: reject `endDate < startDate` with a clean 400 before it ever
   * reaches the DB CHECK (`ad_campaigns_date_range_chk`). A `null` endDate
   * ("still running", design §1.2) always passes — mirrors the DB CHECK's
   * own `end_date IS NULL OR end_date >= start_date` shape exactly, so the
   * two can never disagree.
   */
  private assertValidDateRange(startDate: Date, endDate: Date | null): void {
    if (endDate !== null && endDate < startDate) {
      throw new BadRequestException(
        `endDate (${endDate.toISOString().slice(0, 10)}) must not be before startDate ` +
          `(${startDate.toISOString().slice(0, 10)}).`,
      );
    }
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

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdPerformanceEntry, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { assertValidDateRange } from '../../common/utils/date-range.util';
import { PaidCampaignService } from './paid-campaign.service';
import { assertPaidSourceRefShape } from './paid-source-ref.util';
import { assertPaidSupportedCurrency } from './paid-currency.util';
import {
  PAID_DEFAULT_CURRENCY,
  PAID_PERFORMANCE_ENTRY_IDEMPOTENCY_WINDOW_MS,
} from './paid.constants';
import { CreatePerformanceEntryDto } from './dto/create-performance-entry.dto';
import { PerformanceOverlapCheckQueryDto } from './dto/performance-overlap-check-query.dto';

/**
 * Ad performance entries (design §3.1/3.2, WBS 7A.2) — APPEND-ONLY. `POST`
 * adds a row; `GET` reads history newest-first. There is deliberately NO
 * update/remove method here and no PATCH/DELETE route on the controller — a
 * route-absence HTTP test proves it. A data-entry correction is always a
 * NEW row naming the row it corrects via `correctsEntryId` — never a
 * reversal/negative-amount mechanic (System Analyst SA-P2): ad spend has no
 * real-world refund event the way a commission chargeback does.
 */
@Injectable()
export class PaidPerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly campaigns: PaidCampaignService,
  ) {}

  async addEntry(
    campaignId: string,
    dto: CreatePerformanceEntryDto,
    userId: string,
  ): Promise<AdPerformanceEntry> {
    await this.campaigns.findOrThrow(campaignId);

    // P-A1: enforced HERE, in the service — not only the DTO's redundant
    // @Matches — so the rule also covers any future adapter-fed (7D) path.
    assertPaidSourceRefShape(dto.sourceRef);
    const currency = assertPaidSupportedCurrency(dto.currency ?? PAID_DEFAULT_CURRENCY);

    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    // BUG-7B-01: the exact same missing-guard shape as BUG-7A-01
    // (paid-campaign.service.ts's date-range guard), reintroduced on this
    // sibling field pair — the DB CHECK (ad_performance_entries_period_chk)
    // already stops the bad row, but without this the client-only gate
    // (canSubmitPerformanceEntry in paid-logic.ts) was the only thing
    // preventing an opaque 500 on any direct API call. Both boundaries are
    // always required here (unlike a campaign's optional endDate), so
    // equality is the only permitted edge.
    assertValidDateRange(periodStart, periodEnd, { start: 'periodStart', end: 'periodEnd' });

    await this.assertNotDuplicateWithinWindow(campaignId, dto, userId, currency);
    await this.assertCorrectionTargetIsSameCampaign(campaignId, dto.correctsEntryId);

    const entry = await this.prisma.adPerformanceEntry.create({
      data: {
        campaignId,
        periodStart,
        periodEnd,
        spend: new Prisma.Decimal(dto.spend),
        reach: dto.reach ?? null,
        impressions: dto.impressions ?? null,
        clicks: dto.clicks ?? null,
        resultType: dto.resultType ?? null,
        resultCount: dto.resultCount ?? null,
        currency,
        sourceRef: dto.sourceRef ?? null,
        correctsEntryId: dto.correctsEntryId ?? null,
        recordedBy: userId,
      },
    });

    this.auditLog.record({
      actor: userId,
      action: 'ad_performance_entry_added',
      result: 'success',
      // sourceRef is EXCLUDED (System Analyst SA-P4 exclusion list — the
      // highest-residual-PII field in the paid schema).
      meta: {
        entryId: entry.id,
        campaignId,
        spend: dto.spend,
        isCorrection: dto.correctsEntryId !== undefined,
      },
    });

    return entry;
  }

  /** Newest first — append-only history, per the endpoint's design contract. */
  async list(campaignId: string): Promise<AdPerformanceEntry[]> {
    await this.campaigns.findOrThrow(campaignId);
    return this.prisma.adPerformanceEntry.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Warn-only overlap probe for the entry form (R8's mitigation, which does
   * NOT catch a double-submit — see `assertNotDuplicateWithinWindow` for
   * that). Never throws.
   */
  async checkOverlap(
    campaignId: string,
    query: PerformanceOverlapCheckQueryDto,
  ): Promise<AdPerformanceEntry[]> {
    await this.campaigns.findOrThrow(campaignId);
    return this.prisma.adPerformanceEntry.findMany({
      where: {
        campaignId,
        periodStart: { lte: new Date(query.periodEnd) },
        periodEnd: { gte: new Date(query.periodStart) },
      },
      orderBy: { periodStart: 'asc' },
    });
  }

  /**
   * System Analyst §4.2 finding (condition 9, blocking 7A): the real
   * double-submit trigger is a byte-identical retry within a short window,
   * not a genuinely new statement line for the same period. Reject it with
   * 409 rather than silently appending a second row that only a
   * `correctsEntryId` row could ever correct — more friction than the
   * double-submission that caused it. Mirrors
   * `CommerceConversionService.assertNotDuplicateWithinWindow` exactly,
   * including the window constant's shape
   * (`PAID_PERFORMANCE_ENTRY_IDEMPOTENCY_WINDOW_MS`).
   */
  private async assertNotDuplicateWithinWindow(
    campaignId: string,
    dto: CreatePerformanceEntryDto,
    userId: string,
    currency: string,
  ): Promise<void> {
    const since = new Date(Date.now() - PAID_PERFORMANCE_ENTRY_IDEMPOTENCY_WINDOW_MS);
    const duplicate = await this.prisma.adPerformanceEntry.findFirst({
      where: {
        campaignId,
        recordedBy: userId,
        createdAt: { gte: since },
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
        spend: new Prisma.Decimal(dto.spend),
        reach: dto.reach ?? null,
        impressions: dto.impressions ?? null,
        clicks: dto.clicks ?? null,
        resultType: dto.resultType ?? null,
        resultCount: dto.resultCount ?? null,
        currency,
        sourceRef: dto.sourceRef ?? null,
        correctsEntryId: dto.correctsEntryId ?? null,
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new ConflictException(
        `An identical performance entry was already recorded ` +
          `${PAID_PERFORMANCE_ENTRY_IDEMPOTENCY_WINDOW_MS / 1000}s ago (id ${duplicate.id}). ` +
          'If this is a genuinely new line, wait a moment and resubmit.',
      );
    }
  }

  /**
   * System Analyst condition P-A3: `CHECK (corrects_entry_id <> id)` at the
   * DB level only prevents SELF-reference (and is structurally unreachable
   * from this create path anyway, since `id` does not exist until after the
   * insert). The service must additionally validate that the corrected
   * entry belongs to the SAME campaign — without this, a correction could
   * silently point at an entry under a different campaign, which the read
   * model would then attribute to the wrong campaign's history. Mirrors
   * `CommerceConversionService.loadAndValidateReversalTarget`.
   */
  private async assertCorrectionTargetIsSameCampaign(
    campaignId: string,
    correctsEntryId: string | undefined,
  ): Promise<void> {
    if (!correctsEntryId) {
      return;
    }

    const target = await this.prisma.adPerformanceEntry.findUnique({
      where: { id: correctsEntryId },
    });
    if (!target) {
      throw new NotFoundException('The performance entry this row corrects was not found');
    }
    if (target.campaignId !== campaignId) {
      throw new BadRequestException(
        `correctsEntryId ${correctsEntryId} belongs to campaign ${target.campaignId}, not ` +
          `${campaignId} — a correction must reference an entry on the same campaign.`,
      );
    }
  }
}

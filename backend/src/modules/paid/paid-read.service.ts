import { Injectable } from '@nestjs/common';
import { AdPerformanceEntry, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaidSummaryQueryDto } from './dto/paid-summary-query.dto';
import {
  PaidCampaignBreakdownItem,
  PaidCurrencyTotal,
  PaidResultTypeBreakdownItem,
  PaidSummaryDto,
} from './dto/paid-summary-response.dto';

/**
 * Paid read model (design §3.1/3.2, WBS 7A.3). Reads `ad_performance_entries`
 * (joined only to `ad_campaigns`, WITHIN the paid namespace) ONLY — enforced
 * mechanically by the static boundary scan
 * (`src/testing/separation/commerce-boundary.spec.ts`), which fails CI on an
 * accidental `metrics`/`ranking_scores`/`commerce_*` reference anywhere
 * under `modules/paid`.
 *
 * SA-P6/NFR-7.10: every total is grouped BY CURRENCY, never summed across
 * currencies — see `PaidCurrencyTotal`'s docblock. SA-P5: `plannedBudget`
 * never appears here and is never computed against `totalSpend` — it is
 * indicative-only display data on the campaign record itself, never a field
 * this read model touches.
 */
@Injectable()
export class PaidReadService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(query: PaidSummaryQueryDto, now: Date = new Date()): Promise<PaidSummaryDto> {
    const entries = await this.entriesFor(query);

    return {
      generatedAt: now,
      totals: this.byCurrency(entries),
      byCampaign: this.byCampaign(entries),
      byResultType: this.byResultType(entries),
    };
  }

  private async entriesFor(query: PaidSummaryQueryDto): Promise<AdPerformanceEntry[]> {
    const where: Prisma.AdPerformanceEntryWhereInput = {
      ...(query.campaignId && { campaignId: query.campaignId }),
      ...(query.periodStart && { periodStart: { gte: new Date(query.periodStart) } }),
      ...(query.periodEnd && { periodEnd: { lte: new Date(query.periodEnd) } }),
    };

    if (query.contentId) {
      // The one join this read model performs — WITHIN the paid namespace
      // (ad_performance_entries -> ad_campaigns), never a cross-boundary
      // `include`. There is no Prisma relation from AdCampaign into Content
      // (Layer 1), so this is a plain two-step id lookup, the sanctioned
      // pattern CommerceReadService also uses for its content-scoped views.
      const campaignIds = await this.prisma.adCampaign.findMany({
        where: { contentId: query.contentId },
        select: { id: true },
      });
      return this.prisma.adPerformanceEntry.findMany({
        where: { ...where, campaignId: { in: campaignIds.map((campaign) => campaign.id) } },
      });
    }

    return this.prisma.adPerformanceEntry.findMany({ where });
  }

  /** The one grouping every breakdown below shares: never cross a currency boundary. */
  private byCurrency(entries: AdPerformanceEntry[]): PaidCurrencyTotal[] {
    const groups = new Map<string, PaidCurrencyTotal>();
    for (const entry of entries) {
      this.accumulate(groups, entry.currency, entry);
    }
    return [...groups.values()];
  }

  private byCampaign(entries: AdPerformanceEntry[]): PaidCampaignBreakdownItem[] {
    const groups = new Map<string, PaidCampaignBreakdownItem>();
    for (const entry of entries) {
      const key = `${entry.campaignId}::${entry.currency}`;
      this.accumulate(groups, key, entry, { campaignId: entry.campaignId });
    }
    return [...groups.values()];
  }

  private byResultType(entries: AdPerformanceEntry[]): PaidResultTypeBreakdownItem[] {
    const groups = new Map<string, PaidResultTypeBreakdownItem>();
    for (const entry of entries) {
      const key = `${entry.resultType ?? 'unlabelled'}::${entry.currency}`;
      this.accumulate(groups, key, entry, { resultType: entry.resultType });
    }
    return [...groups.values()];
  }

  /**
   * Shared accumulator: adds one entry into the group named `key`, creating
   * it from `seed` (plus a fresh zeroed `PaidCurrencyTotal`) on first sight.
   * Generic over the breakdown item shape so byCampaign/byResultType share
   * one summation path — the arithmetic (and the currency-grouping
   * discipline) cannot drift between them. Mirrors
   * `CommerceReadService.accumulate` exactly.
   */
  private accumulate<T extends PaidCurrencyTotal>(
    groups: Map<string, T>,
    key: string,
    entry: AdPerformanceEntry,
    seed?: Omit<T, keyof PaidCurrencyTotal>,
  ): void {
    const existing =
      groups.get(key) ??
      ({
        currency: entry.currency,
        totalSpend: 0,
        totalReach: 0,
        totalImpressions: 0,
        totalClicks: 0,
        totalResultCount: 0,
        entriesCount: 0,
        ...seed,
      } as T);

    existing.totalSpend = round2(existing.totalSpend + Number(entry.spend));
    existing.totalReach += entry.reach ?? 0;
    existing.totalImpressions += entry.impressions ?? 0;
    existing.totalClicks += entry.clicks ?? 0;
    existing.totalResultCount += entry.resultCount ?? 0;
    existing.entriesCount += 1;

    groups.set(key, existing);
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

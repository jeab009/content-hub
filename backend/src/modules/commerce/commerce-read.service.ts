import { Injectable, NotFoundException } from '@nestjs/common';
import { CommerceConversion, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CommerceSummaryQueryDto } from './dto/commerce-summary-query.dto';
import {
  CommerceChannelBreakdownItem,
  CommerceCurrencyTotal,
  CommercePeriodBreakdownItem,
  CommerceProductBreakdownItem,
  CommerceSummaryDto,
  ContentCommerceSummaryDto,
} from './dto/commerce-summary-response.dto';
import { CommercePlacementResponseDto } from './dto/commerce-placement-response.dto';
import { CommerceConversionResponseDto } from './dto/commerce-conversion-response.dto';

const ISO_DATE_LENGTH = 10;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, ISO_DATE_LENGTH);
}

/**
 * Commerce read model (6A.8). Reads `commerce_conversions` and
 * `commerce_placements` ONLY — enforced mechanically by the static boundary
 * scan (`src/testing/separation/commerce-boundary.spec.ts`), which fails CI
 * on an accidental `metrics`/`ranking_scores` reference anywhere under
 * `modules/commerce`. Reading `Post`/`Content` directly (not via a commerce
 * relation — there is none, Layer 1) is the sanctioned two-step join
 * pattern the architecture doc names for exactly this case.
 *
 * SA-9: every total is grouped BY CURRENCY, never summed across currencies —
 * see `CommerceCurrencyTotal`'s docblock.
 */
@Injectable()
export class CommerceReadService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(
    query: CommerceSummaryQueryDto,
    now: Date = new Date(),
  ): Promise<CommerceSummaryDto> {
    const conversions = await this.prisma.commerceConversion.findMany({
      where: this.summaryWhere(query),
    });

    return {
      generatedAt: now,
      totals: this.byCurrency(conversions),
      byChannel: this.byChannel(conversions),
      byProduct: this.byProduct(conversions),
      byPeriod: this.byPeriod(conversions),
    };
  }

  /**
   * Per-content commerce (6A.8): this content's own placements, plus every
   * conversion attributed to one of those placements OR to one of this
   * content's posts. A content with no commerce activity yet returns empty
   * arrays and zero totals rather than 404 — "no commerce recorded" is a
   * normal state, same posture as `DashboardService.contentRevenue`.
   */
  async contentSummary(
    contentId: string,
    now: Date = new Date(),
  ): Promise<ContentCommerceSummaryDto> {
    await this.assertContentExists(contentId);

    const placements = await this.prisma.commercePlacement.findMany({
      where: { contentId },
      orderBy: { placedAt: 'desc' },
    });
    const placementIds = placements.map((placement) => placement.id);
    const postIds = await this.postIdsForContent(contentId);

    const conversions = await this.conversionsForTargets(placementIds, postIds);

    return {
      generatedAt: now,
      contentId,
      totals: this.byCurrency(conversions),
      placements: placements.map(CommercePlacementResponseDto.fromEntity),
      conversions: conversions.map(CommerceConversionResponseDto.fromEntity),
    };
  }

  private summaryWhere(query: CommerceSummaryQueryDto): Prisma.CommerceConversionWhereInput {
    return {
      ...(query.channel && { channel: query.channel }),
      ...(query.productId && { productId: query.productId }),
      ...(query.periodStart && { periodStart: { gte: new Date(query.periodStart) } }),
      ...(query.periodEnd && { periodEnd: { lte: new Date(query.periodEnd) } }),
    };
  }

  private async postIdsForContent(contentId: string): Promise<string[]> {
    const posts = await this.prisma.post.findMany({ where: { contentId }, select: { id: true } });
    return posts.map((post) => post.id);
  }

  private async conversionsForTargets(
    placementIds: string[],
    postIds: string[],
  ): Promise<CommerceConversion[]> {
    if (placementIds.length === 0 && postIds.length === 0) {
      return [];
    }
    return this.prisma.commerceConversion.findMany({
      where: {
        OR: [
          ...(placementIds.length > 0 ? [{ placementId: { in: placementIds } }] : []),
          ...(postIds.length > 0 ? [{ postId: { in: postIds } }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async assertContentExists(contentId: string): Promise<void> {
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
      select: { id: true },
    });
    if (!content) {
      throw new NotFoundException('Content not found');
    }
  }

  /** The one grouping every breakdown below shares: never cross a currency boundary. */
  private byCurrency(conversions: CommerceConversion[]): CommerceCurrencyTotal[] {
    const groups = new Map<string, CommerceCurrencyTotal>();
    for (const conversion of conversions) {
      this.accumulate(groups, conversion.currency, conversion);
    }
    return [...groups.values()];
  }

  private byChannel(conversions: CommerceConversion[]): CommerceChannelBreakdownItem[] {
    const groups = new Map<string, CommerceChannelBreakdownItem>();
    for (const conversion of conversions) {
      const key = `${conversion.channel}::${conversion.currency}`;
      this.accumulate(groups, key, conversion, { channel: conversion.channel });
    }
    return [...groups.values()];
  }

  private byProduct(conversions: CommerceConversion[]): CommerceProductBreakdownItem[] {
    const groups = new Map<string, CommerceProductBreakdownItem>();
    for (const conversion of conversions) {
      const key = `${conversion.productId ?? 'unattributed'}::${conversion.currency}`;
      this.accumulate(groups, key, conversion, { productId: conversion.productId });
    }
    return [...groups.values()];
  }

  private byPeriod(conversions: CommerceConversion[]): CommercePeriodBreakdownItem[] {
    const groups = new Map<string, CommercePeriodBreakdownItem>();
    for (const conversion of conversions) {
      const periodStart = isoDate(conversion.periodStart);
      const periodEnd = isoDate(conversion.periodEnd);
      const key = `${periodStart}::${periodEnd}::${conversion.currency}`;
      this.accumulate(groups, key, conversion, { periodStart, periodEnd });
    }
    return [...groups.values()];
  }

  /**
   * Shared accumulator: adds one conversion row into the group named `key`,
   * creating it from `seed` (plus a fresh zeroed `CommerceCurrencyTotal`) on
   * first sight. Generic over the breakdown item shape so byChannel/
   * byProduct/byPeriod share one summation path — the arithmetic (and the
   * currency-grouping discipline) cannot drift between them.
   */
  private accumulate<T extends CommerceCurrencyTotal>(
    groups: Map<string, T>,
    key: string,
    conversion: CommerceConversion,
    seed?: Omit<T, keyof CommerceCurrencyTotal>,
  ): void {
    const existing =
      groups.get(key) ??
      ({
        currency: conversion.currency,
        commissionAmount: 0,
        grossSalesAmount: 0,
        ordersCount: 0,
        itemsSold: 0,
        conversionRecords: 0,
        ...seed,
      } as T);

    existing.commissionAmount = round2(
      existing.commissionAmount + Number(conversion.commissionAmount),
    );
    existing.grossSalesAmount = round2(
      existing.grossSalesAmount +
        (conversion.grossSalesAmount ? Number(conversion.grossSalesAmount) : 0),
    );
    existing.ordersCount += conversion.ordersCount ?? 0;
    existing.itemsSold += conversion.itemsSold ?? 0;
    existing.conversionRecords += 1;

    groups.set(key, existing);
  }
}

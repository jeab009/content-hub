import { CommerceChannel } from '@prisma/client';
import { CommercePlacementResponseDto } from './commerce-placement-response.dto';
import { CommerceConversionResponseDto } from './commerce-conversion-response.dto';

/**
 * One currency's aggregate. System Analyst SA-9: the commerce summary must
 * NEVER produce a scalar grand total across currencies, even after the v1
 * THB-only guard is later relaxed — so totals are always an ARRAY of
 * per-currency groups, never a single flat object. A fixture with a THB row
 * and a non-THB row must yield two groups here, not one summed number
 * (NFR-6.12).
 *
 * Field names are deliberately commission/gross-sales/orders/items —
 * DISJOINT from the payout vocabulary (`revenue`, `reach`, `engagement`),
 * per the Layer 5 vocabulary separation (design §2.5). No key here is ever
 * named `revenue`; enforced by `commerce-vocabulary-freeze.spec.ts`.
 */
export interface CommerceCurrencyTotal {
  currency: string;
  commissionAmount: number;
  grossSalesAmount: number;
  ordersCount: number;
  itemsSold: number;
  conversionRecords: number;
}

export interface CommerceChannelBreakdownItem extends CommerceCurrencyTotal {
  channel: CommerceChannel;
}

/** `productId: null` buckets every unattributed conversion — a normal, expected case. */
export interface CommerceProductBreakdownItem extends CommerceCurrencyTotal {
  productId: string | null;
}

/** One statement period (the exact periodStart/periodEnd pair conversions were entered under). */
export interface CommercePeriodBreakdownItem extends CommerceCurrencyTotal {
  periodStart: string;
  periodEnd: string;
}

/** GET /api/commerce/summary — reads `commerce_conversions` ONLY. */
export class CommerceSummaryDto {
  generatedAt!: Date;
  totals!: CommerceCurrencyTotal[];
  byChannel!: CommerceChannelBreakdownItem[];
  byProduct!: CommerceProductBreakdownItem[];
  byPeriod!: CommercePeriodBreakdownItem[];
}

/**
 * GET /api/commerce/summary/:contentId — this content's placements and the
 * conversions attributed to them (via `placementId`) or to its posts (via
 * `postId`). Rendered on placement/post detail (6B), NOT on the payout
 * dashboard's `/dashboard/revenue/[contentId]` this phase (design B7).
 */
export class ContentCommerceSummaryDto {
  generatedAt!: Date;
  contentId!: string;
  totals!: CommerceCurrencyTotal[];
  placements!: CommercePlacementResponseDto[];
  conversions!: CommerceConversionResponseDto[];
}

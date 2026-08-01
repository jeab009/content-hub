/**
 * One currency's aggregate. System Analyst SA-P6/NFR-7.10: the paid summary
 * must NEVER produce a scalar grand total across currencies, even after the
 * v1 THB-only guard is later relaxed — so totals are always an ARRAY of
 * per-currency groups, never a single flat object, mirroring Commerce's
 * `CommerceCurrencyTotal` (SA-9) exactly.
 *
 * Field names are deliberately `total*`/`entriesCount` — DISJOINT from both
 * the payout vocabulary (`revenue`, `reach` as a bare payout field, `engagement`)
 * and the commerce vocabulary (`commissionAmount`, `grossSalesAmount`), per
 * the Layer 5 vocabulary separation (design §2.5, §3.4). No key here is ever
 * named `revenue` or `commissionAmount` — enforced by
 * `commerce-vocabulary-freeze.spec.ts`.
 */
export interface PaidCurrencyTotal {
  currency: string;
  totalSpend: number;
  totalReach: number;
  totalImpressions: number;
  totalClicks: number;
  totalResultCount: number;
  entriesCount: number;
}

export interface PaidCampaignBreakdownItem extends PaidCurrencyTotal {
  campaignId: string;
}

/** `resultType: null` buckets every entry logged with no result label yet — a normal, expected case. */
export interface PaidResultTypeBreakdownItem extends PaidCurrencyTotal {
  resultType: string | null;
}

/**
 * GET /api/paid/summary — reads `ad_performance_entries`/`ad_campaigns`
 * ONLY (design §3.2). `plannedBudget` never appears here and is never
 * reconciled against `totalSpend` anywhere in this module (System Analyst
 * SA-P5) — it is indicative-only display data on the campaign record itself.
 */
export class PaidSummaryDto {
  generatedAt!: Date;
  totals!: PaidCurrencyTotal[];
  byCampaign!: PaidCampaignBreakdownItem[];
  byResultType!: PaidResultTypeBreakdownItem[];
}

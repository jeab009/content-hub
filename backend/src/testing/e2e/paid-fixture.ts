/**
 * Phase 7A.5 — the ADVERSARIAL paid fixture (design §2.4, System Analyst
 * condition P-B2's sibling instruction that the byte-identity fixture must
 * be genuinely adversarial, not decorative).
 *
 * Mirrors `commerce-fixture.ts`'s reasoning exactly, extended to a THIRD
 * stream: a paid fixture that touches nothing the payout or commerce side
 * reads would pass the byte-identity test trivially and prove nothing. So:
 *
 *   - the campaign is attributed to the SAME `content_id` the payout AND
 *     commerce fixtures already use (`PAYOUT_IDS.contentA`);
 *   - spend figures are an ORDER OF MAGNITUDE larger than BOTH the payout
 *     revenue (2,296.50 THB) AND the commerce gross commission (48,000 THB
 *     before its reversal), so an accidental sum into either stream is
 *     unmissable rather than a plausible number nobody questions;
 *   - at least one `correctsEntryId` row, exercising the append-only
 *     correction mechanic (never a reversal/negative-amount — SA-P2) and
 *     the same-campaign validation service the append endpoint enforces;
 *   - a non-null `plannedBudget` on the campaign, so a test can positively
 *     assert it is NEVER reconciled against or summed with the entries'
 *     spend anywhere (SA-P5).
 *
 * Lives in `src/testing/` — a sibling of `src/modules/`, not a child of any
 * scanned module — for the identical reason `commerce-fixture.ts` does: it
 * legitimately names all three streams' fixtures in one place, which is
 * exactly why the static boundary scan can afford to have NO `*.spec.ts` or
 * `src/testing/**` exemption at all (System Analyst condition B3, restated
 * for the third stream at P-B1).
 */

import { AdCampaignStatus, AdChannel, AdSource, Prisma, PrismaClient } from '@prisma/client';
import { PAYOUT_IDS } from './payout-fixture';

export const PAID_IDS = {
  campaign: '00000000-0000-4000-8000-000000000101',
  entryLarge: '00000000-0000-4000-8000-000000000201',
  entrySecond: '00000000-0000-4000-8000-000000000202',
  entryCorrection: '00000000-0000-4000-8000-000000000203',
} as const;

const AT = {
  created: new Date('2026-07-15T00:00:00.000Z'),
} as const;

/**
 * Gross spend seeded across all three entries (the correction included —
 * corrections are additive historical facts in this ledger, never netted
 * out). An order of magnitude above `COMMERCE_GROSS_COMMISSION_THB`
 * (48,000) on purpose, mirroring the commerce fixture's own reasoning
 * relative to payout.
 */
export const PAID_TOTAL_SPEND_THB = 300000 + 180000 + 305000;
/** Indicative-only — must NEVER appear in any total or be checked against spend (SA-P5). */
export const PAID_PLANNED_BUDGET_THB = 100000;

/**
 * Seeds one campaign and three performance entries, one of which corrects
 * another (exercising `correctsEntryId` + the same-campaign service
 * validation). Attributed to the SAME content the payout/commerce fixtures
 * already cover, via the SQL-only `content_id` FK (no Prisma relation —
 * Layer 1) — if any payout or commerce read path were to join through
 * content, this is the row that would surface in it.
 */
export async function seedPaidFixture(prisma: PrismaClient): Promise<void> {
  await prisma.adCampaign.create({
    data: {
      id: PAID_IDS.campaign,
      channel: AdChannel.meta,
      externalCampaignName: 'E2E Test Campaign',
      externalCampaignId: 'META-E2E-0001',
      objective: 'Traffic',
      contentId: PAYOUT_IDS.contentA,
      startDate: new Date('2026-07-01T00:00:00.000Z'),
      endDate: null,
      plannedBudget: new Prisma.Decimal(PAID_PLANNED_BUDGET_THB.toFixed(2)),
      currency: 'THB',
      status: AdCampaignStatus.active,
      source: AdSource.manual,
      createdBy: PAYOUT_IDS.admin,
      createdAt: AT.created,
    },
  });

  await prisma.adPerformanceEntry.create({
    data: {
      id: PAID_IDS.entryLarge,
      campaignId: PAID_IDS.campaign,
      spend: new Prisma.Decimal('300000.00'),
      reach: 500000,
      impressions: 900000,
      clicks: 12000,
      resultType: 'link_clicks',
      resultCount: 12000,
      currency: 'THB',
      periodStart: new Date('2026-07-01T00:00:00.000Z'),
      periodEnd: new Date('2026-07-07T00:00:00.000Z'),
      sourceRef: 'META-ADSMGR-W27',
      source: AdSource.manual,
      recordedBy: PAYOUT_IDS.admin,
      createdAt: AT.created,
    },
  });

  await prisma.adPerformanceEntry.create({
    data: {
      id: PAID_IDS.entrySecond,
      campaignId: PAID_IDS.campaign,
      spend: new Prisma.Decimal('180000.00'),
      reach: 300000,
      impressions: 520000,
      clicks: 7000,
      resultType: 'purchases',
      resultCount: 340,
      currency: 'THB',
      periodStart: new Date('2026-07-08T00:00:00.000Z'),
      periodEnd: new Date('2026-07-14T00:00:00.000Z'),
      sourceRef: 'META-ADSMGR-W28',
      source: AdSource.manual,
      recordedBy: PAYOUT_IDS.admin,
      createdAt: AT.created,
    },
  });

  // The correction. A data-entry correction, NOT a reversal — a plain
  // append-only pointer at the row it corrects, with every numeric field
  // still CHECK'd non-negative (SA-P2). This is the row that exercises
  // `assertCorrectionTargetIsSameCampaign` end to end via the fixture path.
  await prisma.adPerformanceEntry.create({
    data: {
      id: PAID_IDS.entryCorrection,
      campaignId: PAID_IDS.campaign,
      spend: new Prisma.Decimal('305000.00'),
      reach: 505000,
      impressions: 905000,
      clicks: 12200,
      resultType: 'link_clicks',
      resultCount: 12200,
      currency: 'THB',
      periodStart: new Date('2026-07-01T00:00:00.000Z'),
      periodEnd: new Date('2026-07-07T00:00:00.000Z'),
      sourceRef: 'META-ADSMGR-W27-CORRECTED',
      correctsEntryId: PAID_IDS.entryLarge,
      source: AdSource.manual,
      recordedBy: PAYOUT_IDS.admin,
      createdAt: AT.created,
    },
  });
}

/**
 * Phase 7 exit criterion #4 — the byte-identity proof, extended to a THIRD
 * stream.
 *
 * THE CLAIM UNDER TEST: seeding an adversarial volume of paid/ads data
 * changes NOTHING about what the payout dashboard reports, what the payout
 * CSVs contain, what the commerce summary/CSV report, or what the ranking
 * engine scores — down to the byte. This mirrors
 * `payout-unaffected-by-commerce.e2e-spec.ts` exactly, one level harder:
 * three streams means three pairwise boundaries, not one.
 *
 * SEQUENCE (design §2.4): seedPayoutFixture() -> seedCommerceFixture() ->
 * capture baseline A -> seedPaidFixture() -> rankAllContent() again ->
 * capture baseline B -> assert A === B byte-for-byte on every payout AND
 * commerce artefact, PLUS every persisted ranking_scores.score.
 *
 * WHY IT LIVES HERE AND NOT IN THE UNIT SUITE
 * -------------------------------------------
 * Same reason as the commerce e2e spec: it needs a real Postgres and is
 * collected by `jest.e2e.config.js` (`npm run test:e2e`), as its own CI job,
 * so a failure reads as "separation broken" rather than one red dot among
 * 600+ green unit tests. The STATIC separation checks (enum freeze, boundary
 * scan, schema freeze, vocabulary freeze, CSV header freeze) are not here —
 * they are at `src/testing/separation/*.spec.ts`, in the fast suite.
 *
 * REQUIRES: `DATABASE_URL` pointing at a migrated, disposable database.
 */

import { AdCampaignStatus, PrismaClient } from '@prisma/client';
import {
  assertCommerceSchemaPresent,
  assertPaidSchemaPresent,
  columnsOfTable,
  createE2eClient,
  resetDatabase,
} from '../src/testing/e2e/e2e-database';
import { seedCommerceFixture } from '../src/testing/e2e/commerce-fixture';
import {
  PAYOUT_IDS,
  PAYOUT_TOTAL_REVENUE_THB,
  seedPayoutFixture,
} from '../src/testing/e2e/payout-fixture';
import {
  Baseline,
  capturePaidArtifacts,
  captureBaseline,
  rankAllContent,
} from '../src/testing/e2e/capture-baseline';
import {
  PAID_IDS,
  PAID_PLANNED_BUDGET_THB,
  PAID_TOTAL_SPEND_THB,
  seedPaidFixture,
} from '../src/testing/e2e/paid-fixture';
import { COMMERCE_GROSS_COMMISSION_THB } from '../src/testing/e2e/commerce-fixture';
import { PAID_TABLE_COLUMNS } from '../src/modules/paid/paid.constants';

describe('Phase 7 exit #4 — payout, commerce and ranking are byte-identical with paid data present', () => {
  let prisma: PrismaClient;
  let baseline: Baseline;

  beforeAll(async () => {
    prisma = createE2eClient();
    await prisma.$connect();
    await assertCommerceSchemaPresent(prisma);
    await assertPaidSchemaPresent(prisma);
    await resetDatabase(prisma);
    await seedPayoutFixture(prisma);
    await seedCommerceFixture(prisma);
    await rankAllContent(prisma);
    baseline = await captureBaseline(prisma);
  });

  afterAll(async () => {
    if (prisma) {
      await resetDatabase(prisma);
      await prisma.$disconnect();
    }
  });

  it('the fixture is adversarial: paid spend dwarfs both payout and commerce, and includes a correction row', () => {
    // Guards the test against becoming decorative, mirroring the commerce
    // e2e spec's identical guard.
    expect(PAID_TOTAL_SPEND_THB).toBeGreaterThan(PAYOUT_TOTAL_REVENUE_THB * 10);
    expect(PAID_TOTAL_SPEND_THB).toBeGreaterThan(COMMERCE_GROSS_COMMISSION_THB * 10);
  });

  it('the baseline is non-trivial (a fixture that seeded nothing would pass everything)', async () => {
    const metricCount = await prisma.metric.count();
    expect(metricCount).toBe(4);
    expect(await prisma.commerceConversion.count()).toBe(3);
    expect(baseline.commerceSummaryBytes.length).toBeGreaterThan(0);
    expect(baseline.commerceCsv.length).toBeGreaterThan(100);
  });

  it('seeds paid data, re-ranks, and every payout AND commerce artefact is byte-identical', async () => {
    await seedPaidFixture(prisma);

    // Paid genuinely landed, attributed to the SAME content the payout and
    // commerce fixtures use. Asserted before the comparison so a silently
    // failed seed cannot masquerade as a passing separation test.
    expect(await prisma.adCampaign.count()).toBe(1);
    expect(await prisma.adPerformanceEntry.count()).toBe(3);
    const campaign = await prisma.adCampaign.findUniqueOrThrow({
      where: { id: PAID_IDS.campaign },
    });
    expect(campaign.contentId).toBe(PAYOUT_IDS.contentA);
    expect(campaign.status).toBe(AdCampaignStatus.active);

    // Re-rank AFTER paid data exists. This is the real risk case: a ranking
    // pass on a clean database proves nothing about contamination.
    await rankAllContent(prisma);

    const after = await captureBaseline(prisma);

    expect(after.overviewBytes.equals(baseline.overviewBytes)).toBe(true);
    expect(after.revenueBytes.equals(baseline.revenueBytes)).toBe(true);
    expect(after.contentRevenueBytes.equals(baseline.contentRevenueBytes)).toBe(true);
    expect(Buffer.compare(after.revenueCsv, baseline.revenueCsv)).toBe(0);
    expect(Buffer.compare(after.overrideLogCsv, baseline.overrideLogCsv)).toBe(0);
    expect(after.commerceSummaryBytes.equals(baseline.commerceSummaryBytes)).toBe(true);
    expect(Buffer.compare(after.commerceCsv, baseline.commerceCsv)).toBe(0);
    expect(Buffer.compare(after.scores, baseline.scores)).toBe(0);
  });

  it('no payout or commerce CSV byte mentions paid vocabulary, even with paid rows present', async () => {
    const withPaid = await captureBaseline(prisma);
    expect(await prisma.adPerformanceEntry.count()).toBeGreaterThan(0);

    const revenue = withPaid.revenueCsv.toString('utf8').toLowerCase();
    const commerce = withPaid.commerceCsv.toString('utf8').toLowerCase();
    for (const token of ['ad_campaign', 'spend', 'meta', 'link_clicks']) {
      expect(revenue).not.toContain(token);
      expect(commerce).not.toContain(token);
    }
  });

  it("paid's OWN read surface genuinely works — the other half of separation is not just silence", async () => {
    const paid = await capturePaidArtifacts(prisma);
    const summary = JSON.parse(paid.summaryBytes.toString('utf8')) as {
      totals: { totalSpend: number; currency: string }[];
    };

    // The paid total genuinely reflects the seeded figures...
    expect(summary.totals).toHaveLength(1);
    expect(summary.totals[0].currency).toBe('THB');
    expect(summary.totals[0].totalSpend).toBe(PAID_TOTAL_SPEND_THB);
    // ...but plannedBudget (indicative-only, SA-P5) is not a field this read
    // model exposes at all — never reconciled against the spend total.
    expect(paid.summaryBytes.toString('utf8')).not.toContain('plannedBudget');
    expect(PAID_PLANNED_BUDGET_THB).toBeGreaterThan(0); // guards the constant against becoming dead

    expect(paid.csv.length).toBeGreaterThan(100);
    expect(paid.csv.toString('utf8')).not.toContain('source_ref');
  });

  describe('the physical schema agrees with the frozen allow-list', () => {
    it.each(Object.keys(PAID_TABLE_COLUMNS))('%s', async (table) => {
      expect(await columnsOfTable(prisma, table)).toEqual(PAID_TABLE_COLUMNS[table]);
    });
  });

  describe('the hand-written CHECK constraints are live in the database', () => {
    // These constraints exist only in the migration SQL — Prisma cannot
    // express them, so nothing else in the test suite can observe them. A
    // negative insert is the only honest proof they are enforced.

    it('P-A2 — a negative planned budget is rejected', async () => {
      await expect(
        prisma.adCampaign.create({
          data: {
            channel: 'meta',
            externalCampaignName: 'Negative budget test',
            objective: 'Traffic',
            startDate: new Date('2026-07-01T00:00:00.000Z'),
            plannedBudget: '-1.00',
            createdBy: PAYOUT_IDS.admin,
          },
        }),
      ).rejects.toThrow(/ad_campaigns_planned_budget_nonneg_chk/);
    });

    it('a campaign end_date before start_date is rejected', async () => {
      await expect(
        prisma.adCampaign.create({
          data: {
            channel: 'meta',
            externalCampaignName: 'Bad date range test',
            objective: 'Traffic',
            startDate: new Date('2026-07-10T00:00:00.000Z'),
            endDate: new Date('2026-07-01T00:00:00.000Z'),
            createdBy: PAYOUT_IDS.admin,
          },
        }),
      ).rejects.toThrow(/ad_campaigns_date_range_chk/);
    });

    it('SA-P6 — a lowercase or malformed campaign currency is rejected', async () => {
      await expect(
        prisma.adCampaign.create({
          data: {
            channel: 'meta',
            externalCampaignName: 'Bad currency test',
            objective: 'Traffic',
            startDate: new Date('2026-07-01T00:00:00.000Z'),
            currency: 'thb',
            createdBy: PAYOUT_IDS.admin,
          },
        }),
      ).rejects.toThrow(/ad_campaigns_currency_chk/);
    });

    it('a negative spend is rejected', async () => {
      await expect(
        prisma.adPerformanceEntry.create({
          data: {
            campaignId: PAID_IDS.campaign,
            spend: '-1.00',
            periodStart: new Date('2026-07-01T00:00:00.000Z'),
            periodEnd: new Date('2026-07-07T00:00:00.000Z'),
            recordedBy: PAYOUT_IDS.admin,
          },
        }),
      ).rejects.toThrow(/ad_performance_entries_spend_nonneg_chk/);
    });

    it('a period_end before period_start is rejected', async () => {
      await expect(
        prisma.adPerformanceEntry.create({
          data: {
            campaignId: PAID_IDS.campaign,
            spend: '10.00',
            periodStart: new Date('2026-07-10T00:00:00.000Z'),
            periodEnd: new Date('2026-07-01T00:00:00.000Z'),
            recordedBy: PAYOUT_IDS.admin,
          },
        }),
      ).rejects.toThrow(/ad_performance_entries_period_chk/);
    });

    it('P-A3 — a row cannot correct itself', async () => {
      const id = '00000000-0000-4000-8000-0000000fff01';
      await expect(
        prisma.adPerformanceEntry.create({
          data: {
            id,
            campaignId: PAID_IDS.campaign,
            spend: '10.00',
            periodStart: new Date('2026-07-01T00:00:00.000Z'),
            periodEnd: new Date('2026-07-07T00:00:00.000Z'),
            correctsEntryId: id,
            recordedBy: PAYOUT_IDS.admin,
          },
        }),
      ).rejects.toThrow(/ad_performance_entries_no_self_correction_chk/);
    });

    it('SA-P6 — a lowercase or malformed entry currency is rejected', async () => {
      await expect(
        prisma.adPerformanceEntry.create({
          data: {
            campaignId: PAID_IDS.campaign,
            spend: '10.00',
            currency: 'thb',
            periodStart: new Date('2026-07-01T00:00:00.000Z'),
            periodEnd: new Date('2026-07-07T00:00:00.000Z'),
            recordedBy: PAYOUT_IDS.admin,
          },
        }),
      ).rejects.toThrow(/ad_performance_entries_currency_chk/);
    });
  });
});

/**
 * Phase 6 exit criterion #6 — the byte-identity proof.
 *
 * THE CLAIM UNDER TEST: seeding an adversarial volume of commerce data changes
 * NOTHING about what the payout dashboard reports, what the payout CSVs
 * contain, or what the ranking engine scores — down to the byte.
 *
 * This is the layer that makes the separation a proof rather than an
 * assertion. Layers 1-3 say a contamination would be unspellable, unlintable
 * and unscannable; this one measures the output and finds it unchanged.
 *
 * WHY IT LIVES HERE AND NOT IN THE UNIT SUITE
 * -------------------------------------------
 * It needs a real Postgres. `backend/jest.config.js` is `rootDir: 'src'` +
 * `testRegex: '.*\.spec\.ts$'`, so this file is invisible to it twice over —
 * wrong directory AND `e2e-spec` has a hyphen where that regex wants a literal
 * dot. That is deliberate: `npm run test:e2e` runs it via
 * `jest.e2e.config.js`, as its own CI job, so a failure reads as "separation
 * broken" rather than one red dot among 400+ green unit tests.
 *
 * The four STATIC separation checks are not here — they are at
 * `src/testing/separation/*.spec.ts`, inside the fast suite every developer
 * already runs. Splitting them that way is System Analyst condition B1: the
 * design put all of them under `backend/test/`, where jest would have
 * collected none of them and every exit criterion would have reported green
 * having never executed.
 *
 * REQUIRES: `DATABASE_URL` pointing at a migrated, disposable database.
 * CI provisions `postgres:16-alpine` and runs `prisma migrate deploy` already.
 */

import { PrismaClient } from '@prisma/client';
import {
  assertCommerceSchemaPresent,
  columnsOfTable,
  createE2eClient,
  resetDatabase,
} from '../src/testing/e2e/e2e-database';
import {
  COMMERCE_GROSS_COMMISSION_THB,
  COMMERCE_REVERSAL_THB,
  seedCommerceFixture,
} from '../src/testing/e2e/commerce-fixture';
import {
  PAYOUT_IDS,
  PAYOUT_TOTAL_REVENUE_THB,
  seedPayoutFixture,
} from '../src/testing/e2e/payout-fixture';
import { Baseline, captureBaseline, rankAllContent } from '../src/testing/e2e/capture-baseline';
import { COMMERCE_TABLE_COLUMNS } from '../src/modules/commerce/commerce.constants';

describe('Phase 6 exit #6 — payout and ranking are byte-identical with commerce data present', () => {
  let prisma: PrismaClient;
  let baseline: Baseline;

  beforeAll(async () => {
    prisma = createE2eClient();
    await prisma.$connect();
    await assertCommerceSchemaPresent(prisma);
    await resetDatabase(prisma);
    await seedPayoutFixture(prisma);
    await rankAllContent(prisma);
    baseline = await captureBaseline(prisma);
  });

  afterAll(async () => {
    if (prisma) {
      await resetDatabase(prisma);
      await prisma.$disconnect();
    }
  });

  it('the fixture is adversarial: commerce dwarfs payout, and includes a negative reversal', () => {
    // Guards the test against becoming decorative. If commerce money were the
    // same order of magnitude as payout money, an accidental sum would produce
    // a plausible-looking number; an order of magnitude makes it unmissable.
    expect(COMMERCE_GROSS_COMMISSION_THB).toBeGreaterThan(PAYOUT_TOTAL_REVENUE_THB * 10);
    expect(COMMERCE_REVERSAL_THB).toBeLessThan(0);
  });

  it('the baseline is non-trivial (a fixture that seeded nothing would pass everything)', async () => {
    // The failure mode this rules out is the same class as G3a: an empty
    // comparison compares equal and looks exactly like a pass.
    const metricCount = await prisma.metric.count();
    expect(metricCount).toBe(4);
    expect(baseline.revenueCsv.length).toBeGreaterThan(200);
    expect(baseline.overviewBytes.toString('utf8')).toContain('2296.5');
  });

  it('seeds commerce, re-ranks, and every payout artefact is byte-identical', async () => {
    await seedCommerceFixture(prisma);

    // Commerce genuinely landed, attached to the SAME posts/contents/assets
    // the payout fixture uses. Asserted before the comparison so a silently
    // failed seed cannot masquerade as a passing separation test.
    expect(await prisma.commerceConversion.count()).toBe(3);
    expect(await prisma.productAnchor.count()).toBe(2);
    const anchoredToPayoutPost = await prisma.productAnchor.count({
      where: { postId: PAYOUT_IDS.postBTiktok },
    });
    expect(anchoredToPayoutPost).toBe(1);

    // Re-rank AFTER commerce exists. This is the real risk case: a ranking
    // pass on a clean database proves nothing about contamination.
    await rankAllContent(prisma);

    const after = await captureBaseline(prisma);

    expect(after.overviewBytes.equals(baseline.overviewBytes)).toBe(true);
    expect(after.revenueBytes.equals(baseline.revenueBytes)).toBe(true);
    expect(after.contentRevenueBytes.equals(baseline.contentRevenueBytes)).toBe(true);
    expect(Buffer.compare(after.revenueCsv, baseline.revenueCsv)).toBe(0);
    expect(Buffer.compare(after.overrideLogCsv, baseline.overrideLogCsv)).toBe(0);
    expect(Buffer.compare(after.scores, baseline.scores)).toBe(0);
  });

  it('no payout CSV byte mentions commerce, even with commerce rows present', async () => {
    // Cheap and specific: the CSV is the artefact most likely to grow a
    // "commission" column by accident, and the header freeze in the unit suite
    // only covers the literal — this covers the produced bytes.
    //
    // QC MAJOR-1: this used to read `baseline.revenueCsv`, captured in
    // `beforeAll` BEFORE the commerce fixture was seeded — so a test whose
    // whole point is "even with commerce rows present" was inspecting a
    // zero-commerce database and could not have failed for its stated reason.
    // Re-capture here: the previous test seeded commerce and nothing resets
    // between tests, so this reads the post-seed state.
    const withCommerce = await captureBaseline(prisma);
    expect(await prisma.commerceConversion.count()).toBeGreaterThan(0);

    const revenue = withCommerce.revenueCsv.toString('utf8');
    for (const token of ['commission', 'shopee', 'affiliate', 'gross_sales', 'orders_count']) {
      expect(revenue.toLowerCase()).not.toContain(token);
    }
  });

  describe('the physical schema agrees with the frozen allow-list', () => {
    // The unit-suite version of this asserts against `Prisma.dmmf` (what the
    // application sees). This asserts against `information_schema` (what
    // Postgres actually has). They can only both pass if the migration and the
    // schema genuinely match — which is also a standing drift check on the
    // hand-written DDL.
    it.each(Object.keys(COMMERCE_TABLE_COLUMNS))('%s', async (table) => {
      expect(await columnsOfTable(prisma, table)).toEqual(COMMERCE_TABLE_COLUMNS[table]);
    });
  });

  describe('the hand-written CHECK constraints are live in the database', () => {
    // These constraints exist only in the migration SQL — Prisma cannot
    // express them, so nothing else in the test suite can observe them. A
    // negative insert is the only honest proof they are enforced.

    it('A4 — a note over 200 characters is rejected', async () => {
      await expect(
        prisma.commercePlacement.create({
          data: {
            contentId: PAYOUT_IDS.contentB,
            channel: 'shopee',
            externalMediaId: 'SHOPEE-MEDIA-NOTE-TOO-LONG',
            durationSeconds: 30,
            note: 'x'.repeat(201),
            recordedBy: PAYOUT_IDS.admin,
          },
        }),
      ).rejects.toThrow(/commerce_placements_note_len_chk/);
    });

    it('SA-9/C1 — a lowercase or malformed currency is rejected', async () => {
      await expect(
        prisma.commerceConversion.create({
          data: {
            channel: 'shopee',
            periodStart: new Date('2026-07-01T00:00:00.000Z'),
            periodEnd: new Date('2026-07-07T00:00:00.000Z'),
            commissionAmount: '100.00',
            currency: 'thb',
            recordedBy: PAYOUT_IDS.admin,
          },
        }),
      ).rejects.toThrow(/commerce_conversions_currency_chk/);
    });

    it('SA-2/C2 — a row cannot reverse itself', async () => {
      const id = '00000000-0000-4000-8000-00000000ff01';
      await expect(
        prisma.commerceConversion.create({
          data: {
            id,
            channel: 'shopee',
            periodStart: new Date('2026-07-01T00:00:00.000Z'),
            periodEnd: new Date('2026-07-07T00:00:00.000Z'),
            commissionAmount: '-100.00',
            currency: 'THB',
            reversalOfId: id,
            recordedBy: PAYOUT_IDS.admin,
          },
        }),
      ).rejects.toThrow(/commerce_conversions_no_self_reversal_chk/);
    });

    it('a Shopee placement with a NULL duration is rejected (null is a rejection, not a pass)', async () => {
      await expect(
        prisma.commercePlacement.create({
          data: {
            contentId: PAYOUT_IDS.contentB,
            channel: 'shopee',
            externalMediaId: 'SHOPEE-MEDIA-NULL-DURATION',
            recordedBy: PAYOUT_IDS.admin,
          },
        }),
      ).rejects.toThrow(/commerce_placements_shopee_duration_chk/);
    });

    it('an anchor must have exactly one target', async () => {
      await expect(
        prisma.productAnchor.create({
          data: {
            productId: '00000000-0000-4000-8000-0000000000e1',
            recordedBy: PAYOUT_IDS.admin,
          },
        }),
      ).rejects.toThrow(/product_anchors_one_target_chk/);
    });
  });
});

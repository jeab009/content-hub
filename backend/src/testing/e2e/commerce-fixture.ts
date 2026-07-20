/**
 * WP 6.0.8 — the ADVERSARIAL commerce fixture.
 *
 * "Adversarial, not decorative" is the requirement, and it is the difference
 * between a proof and a ritual. A commerce fixture that touches nothing the
 * payout side reads would pass the byte-identity test trivially and prove
 * nothing at all. So every row below is deliberately aimed at the payout
 * fixture:
 *
 *   - conversions attributed to the SAME `post_id`s the payout metrics cover;
 *   - a placement on the SAME `content_id` that already has `posts` rows, and
 *     pointing at the SAME `content_assets` row;
 *   - commission amounts an ORDER OF MAGNITUDE larger than the payout revenue
 *     (2,296.5 THB total payout vs 48,000 THB gross commission), so an
 *     accidental sum is unmissable rather than a plausible number nobody
 *     questions;
 *   - at least one NEGATIVE reversal row, which is both the append-only
 *     ledger's real shape and the value that breaks a naive CSV escape
 *     (see csv.util.ts).
 *
 * Note what this file CAN do that no production file may: it names both
 * streams in one place. That is the entire reason `src/testing/` exists
 * outside the scanned module directories (System Analyst condition B3) — the
 * boundary scan needs no `*.spec.ts` exemption because the only files that
 * legitimately need one are not in a scanned directory.
 */

import { CommerceChannel, CommerceSource, Prisma, PrismaClient } from '@prisma/client';
import { PAYOUT_IDS } from './payout-fixture';

export const COMMERCE_IDS = {
  product: '00000000-0000-4000-8000-0000000000e1',
  link: '00000000-0000-4000-8000-0000000000e2',
  placement: '00000000-0000-4000-8000-0000000000e3',
  anchorOnPost: '00000000-0000-4000-8000-0000000000e4',
  anchorOnPlacement: '00000000-0000-4000-8000-0000000000e5',
  conversionLarge: '00000000-0000-4000-8000-0000000000f1',
  conversionSecond: '00000000-0000-4000-8000-0000000000f2',
  conversionReversal: '00000000-0000-4000-8000-0000000000f3',
} as const;

const AT = {
  created: new Date('2026-07-01T00:00:00.000Z'),
  placed: new Date('2026-07-02T09:00:00.000Z'),
} as const;

/**
 * Gross commission seeded, before the reversal. An order of magnitude above
 * PAYOUT_TOTAL_REVENUE_THB (2,296.50) on purpose.
 */
export const COMMERCE_GROSS_COMMISSION_THB = 30000 + 18000;
export const COMMERCE_REVERSAL_THB = -4500;

/**
 * Seeds products, links, anchors, a placement and three conversions.
 *
 * Note the raw-SQL FK columns being populated by plain uuid assignment
 * (`postId`, `contentId`, `sourceAssetId`, `recordedBy`): Postgres enforces
 * those FKs — they are hand-written `ALTER TABLE` DDL in the migration — while
 * the Prisma client type graph has no relation field for them. Referential
 * integrity without a traversable edge is the whole of Layer 1, and this
 * fixture is the place it is observable: the inserts succeed, and there is
 * still no `include` that could reach back.
 */
export async function seedCommerceFixture(prisma: PrismaClient): Promise<void> {
  await prisma.commerceProduct.create({
    data: {
      id: COMMERCE_IDS.product,
      channel: CommerceChannel.shopee,
      externalProductId: 'SHOPEE-E2E-0001',
      name: 'E2E Test Product',
      sku: 'E2E-SKU-1',
      productUrl: 'https://shopee.test/product/1',
      listPrice: new Prisma.Decimal('499.00'),
      currency: 'THB',
      commissionRatePct: new Prisma.Decimal('12.50'),
      source: CommerceSource.manual,
      createdBy: PAYOUT_IDS.admin,
      createdAt: AT.created,
    },
  });

  await prisma.affiliateLink.create({
    data: {
      id: COMMERCE_IDS.link,
      productId: COMMERCE_IDS.product,
      url: 'https://shopee.test/aff/abc123',
      trackingCode: 'E2ETRACK',
      subId: 'e2e',
      source: CommerceSource.manual,
      createdBy: PAYOUT_IDS.admin,
      createdAt: AT.created,
    },
  });

  // A placement on the SAME content that already carries payout posts, and
  // pointing at the SAME asset. If any payout read path were to join through
  // content or asset, this is the row that would surface in it.
  await prisma.commercePlacement.create({
    data: {
      id: COMMERCE_IDS.placement,
      contentId: PAYOUT_IDS.contentA,
      channel: CommerceChannel.shopee,
      externalMediaId: 'SHOPEE-MEDIA-0001',
      externalUrl: 'https://shopee.test/video/1',
      sourceAssetId: PAYOUT_IDS.assetA,
      mediaUrl: 'https://example.test/a-9x16.mp4',
      durationSeconds: 30,
      note: 'e2e fixture placement',
      source: CommerceSource.manual,
      recordedBy: PAYOUT_IDS.admin,
      placedAt: AT.placed,
      createdAt: AT.created,
    },
  });

  await prisma.productAnchor.createMany({
    data: [
      // Anchored to a real payout `posts` row — the sharpest available test of
      // "the FK exists, the traversal does not".
      {
        id: COMMERCE_IDS.anchorOnPost,
        postId: PAYOUT_IDS.postBTiktok,
        productId: COMMERCE_IDS.product,
        affiliateLinkId: COMMERCE_IDS.link,
        anchorPosition: 0,
        anchoredAt: AT.placed,
        source: CommerceSource.manual,
        recordedBy: PAYOUT_IDS.admin,
        createdAt: AT.created,
      },
      {
        id: COMMERCE_IDS.anchorOnPlacement,
        placementId: COMMERCE_IDS.placement,
        productId: COMMERCE_IDS.product,
        affiliateLinkId: COMMERCE_IDS.link,
        anchorPosition: 1,
        anchoredAt: AT.placed,
        source: CommerceSource.manual,
        recordedBy: PAYOUT_IDS.admin,
        createdAt: AT.created,
      },
    ],
  });

  await prisma.commerceConversion.createMany({
    data: [
      {
        id: COMMERCE_IDS.conversionLarge,
        channel: CommerceChannel.shopee,
        periodStart: new Date('2026-07-01T00:00:00.000Z'),
        periodEnd: new Date('2026-07-07T00:00:00.000Z'),
        ordersCount: 412,
        itemsSold: 655,
        grossSalesAmount: new Prisma.Decimal('240000.00'),
        commissionAmount: new Prisma.Decimal('30000.00'),
        currency: 'THB',
        // Attributed to the SAME post the payout fixture measures.
        postId: PAYOUT_IDS.postBTiktok,
        placementId: COMMERCE_IDS.placement,
        productId: COMMERCE_IDS.product,
        affiliateLinkId: COMMERCE_IDS.link,
        statementRef: 'SHP-2026-W27',
        source: CommerceSource.manual,
        recordedBy: PAYOUT_IDS.admin,
        createdAt: AT.created,
      },
      {
        id: COMMERCE_IDS.conversionSecond,
        channel: CommerceChannel.shopee,
        periodStart: new Date('2026-07-08T00:00:00.000Z'),
        periodEnd: new Date('2026-07-14T00:00:00.000Z'),
        ordersCount: 260,
        itemsSold: 300,
        grossSalesAmount: new Prisma.Decimal('150000.00'),
        commissionAmount: new Prisma.Decimal('18000.00'),
        currency: 'THB',
        postId: PAYOUT_IDS.postAFacebook,
        productId: COMMERCE_IDS.product,
        statementRef: 'SHP-2026-W28',
        source: CommerceSource.manual,
        recordedBy: PAYOUT_IDS.admin,
        createdAt: AT.created,
      },
      // The reversal. NEGATIVE by design — refunds are new rows, never edits.
      // This is the row that made `escapeCsvField` learn not to formula-prefix
      // a plain negative number (C7), and the row a "sum all commerce" bug
      // would get arithmetically wrong in the most confusing direction.
      {
        id: COMMERCE_IDS.conversionReversal,
        channel: CommerceChannel.shopee,
        periodStart: new Date('2026-07-08T00:00:00.000Z'),
        periodEnd: new Date('2026-07-14T00:00:00.000Z'),
        commissionAmount: new Prisma.Decimal('-4500.00'),
        currency: 'THB',
        postId: PAYOUT_IDS.postAFacebook,
        productId: COMMERCE_IDS.product,
        statementRef: 'SHP-2026-W28-REV',
        reversalOfId: COMMERCE_IDS.conversionSecond,
        source: CommerceSource.manual,
        recordedBy: PAYOUT_IDS.admin,
        createdAt: AT.created,
      },
    ],
  });
}

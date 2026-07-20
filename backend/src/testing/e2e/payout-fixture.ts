/**
 * WP 6.0.8 — the deterministic PAYOUT fixture.
 *
 * Every id is a fixed literal and every timestamp is a fixed literal. Nothing
 * here calls `randomUUID()` or `new Date()`. That is not tidiness — the whole
 * point of the byte-identity proof (exit criterion #6) is comparing two
 * captures byte for byte, and a fixture with a generated uuid or a `now()`
 * timestamp produces a different `content_id` column in `revenue.csv` on every
 * run. The comparison would then only ever be run-against-itself within a
 * single process, which is a much weaker claim than the one being made.
 *
 * `collectedAt` in particular is fixed because it is an exported CSV column
 * AND the field `latestPerPost` orders by — a drifting value could reorder
 * rows, which is precisely the kind of change a naive deep-equal would miss
 * and a byte compare catches.
 *
 * This file lives in `src/testing/` rather than under any module directory so
 * that the static boundary scan can cover `ranking`/`metrics`/`dashboard`/
 * `reports` with NO `*.spec.ts` exemption (System Analyst condition B3). It
 * legitimately names both streams; that is exactly why it must not sit inside
 * a scanned directory.
 */

import { MetricSource, Platform, PrismaClient } from '@prisma/client';

/** Fixed uuids. Grouped so the commerce fixture can attach to the SAME rows. */
export const PAYOUT_IDS = {
  admin: '00000000-0000-4000-8000-000000000001',
  contentA: '00000000-0000-4000-8000-00000000000a',
  contentB: '00000000-0000-4000-8000-00000000000b',
  postAFacebook: '00000000-0000-4000-8000-0000000000a1',
  postAYoutube: '00000000-0000-4000-8000-0000000000a2',
  postBTiktok: '00000000-0000-4000-8000-0000000000b1',
  assetA: '00000000-0000-4000-8000-0000000000c1',
  metricA1Old: '00000000-0000-4000-8000-0000000000d1',
  metricA1Latest: '00000000-0000-4000-8000-0000000000d2',
  metricA2: '00000000-0000-4000-8000-0000000000d3',
  metricB1: '00000000-0000-4000-8000-0000000000d4',
} as const;

/** Fixed instants. UTC literals — never `new Date()`. */
const AT = {
  created: new Date('2026-06-01T00:00:00.000Z'),
  postedA: new Date('2026-06-10T09:00:00.000Z'),
  postedB: new Date('2026-06-12T09:00:00.000Z'),
  collectedOld: new Date('2026-06-15T00:00:00.000Z'),
  collectedLatest: new Date('2026-06-20T00:00:00.000Z'),
} as const;

/**
 * The payout revenue this fixture creates, in THB. Named so the commerce
 * fixture can be provably adversarial relative to it — its commissions are an
 * order of magnitude larger, so any accidental sum is unmissable rather than a
 * plausible-looking number nobody questions.
 */
export const PAYOUT_TOTAL_REVENUE_THB = 1250.5 + 430.25 + 615.75;

/**
 * Seeds one admin, two contents, three posts and four metric readings —
 * including a superseded reading on `postAFacebook`, so the fixture exercises
 * `latestPerPost` rather than assuming one reading per post. A fixture that
 * only has one reading per post would let a "sum every historical snapshot"
 * regression pass unnoticed.
 */
export async function seedPayoutFixture(prisma: PrismaClient): Promise<void> {
  await prisma.user.create({
    data: {
      id: PAYOUT_IDS.admin,
      name: 'E2E Admin',
      email: 'e2e-admin@content-hub.test',
      // Not a real Argon2 hash and never verified: no code path in this suite
      // authenticates. Kept obviously fake so it cannot be mistaken for one.
      passwordHash: 'e2e-fixture-not-a-real-hash',
      createdAt: AT.created,
    },
  });

  await prisma.content.createMany({
    data: [
      {
        id: PAYOUT_IDS.contentA,
        type: 'video',
        title: 'E2E Content A',
        mediaUrl: 'https://example.test/a.mp4',
        targetAgeMin: 25,
        targetAgeMax: 45,
        status: 'ready',
        contentPillar: 'product',
        createdBy: PAYOUT_IDS.admin,
        createdAt: AT.created,
      },
      {
        id: PAYOUT_IDS.contentB,
        type: 'video',
        title: 'E2E Content B',
        mediaUrl: 'https://example.test/b.mp4',
        targetAgeMin: 18,
        targetAgeMax: 35,
        status: 'ready',
        contentPillar: 'comedy',
        createdBy: PAYOUT_IDS.admin,
        createdAt: AT.created,
      },
    ],
  });

  // The asset the commerce fixture will point a placement at, so the two
  // streams genuinely share a row rather than living in disjoint universes.
  await prisma.contentAsset.create({
    data: {
      id: PAYOUT_IDS.assetA,
      contentId: PAYOUT_IDS.contentA,
      platform: 'tiktok',
      aspectRatio: 'ratio_9_16',
      mediaUrl: 'https://example.test/a-9x16.mp4',
      durationSeconds: 30,
      createdAt: AT.created,
    },
  });

  await prisma.post.createMany({
    data: [
      {
        id: PAYOUT_IDS.postAFacebook,
        contentId: PAYOUT_IDS.contentA,
        platform: Platform.facebook,
        status: 'posted',
        postedAt: AT.postedA,
        executedBy: PAYOUT_IDS.admin,
        createdAt: AT.created,
      },
      {
        id: PAYOUT_IDS.postAYoutube,
        contentId: PAYOUT_IDS.contentA,
        platform: Platform.youtube,
        status: 'posted',
        postedAt: AT.postedA,
        executedBy: PAYOUT_IDS.admin,
        createdAt: AT.created,
      },
      {
        id: PAYOUT_IDS.postBTiktok,
        contentId: PAYOUT_IDS.contentB,
        platform: Platform.tiktok,
        status: 'posted',
        postedAt: AT.postedB,
        executedBy: PAYOUT_IDS.admin,
        createdAt: AT.created,
      },
    ],
  });

  await prisma.metric.createMany({
    data: [
      // Superseded reading — must NOT appear in any total.
      {
        id: PAYOUT_IDS.metricA1Old,
        postId: PAYOUT_IDS.postAFacebook,
        platform: Platform.facebook,
        reach: 1000,
        engagement: 100,
        revenue: 999.99,
        source: MetricSource.manual,
        collectedAt: AT.collectedOld,
        createdAt: AT.collectedOld,
      },
      {
        id: PAYOUT_IDS.metricA1Latest,
        postId: PAYOUT_IDS.postAFacebook,
        platform: Platform.facebook,
        reach: 4200,
        engagement: 310,
        revenue: 1250.5,
        source: MetricSource.manual,
        collectedAt: AT.collectedLatest,
        createdAt: AT.collectedLatest,
      },
      {
        id: PAYOUT_IDS.metricA2,
        postId: PAYOUT_IDS.postAYoutube,
        platform: Platform.youtube,
        reach: 2100,
        engagement: 180,
        revenue: 430.25,
        source: MetricSource.manual,
        collectedAt: AT.collectedLatest,
        createdAt: AT.collectedLatest,
      },
      {
        id: PAYOUT_IDS.metricB1,
        postId: PAYOUT_IDS.postBTiktok,
        platform: Platform.tiktok,
        reach: 8800,
        engagement: 940,
        revenue: 615.75,
        source: MetricSource.manual,
        collectedAt: AT.collectedLatest,
        createdAt: AT.collectedLatest,
      },
    ],
  });
}

/** The two content ids the ranking engine is re-run over. */
export const RANKED_CONTENT_IDS = [PAYOUT_IDS.contentA, PAYOUT_IDS.contentB];

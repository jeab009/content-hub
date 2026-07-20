/**
 * WP 6.0.8 — `captureBaseline()`, the byte-honest snapshot of every payout
 * read surface (design §2.4).
 *
 * BYTE-HONEST, NOT OBJECT-SHALLOW. Each artefact is captured as a `Buffer` of
 * its serialized form rather than as a JS object compared with `toEqual`,
 * because a deep-equal would tolerate exactly the changes worth catching: a
 * precision change on a Decimal, a reordering of rows, a number formatted to a
 * different number of places. Those are the shapes an accidental commerce
 * contamination would actually take.
 *
 * ONE normalisation, in one place, on one named field: `generatedAt`, which is
 * `new Date()` inside DashboardService and therefore differs on every call.
 * Everything else is compared as produced. Normalising more would quietly
 * weaken the proof; normalising less would make it flap.
 *
 * A DELIBERATE DEVIATION FROM THE DESIGN, STATED PLAINLY
 * -----------------------------------------------------
 * The design captured these artefacts through HTTP (`GET /api/dashboard/...`)
 * with supertest. This harness calls the read services directly against a real
 * Postgres instead. The reason is scope, not convenience: going through HTTP
 * requires a booted Nest app with session auth, a Redis-backed session store
 * and a logged-in admin — a materially larger surface than 6.0.8 is budgeted
 * for, and none of it is what the test is proving. What the test proves is
 * that the AGGREGATION AND SERIALIZATION produce identical bytes with commerce
 * rows present; the controllers between the service and the socket add
 * `Content-Disposition` headers and a guard, and change no figure.
 *
 * The gap this leaves is real and should be closed in 6A.10 when the commerce
 * endpoints exist and an authenticated supertest harness is worth building
 * once: a controller could in principle inject a commerce service and merge a
 * field. Two things already stand in that gap in the meantime — the ESLint
 * zone banning commerce imports from `dashboard/**`, and the frozen-header
 * test on all three CSVs. Recorded here rather than in a commit message so
 * nobody later reads this file as a complete HTTP-level proof.
 */

import { PrismaClient } from '@prisma/client';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { DashboardService } from '../../modules/dashboard/dashboard.service';
import { RankingEngineV2Service } from '../../modules/ranking/ranking-engine-v2.service';
import { RankingFactorsService } from '../../modules/ranking/ranking-factors.service';
import { RankingFactorsV2Service } from '../../modules/ranking/ranking-factors-v2.service';
import { ReportExportService } from '../../modules/reports/report-export.service';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { PAYOUT_IDS, RANKED_CONTENT_IDS } from './payout-fixture';

/** Fixed `now` so nothing downstream of it can drift between captures. */
const FIXED_NOW = new Date('2026-07-20T00:00:00.000Z');

export interface Baseline {
  overviewBytes: Buffer;
  revenueBytes: Buffer;
  contentRevenueBytes: Buffer;
  revenueCsv: Buffer;
  overrideLogCsv: Buffer;
  scores: Buffer;
}

/**
 * Serializes an object to a stable Buffer.
 *
 * `JSON.stringify` preserves key insertion order, which is itself part of what
 * is being frozen — a response that grew a `commission` key would change these
 * bytes even if every existing value stayed the same, which is the entire
 * point.
 */
function toBytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

/** Strips the one field that legitimately differs between two calls. */
function withoutGeneratedAt<T extends { generatedAt: Date }>(payload: T): Omit<T, 'generatedAt'> {
  const { generatedAt: _generatedAt, ...rest } = payload;
  return rest;
}

/**
 * `ranking_scores` as raw text.
 *
 * `score::text` rather than `Number(score)`: a `Decimal(10,4)` read into a JS
 * number would silently tolerate a precision change, and precision is one of
 * the ways contamination would first show. `reasoning` is included because a
 * factor's `input` changing while its `contribution` rounds to the same total
 * is exactly the invisible contamination decision C-C exists to prevent — a
 * comparison of `score` alone would miss it.
 *
 * `id` and `computed_at` are deliberately NOT selected, and this is a
 * correction to the design's version of this query (§2.4), which listed `id`.
 * Every ranking pass mints fresh uuids and a fresh `computed_at`, so including
 * them would make the two captures differ on every run for reasons that have
 * nothing to do with commerce — the test would fail permanently and be deleted.
 * What is being compared is the COMPUTATION, keyed by (content, platform).
 */
async function captureScores(prisma: PrismaClient): Promise<Buffer> {
  const rows = await prisma.$queryRaw<
    {
      content_id: string;
      platform: string;
      score: string;
      engine_version: string;
      reasoning: unknown;
    }[]
  >`
    SELECT content_id, platform, score::text AS score, engine_version, reasoning
    FROM ranking_scores
    ORDER BY content_id, platform
  `;

  return toBytes(rows);
}

/**
 * Runs the v2 ranking engine over every fixture content, persisting
 * `ranking_scores` rows.
 *
 * v2 specifically, because v2 is the engine that consumes real per-pillar
 * EARNINGS (`ranking-factors-v2.service.ts` aggregates over `prisma.metric`) —
 * v1 does not, so ranking under v1 would be a weaker test of "commerce money
 * cannot reach a score". The re-run AFTER commerce exists is the real risk
 * case: a first ranking pass on a clean database proves nothing about
 * contamination.
 *
 * Scores are deleted before each pass so the comparison is between two
 * complete score sets rather than between one set and two appended ones —
 * `ranking_scores` is append-only in production, but here the second pass is
 * asking "does the same computation produce the same numbers", and that needs
 * the same starting state.
 */
export async function rankAllContent(prisma: PrismaClient): Promise<void> {
  const prismaService = prisma as PrismaService;
  const engine = new RankingEngineV2Service(
    prismaService,
    new RankingFactorsV2Service(prismaService, new RankingFactorsService(prismaService)),
    new AuditLogService(prismaService),
  );

  await prisma.rankingScore.deleteMany({});
  for (const contentId of RANKED_CONTENT_IDS) {
    await engine.computeScores(contentId, PAYOUT_IDS.admin);
  }
}

/** Captures every payout read surface in one pass. */
export async function captureBaseline(prisma: PrismaClient): Promise<Baseline> {
  // The read services take a PrismaService; a PrismaClient is structurally the
  // same object with two lifecycle hooks the fixture manages itself.
  const prismaService = prisma as PrismaService;
  const dashboard = new DashboardService(prismaService);
  const reports = new ReportExportService(prismaService);

  const [overview, revenue, contentRevenue, revenueCsv, overrideLogCsv, scores] = await Promise.all(
    [
      dashboard.overview(FIXED_NOW),
      dashboard.revenue(FIXED_NOW),
      dashboard.contentRevenue(PAYOUT_IDS.contentA, FIXED_NOW),
      reports.revenueCsv({}),
      reports.overrideLogCsv({}),
      captureScores(prisma),
    ],
  );

  return {
    overviewBytes: toBytes(withoutGeneratedAt(overview)),
    revenueBytes: toBytes(withoutGeneratedAt(revenue)),
    contentRevenueBytes: toBytes(withoutGeneratedAt(contentRevenue)),
    // The CSV has no timestamp column, so a true byte compare is available and
    // is used unnormalised. This is the artefact most likely to grow a
    // "commission" column by accident.
    revenueCsv: Buffer.from(revenueCsv, 'utf8'),
    overrideLogCsv: Buffer.from(overrideLogCsv, 'utf8'),
    scores,
  };
}

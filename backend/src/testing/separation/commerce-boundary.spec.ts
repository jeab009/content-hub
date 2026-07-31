/**
 * Phase 6.0 — Layer 3 of the separation: the static boundary scan.
 *
 * WHAT ESLINT CANNOT SEE, AND WHY THIS TEST EXISTS
 * -----------------------------------------------
 * Layer 2 (the `no-restricted-imports` zones in `.eslintrc.cjs`) checks
 * IMPORTS. It does not see a raw table name inside a `$queryRaw` tagged
 * template, a bare string literal `'commerce_conversions'`, or a
 * `prisma.commerceConversion` call reached through an injected `PrismaService`
 * — which every module imports legitimately. This scan closes that gap by
 * looking at source TEXT rather than the AST, deliberately: an AST walk would
 * miss the table name in a template literal, which is precisely the sneaky
 * case.
 *
 * THREE THINGS THE SYSTEM ANALYST CHANGED ABOUT THE DESIGN'S VERSION
 * -----------------------------------------------------------------
 * 1. Location (condition B1 / G3a). The design put this at
 *    `backend/test/commerce-boundary.spec.ts`, outside `rootDir: 'src'` —
 *    jest would never have collected it and it would have "passed" forever.
 * 2. No `*.spec.ts` exclusion (condition B3 / G3b). The design exempted spec
 *    files so the payout regression fixture could seed commerce rows. The
 *    fixtures now live in `src/testing/`, outside every scanned directory, so
 *    the scan covers EVERY `.ts` file with no exemption at all. A scan you can
 *    opt out of by renaming a file is not evidence.
 * 3. Word boundaries + comment stripping (condition B3 / G3c). The design
 *    scanned for bare substrings including `'metrics'`, which matches ordinary
 *    English prose — including a comment explaining why commerce does not
 *    touch metrics. String literals are still scanned; only comments are
 *    removed. See src/testing/source-scan.util.ts.
 *
 * If this test fails, do not add an exception. A payout or ranking file naming
 * a commerce symbol is a breach of a locked admin decision
 * (phase6-project-plan.md C-A/C-B/C-C), not a lint nit.
 */

import { listTsFiles, readSource, stripComments, wordBoundaryPattern } from '../source-scan.util';

/**
 * The payout + ranking side of the boundary. Scanned in full — including
 * `reports/`, whose controller is the one file ESLint exempts so it can mount
 * the future commerce CSV. The exemption is an IMPORT exemption; this scan
 * still refuses a commerce table name anywhere in the directory, which is the
 * specific price of that exemption (System Analyst G2c).
 */
const PAYOUT_AND_RANKING_DIRS = [
  'src/modules/ranking',
  'src/modules/metrics',
  'src/modules/dashboard',
  'src/modules/reports',
  // QC MAJOR-3: the scan used to stop after the four above, while
  // `.eslintrc.cjs` argues the zones must be system-wide and covers nine path
  // globs. A raw `$queryRaw` naming a commerce table inside any directory
  // below was therefore caught by NEITHER layer — not ESLint, because a raw
  // query needs no import, and not this scan, because it never walked here.
  // That gap is exactly what a text scan exists to close, so it now covers
  // every module the lint zones do.
  'src/modules/publish',
  'src/modules/content',
  'src/modules/scheduler',
  'src/modules/queue',
  'src/modules/comments',
  'src/modules/connected-accounts',
  'src/common',
];

/** Both the Prisma client accessor spelling AND the physical table name. */
const COMMERCE_TOKENS = [
  'commerceProduct',
  'affiliateLink',
  'productAnchor',
  'commercePlacement',
  'commerceConversion',
  'commerce_products',
  'affiliate_links',
  'product_anchors',
  'commerce_placements',
  'commerce_conversions',
  'CommerceChannel',
  'CommerceModule',
  'CommerceSource',
  'CommercePlacementStatus',
];

/**
 * Phase 7 — both the Prisma client accessor spelling AND the physical table
 * name for the paid/ads visibility stream (System Analyst condition P-B1).
 * Scanned alongside COMMERCE_TOKENS wherever payout/ranking must not
 * reference either commerce or paid, restating the same discipline for the
 * third stream rather than a parallel, easy-to-forget scan.
 */
const PAID_TOKENS = [
  'adCampaign',
  'adPerformanceEntry',
  'ad_campaigns',
  'ad_performance_entries',
  'AdChannel',
  'AdCampaignStatus',
  'AdSource',
];

/**
 * The reverse check. Without it the separation is one-directional: a future
 * "blend in payout revenue for context" inside commerce would leave the
 * byte-identity proof green (payout output really would be unchanged) while
 * the two streams had quietly been joined.
 */
const COMMERCE_SIDE_DIRS = ['src/modules/commerce'];

/**
 * Phase 7 — the paid/ads side of the three-way boundary. Currently contains
 * only `paid.constants.ts` (7.0.4); the rest of `modules/paid/` is 7A. The
 * scan is wired now so it is already enforcing once that code lands, per
 * System Analyst condition P-B4 (PaidModule's import graph must stay
 * `{ContentModule, common/*}` only).
 */
const PAID_SIDE_DIRS = ['src/modules/paid'];

const PAYOUT_TOKENS = [
  'prisma.metric',
  'prisma.rankingScore',
  'ranking_scores',
  'metrics',
  'RankingScore',
  'RankingEngineService',
  'RankingEngineV2Service',
  'DashboardService',
  'ReportExportService',
];

/** Scans one directory list for one token list; returns `file → token` hits. */
function scan(dirs: string[], tokens: string[]): string[] {
  const offenders: string[] = [];

  for (const dir of dirs) {
    for (const file of listTsFiles(dir)) {
      const code = stripComments(readSource(file));
      for (const token of tokens) {
        if (wordBoundaryPattern(token).test(code)) {
          offenders.push(`${file} → ${token}`);
        }
      }
    }
  }

  return offenders;
}

describe('Phase 6 separation — static boundary scan', () => {
  it('scans a non-empty set of files (guards against a silently empty scan)', () => {
    // A scan that walks zero files reports zero offenders and looks identical
    // to a passing scan. This is the same class of failure as G3a and it is
    // cheap to rule out.
    const payoutFiles = PAYOUT_AND_RANKING_DIRS.flatMap((dir) => listTsFiles(dir));
    const commerceFiles = COMMERCE_SIDE_DIRS.flatMap((dir) => listTsFiles(dir));

    expect(payoutFiles.length).toBeGreaterThan(10);
    expect(commerceFiles.length).toBeGreaterThan(0);
  });

  it('no payout or ranking source file references any commerce table or symbol', () => {
    // toEqual([]) rather than toHaveLength(0): the failure message then prints
    // every offender with its token, not just a count.
    expect(scan(PAYOUT_AND_RANKING_DIRS, COMMERCE_TOKENS)).toEqual([]);
  });

  it('no commerce source file references the metric or ranking stream', () => {
    expect(scan(COMMERCE_SIDE_DIRS, PAYOUT_TOKENS)).toEqual([]);
  });
});

/**
 * Phase 7 — the same static boundary scan, extended to a third stream
 * (System Analyst conditions P-B1, P-B4). Deliberately EXTENDS the existing
 * `PAYOUT_AND_RANKING_DIRS`/`COMMERCE_SIDE_DIRS` constants above rather than
 * hand-deriving a shorter directory list from the architecture design's own
 * prose, which under-scopes it (the design's §2.3 text omits `comments` and
 * `connected-accounts` — both are already present in the real constant and
 * therefore already covered here).
 */
describe('Phase 7 separation — static boundary scan (paid/ads, third stream)', () => {
  it('scans a non-empty set of paid-side files (guards against a silently empty scan)', () => {
    const paidFiles = PAID_SIDE_DIRS.flatMap((dir) => listTsFiles(dir));
    expect(paidFiles.length).toBeGreaterThan(0);
  });

  it('no payout or ranking source file references any paid table or symbol', () => {
    expect(scan(PAYOUT_AND_RANKING_DIRS, PAID_TOKENS)).toEqual([]);
  });

  it('no commerce source file references any paid table or symbol', () => {
    expect(scan(COMMERCE_SIDE_DIRS, PAID_TOKENS)).toEqual([]);
  });

  it('no paid source file references the metric/ranking stream or any commerce table or symbol', () => {
    expect(scan(PAID_SIDE_DIRS, [...PAYOUT_TOKENS, ...COMMERCE_TOKENS])).toEqual([]);
  });
});

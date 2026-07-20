/**
 * Phase 6.0 — frozen CSV headers for the three existing payout/analytics
 * exports (System Analyst condition B5).
 *
 * WHY THIS TEST IS THE PRICE OF AN ESLINT EXEMPTION
 * ------------------------------------------------
 * Layer 2 bans commerce imports from `reports/report-export.service.ts` but
 * deliberately NOT from `reports/reports.controller.ts`, because the commerce
 * CSV (6A.9) lives in `modules/commerce/` and is *mounted* by that controller.
 * Restricting the whole directory would force the commerce export into the
 * payout service — the exact wrong outcome. The consequence, which the System
 * Analyst named as G2c: `reports.controller.ts` becomes the single file in the
 * codebase permitted to see both export services, i.e. the exact file where a
 * `commission_thb` column could be appended to `revenue.csv`.
 *
 * The byte-identity e2e covers `revenue.csv`, but only when its fixture runs
 * (real Postgres, its own CI job). This freeze covers all three exports,
 * always, in the fast unit suite, with no database — so the cheapest test
 * guards the most expensive mistake.
 *
 * The literals below are duplicated from `report-export.service.ts` ON
 * PURPOSE. A test that imports the value it is asserting against proves
 * nothing; both copies must be edited together, and that paired diff is the
 * review moment. If you are legitimately changing a report's columns, change
 * both in the same commit and say why in the PR.
 */

import {
  COMMENT_SUMMARY_CSV_HEADERS,
  OVERRIDE_LOG_CSV_HEADERS,
  REVENUE_CSV_HEADERS,
} from '../../modules/reports/report-export.service';

describe('Phase 6 separation — payout CSV header freeze', () => {
  it('revenue.csv headers are frozen (no commerce column may be appended)', () => {
    expect([...REVENUE_CSV_HEADERS]).toEqual([
      'content_id',
      'content_title',
      'content_pillar',
      'platform',
      'post_id',
      'publish_method',
      'collected_at',
      'metric_source',
      'reach',
      'engagement',
      'revenue_thb',
    ]);
  });

  it('override-log.csv headers are frozen', () => {
    expect([...OVERRIDE_LOG_CSV_HEADERS]).toEqual([
      'post_id',
      'content_id',
      'content_title',
      'content_pillar',
      'recommended_platform',
      'selected_platform',
      'was_override',
      'override_reason',
      'publish_method',
      'status',
      'priority_score',
      'recommended_at',
      'posted_at',
      'created_at',
    ]);
  });

  it('comment-summary.csv headers are frozen', () => {
    expect([...COMMENT_SUMMARY_CSV_HEADERS]).toEqual([
      'platform',
      'sentiment',
      'priority',
      'comment_count',
      'replied_count',
      'sla_breached_count',
    ]);
  });

  it('no payout export header uses commerce vocabulary', () => {
    // Layer 5 (vocabulary separation) applied to the export surface. Commerce
    // totals are `commission*` / `gross_sales*` / `orders_count`; payout totals
    // are `revenue*`. Disjoint vocabularies make `revenue_thb + commission_thb`
    // read as obviously wrong in a review, in a way `revenue + revenue` never
    // would.
    const commerceVocabulary = /commission|gross_sales|orders_count|items_sold|affiliate|shopee/i;
    const allHeaders = [
      ...REVENUE_CSV_HEADERS,
      ...OVERRIDE_LOG_CSV_HEADERS,
      ...COMMENT_SUMMARY_CSV_HEADERS,
    ];

    expect(allHeaders.filter((header) => commerceVocabulary.test(header))).toEqual([]);
  });
});

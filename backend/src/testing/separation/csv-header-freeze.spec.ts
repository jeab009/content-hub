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
import { PAID_CSV_HEADERS } from '../../modules/paid/paid-export.service';

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

/**
 * Phase 7 — frozen CSV header for the paid export (design §3.2, WBS 7A.4),
 * mirroring the Phase 6 describe block above exactly. `paid.csv` is a THIRD
 * separate report, never a column on `revenue.csv` or `commerce.csv`. `NO
 * source_ref` column — the highest-residual PII free-text field on
 * `ad_performance_entries` is never exported (System Analyst SA-P1), the
 * same posture Commerce shipped for `statement_ref`.
 */
describe('Phase 7 separation — paid CSV header freeze', () => {
  it('paid.csv headers are frozen (no payout or commerce column may be appended)', () => {
    expect([...PAID_CSV_HEADERS]).toEqual([
      'campaign_id',
      'channel',
      'period_start',
      'period_end',
      'spend',
      'reach',
      'impressions',
      'clicks',
      'result_type',
      'result_count',
      'currency',
      'corrects_entry_id',
      'source',
      'recorded_by',
      'created_at',
    ]);
  });

  it('no paid export header uses payout or commerce vocabulary, and no payout/commerce header uses paid vocabulary', () => {
    const commerceVocabulary = /commission|gross_sales|orders_count|items_sold|affiliate|shopee/i;
    const payoutVocabulary = /revenue|engagement/i;
    const paidVocabulary = /total_spend|entries_count|campaign_id/i;

    const payoutAndCommerceHeaders = [
      ...REVENUE_CSV_HEADERS,
      ...OVERRIDE_LOG_CSV_HEADERS,
      ...COMMENT_SUMMARY_CSV_HEADERS,
    ];

    expect(PAID_CSV_HEADERS.filter((header) => commerceVocabulary.test(header))).toEqual([]);
    expect(PAID_CSV_HEADERS.filter((header) => payoutVocabulary.test(header))).toEqual([]);
    expect(payoutAndCommerceHeaders.filter((header) => paidVocabulary.test(header))).toEqual([]);
  });

  it('paid.csv never carries source_ref (System Analyst SA-P1 — never exported)', () => {
    expect(PAID_CSV_HEADERS).not.toContain('source_ref');
  });
});

/**
 * Phase 6 — Layer 5 of the separation: vocabulary (design §2.5).
 *
 * Layers 1–4 protect the database and the backend read paths; they do NOT
 * stop a developer writing `overview.totals.revenue + summary.commissionAmount`
 * in a JSX expression or a DTO. The mitigation is a disjoint field
 * vocabulary: no commerce DTO ever uses the word `revenue`, and no payout
 * DTO ever uses `commission`/`grossSales`/`affiliate`. Reviewed side by side,
 * `revenue + revenue` reads as an obvious bug; `totals.revenue +
 * summary.commissionAmount` does not, unless the vocabularies are kept apart.
 *
 * Scans SOURCE TEXT (comments stripped, same technique as the boundary
 * scan) rather than asserting a frozen key list, so a newly added field
 * is caught immediately rather than only after someone remembers to update
 * a literal array here.
 */

import { listTsFiles, readSource, stripComments, wordBoundaryPattern } from '../source-scan.util';

const COMMERCE_SUMMARY_DTO = 'src/modules/commerce/dto/commerce-summary-response.dto.ts';
const DASHBOARD_DTO = 'src/modules/dashboard/dto/dashboard.dto.ts';
const PAID_SUMMARY_DTO = 'src/modules/paid/dto/paid-summary-response.dto.ts';
const PAID_DIR = 'src/modules/paid';

/** Case-sensitive: `revenue` as a field/property name, not the English word in prose. */
const PAYOUT_VOCABULARY = 'revenue';
const COMMERCE_VOCABULARY = ['commission', 'grossSales', 'affiliate', 'shopee'];

/**
 * Phase 7 — vocabulary belonging to the paid stream (design §2.5, §3.4).
 * `PaidSummaryDto` uses `totalSpend`/`totalReach`/`totalImpressions`/
 * `totalClicks`/`totalResultCount`/`entriesCount` — disjoint from both the
 * payout vocabulary (`revenue`) and the commerce vocabulary
 * (`commission`/`grossSales`/`affiliate`/`shopee`).
 */
const PAID_VOCABULARY = ['totalSpend', 'entriesCount', 'AdCampaign', 'AdPerformanceEntry'];

/** No payout or commerce DTO/service may ever use this money-shaped key. */
const REVENUE_OR_COMMISSION_TOKENS = ['revenue', 'commissionAmount'];

describe('Phase 6 separation — commerce/payout vocabulary is disjoint', () => {
  it('the commerce summary DTO never uses the payout word "revenue"', () => {
    const code = stripComments(readSource(COMMERCE_SUMMARY_DTO));
    expect(wordBoundaryPattern(PAYOUT_VOCABULARY).test(code)).toBe(false);
  });

  it('the payout dashboard DTO never uses commerce vocabulary', () => {
    const code = stripComments(readSource(DASHBOARD_DTO));
    const offenders = COMMERCE_VOCABULARY.filter((token) => wordBoundaryPattern(token).test(code));
    expect(offenders).toEqual([]);
  });
});

/**
 * Phase 7 — Layer 5, extended to a third, pairwise-disjoint vocabulary
 * (System Analyst condition P-B3's sibling finding for §2.5): "disjoint
 * A<->B" no longer implies "disjoint A<->C" once there are three streams, so
 * each pair is checked explicitly rather than assuming transitivity.
 */
describe('Phase 7 separation — Layer 5, paid vocabulary is pairwise disjoint', () => {
  it('the paid summary DTO never uses the payout word "revenue"', () => {
    const code = stripComments(readSource(PAID_SUMMARY_DTO));
    expect(wordBoundaryPattern(PAYOUT_VOCABULARY).test(code)).toBe(false);
  });

  it('the paid summary DTO never uses commerce vocabulary (commission/grossSales/affiliate/shopee)', () => {
    const code = stripComments(readSource(PAID_SUMMARY_DTO));
    const offenders = COMMERCE_VOCABULARY.filter((token) => wordBoundaryPattern(token).test(code));
    expect(offenders).toEqual([]);
  });

  it('the payout dashboard DTO never uses paid vocabulary', () => {
    const code = stripComments(readSource(DASHBOARD_DTO));
    const offenders = PAID_VOCABULARY.filter((token) => wordBoundaryPattern(token).test(code));
    expect(offenders).toEqual([]);
  });

  it('the commerce summary DTO never uses paid vocabulary', () => {
    const code = stripComments(readSource(COMMERCE_SUMMARY_DTO));
    const offenders = PAID_VOCABULARY.filter((token) => wordBoundaryPattern(token).test(code));
    expect(offenders).toEqual([]);
  });

  it('no key named "revenue" or "commissionAmount" appears anywhere under modules/paid/ production code', () => {
    // Deliberately EXCLUDES `*.spec.ts` here, unlike the boundary scan —
    // a test legitimately needs to name `revenue`/`commission` as a literal
    // to assert it is ABSENT from a paid export/DTO (exactly what
    // `paid-export.service.spec.ts`'s own vocabulary check does). The
    // production-code files are what this rule actually protects: DTOs and
    // services, where a `revenue`/`commissionAmount` key would be a real
    // vocabulary breach, not a test asserting the opposite.
    const offenders: string[] = [];
    for (const file of listTsFiles(PAID_DIR).filter((path) => !path.endsWith('.spec.ts'))) {
      const code = stripComments(readSource(file));
      for (const token of REVENUE_OR_COMMISSION_TOKENS) {
        if (wordBoundaryPattern(token).test(code)) {
          offenders.push(`${file} -> ${token}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

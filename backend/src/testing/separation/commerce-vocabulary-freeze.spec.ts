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

import { readSource, stripComments, wordBoundaryPattern } from '../source-scan.util';

const COMMERCE_SUMMARY_DTO = 'src/modules/commerce/dto/commerce-summary-response.dto.ts';
const DASHBOARD_DTO = 'src/modules/dashboard/dto/dashboard.dto.ts';

/** Case-sensitive: `revenue` as a field/property name, not the English word in prose. */
const PAYOUT_VOCABULARY = 'revenue';
const COMMERCE_VOCABULARY = ['commission', 'grossSales', 'affiliate', 'shopee'];

describe('Phase 6 separation — Layer 5, commerce/payout vocabulary is disjoint', () => {
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

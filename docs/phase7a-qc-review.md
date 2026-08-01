# Phase 7A — Paid/Ads Visibility Backend · QC Review

- **Author**: Senior Quality Control Engineer (Loop Engineering position #5)
- **Date**: 2026-08-01
- **Commit under review**: `7601918` "feat(paid): Phase 7A backend — campaign/performance-entry endpoints, read model, CSV export"
- **Built on**: Phase 7.0 schema gate (`a74a184`)

---

## Executive Summary

**VERDICT: APPROVED — Ready for QA Tester.**

Phase 7A closes all System Analyst 7A-blocking conditions (items 9–10 in the sign-off's consolidated list). The implementation is sound, all 12 binding requirements are met, test coverage is comprehensive with real logic testing, and static analysis enforces the separation guarantees. Zero Critical or Major findings; minor documentation notes recorded below for the record.

---

## 1. Binding Requirements Verification (12-item System Analyst checklist)

### Requirement 1: `sourceRef` format enforcement in SERVICE layer (P-A1)
**Status**: ✅ PASS

- **Implementation**: `paid-source-ref.util.ts:21–31`, enforced in `paid-performance.service.ts:46`
- **Regex pattern**: `^[A-Za-z0-9][A-Za-z0-9._\-\/]{0,63}$` (confirmed — no space, correctly anchored)
- **Evidence**:
  - Exported constant `PAID_SOURCE_REF_PATTERN` in `paid.constants.ts:152`
  - `assertPaidSourceRefShape` called at the service layer before create, not only DTO validation
  - Comprehensive unit tests in `paid.constants.spec.ts:19–78` verify:
    - Accepts well-formed refs (META-2026-W29, adsmgr.2026_07_20, FB/2026/07/000123, A, 0812345678)
    - Rejects all defective design-draft cases (John Smith, Somchai P, Ratchada Rd 42, any space)
    - Rejects leading punctuation, @-signs, Thai script, commas, newlines
    - Pattern is anchored, length-bounded to 64 chars via `{0,63}` tail
    - Identical to Commerce's shipped fix (verbatim regex source verified at test line 77)

### Requirement 2: `correctsEntryId` same-campaign validation (P-A3)
**Status**: ✅ PASS

- **DB CHECK**: `ad_performance_entries_no_self_correction_chk` at migration line 226–227
- **Service validation**: `paid-performance.service.ts:173–193` (`assertCorrectionTargetIsSameCampaign`)
  - 404 (NotFoundException) if target entry not found (line 185)
  - 400 (BadRequestException) if `target.campaignId !== campaignId` (line 188)
- **Evidence**:
  - Unit tests in `paid-performance.service.spec.ts:170–198` verify all three cases:
    - Missing target → 404 ✓
    - Different campaign → 400 ✓
    - Same campaign → accepted ✓
  - E2E test in `paid-unaffected-by-payout-and-commerce.e2e-spec.ts:241–256` verifies DB CHECK rejects self-correction

### Requirement 3: Performance-entry idempotency — 60s window (§4.2 finding, condition 9)
**Status**: ✅ PASS

- **Window constant**: `PAID_PERFORMANCE_ENTRY_IDEMPOTENCY_WINDOW_MS = 60 * 1000` at `paid.constants.ts:163`
- **Implementation**: `paid-performance.service.ts:127–161` (`assertNotDuplicateWithinWindow`)
  - Byte-identical payload check: all fields compared
  - Scoped to same `recordedBy` and `campaignId`
  - Returns 409 (ConflictException) on duplicate (line 155)
- **Evidence**:
  - Unit tests in `paid-performance.service.spec.ts:151–168` verify:
    - Rejects byte-identical payload with 409 ✓
    - Scopes check to same recordedBy ✓
  - Mirrors `COMMERCE_CONVERSION_IDEMPOTENCY_WINDOW_MS` exactly (same 60s, same structure)

### Requirement 4: Currency guard — THB only, never cross-currency totals
**Status**: ✅ PASS

- **Supported currencies**: `PAID_SUPPORTED_CURRENCIES = ['THB']` at `paid.constants.ts:29`
- **Service enforcement**: `paid-currency.util.ts:14–23` (`assertPaidSupportedCurrency`)
  - Called in both `PaidCampaignService.create` and `PaidPerformanceService.addEntry`
  - Throws BadRequestException if unsupported currency
- **DB CHECK constraints**: Migration lines 188–189 and 230–231
  - Both tables: `currency ~ '^[A-Z]{3}$'` (upper-case 3-letter ISO-4217 shape)
- **No cross-currency summation**: `paid-read.service.ts:66–73`
  - All breakdowns group by `currency` first (never summed across currencies)
  - Evidence: `byCurrency`, `byCampaign`, `byResultType` all use `currency` as key component
- **Evidence**:
  - Unit tests in `paid.constants.spec.ts:96–109` verify:
    - THB only in v1 ✓
    - All currencies in list match CHECK pattern ✓
  - E2E tests in `paid-unaffected-by-payout-and-commerce.e2e-spec.ts:198–211` verify:
    - Lowercase currency rejected by DB CHECK ✓
    - Malformed currency rejected ✓

### Requirement 5: `plannedBudget` never reconciled against `spend`
**Status**: ✅ PASS

- **Entirely absent from read model**: `paid-summary-response.dto.ts:40–45`
  - `PaidSummaryDto` has only `totalSpend`, not `plannedBudget`
  - Explicit docstring at line 38: "never reconciled"
- **Not touched in aggregation**: `paid-read.service.ts` makes no reference to `plannedBudget`
- **Evidence**:
  - E2E test at `paid-unaffected-by-payout-and-commerce.e2e-spec.ts:148–151` verifies:
    - Paid summary totals correctly reflect seeded spend figures
    - CSV does not mention plannedBudget
    - Constant `PAID_PLANNED_BUDGET_THB` seeded in fixture but never referenced in read path ✓

### Requirement 6: Vocabulary discipline — no `revenue` or `commissionAmount` anywhere
**Status**: ✅ PASS

- **Vocabulary constants**: `paid.constants.ts` uses `total*` prefix (totalSpend, totalReach, totalImpressions, totalClicks, totalResultCount, entriesCount)
- **Disjoint from payout** (revenue) **and commerce** (commission, grossSales, affiliate)
- **Static boundary scan**: `commerce-vocabulary-freeze.spec.ts:83–102` extended at Phase 7
  - Scans all production code in `src/modules/paid/` (excluding `.spec.ts`)
  - Asserts no occurrence of `revenue` or `commissionAmount`
  - Test passes ✓
- **Three-way pairwise check** at lines 60–82:
  - Paid DTO never uses payout vocabulary ✓
  - Paid DTO never uses commerce vocabulary ✓
  - Payout DTO never uses paid vocabulary ✓
  - Commerce DTO never uses paid vocabulary ✓
- **Evidence**:
  - CSV header freeze at `csv-header-freeze.spec.ts:107–147` verifies:
    - Paid headers use `spend`/`reach`/`impressions`/`clicks` (not `revenue`/`commission`)
    - No payout/commerce vocab in paid headers, no paid vocab in payout/commerce headers ✓

### Requirement 7: Import graph — exactly `{ContentModule, common/*}` only
**Status**: ✅ PASS

- **Declared imports in `paid.module.ts:1–35`**:
  - ContentModule (line 2) ✓
  - AdminGuard, CsrfGuard from common (line 34) ✓
  - No PublishModule, RankingModule, MetricsModule, DashboardModule, CommerceModule
- **ESLint zones**: `.eslintrc.cjs` lines 1–61
  - `src/modules/paid/**/*.ts` bans all of `metrics`, `ranking`, `dashboard`, `reports`, `commerce`
- **Static boundary scan**: `commerce-boundary.spec.ts:180–197` extended to Phase 7
  - PAID_SIDE_DIRS = `['src/modules/paid']` (line 116)
  - Test at line 194–196 verifies paid source never references payout/ranking or commerce tokens
- **No step-up imported**: Grep confirms zero occurrences of `StepUpAuth` in `src/modules/paid/`
- **Evidence**:
  - Unit tests pass: "no paid source file references the metric/ranking stream or any commerce table" ✓
  - Boundary scan includes full scope: not under-scoped to a prose list from design doc ✓

### Requirement 8: No PATCH/DELETE route on performance entries (append-only, exit criterion #3)
**Status**: ✅ PASS

- **Routes defined in `paid.controller.ts`**:
  - POST `/campaigns/:id/performance-entries` (line 92–102) — create only
  - GET `/campaigns/:id/performance-entries` (line 104–110) — read only
  - No PATCH or DELETE handler on `:entryId` path
- **Route-absence tests**: `paid.controller.spec.ts:143–157`
  - PATCH returns 404 (handler does not exist, not 403/401) ✓
  - DELETE returns 404 ✓
  - PUT returns 404 ✓
- **Evidence**:
  - HTTP-level test proves the gap exists structurally, not just by absence of service method ✓

### Requirement 9: Audit meta exclusion — all FOUR free-text/identifier fields
**Status**: ✅ PASS

- **Campaign created** (`paid-campaign.service.ts:57–65`):
  - Excludes: `objective`, `externalCampaignName`, `externalCampaignId` (comment line 61–63)
  - Meta includes: `campaignId`, `channel` only
- **Campaign updated** (`paid-campaign.service.ts:93–98`):
  - Meta includes: `campaignId`, `changedFields` only (no free-text values in meta)
- **Campaign retired** (`paid-campaign.service.ts:111–116`):
  - Meta includes: `campaignId` only
- **Performance entry added** (`paid-performance.service.ts:70–82`):
  - Excludes: `sourceRef` (comment line 74–75)
  - Meta includes: `entryId`, `campaignId`, `spend`, `isCorrection`
- **Mirroring Commerce**: Consistent with Commerce's SA-4 blanket exclusion of free-text (not just the PII-shaped field)
- **Evidence**:
  - Unit test in `paid-performance.service.spec.ts:121–127` verifies sourceRef not in meta ✓
  - Comment blocks explicitly name all exclusions per SA-P4 ruling ✓

### Requirement 10: Byte-identity separation proof
**Status**: ✅ PASS

- **Fixture adversarial**: `paid-fixture.ts:34–95`
  - Spend seeded: 300,000 + 180,000 + 305,000 = 785,000 THB total (line 52)
  - Order of magnitude larger than payout (2,296.50 THB) and commerce (48,000 THB) — accidental sum unmissable
  - Includes correction row (line 38: `entryCorrection`) exercising `correctsEntryId` mechanic
  - Campaign attributed to SAME `contentId` as payout/commerce fixtures (line 72: `PAYOUT_IDS.contentA`)
  - Planned budget seeded non-null (line 54) to prove never reconciled
- **E2E proof**: `paid-unaffected-by-payout-and-commerce.e2e-spec.ts:58–124`
  - Sequence: payout → commerce → capture baseline A → paid → re-rank → capture baseline B → byte-compare
  - Baseline comparison (lines 116–123):
    - Payout overview, revenue, content-revenue: byte-identical ✓
    - CSV buffers compared via `Buffer.compare()` (byte-honest, not JSON-equal) ✓
    - Commerce summary and CSV: byte-identical ✓
    - Ranking scores (`score::text`, `reasoning`): byte-identical ✓
  - Positive assertion (lines 138–155): paid read surfaces do work (the other half of separation)
- **Evidence**:
  - E2E tests in `backend/test/` directory (confirms real Postgres, real CI) ✓
  - Fixture is genuinely adversarial: spend dwarfs both other streams (test line 84–85) ✓
  - Baseline is non-trivial: metrics and commerce conversions actually seeded (line 88–94) ✓

### Requirement 11: Guard stack per endpoint
**Status**: ✅ PASS

- **All routes**: `@UseGuards(SessionAuthGuard, AdminGuard)` at controller level (line 45)
- **Mutating routes additionally**: `@UseGuards(CsrfGuard)` decorator
  - POST campaigns (line 54) ✓
  - PATCH campaigns/:id (line 71) ✓
  - POST retire (line 83) ✓
  - POST performance-entries (line 93) ✓
- **No step-up**: SA-P3 reasoning verified (no write is live-push or ranking override)
  - No `StepUpAuthService` imported anywhere in paid module
  - Confirmed via grep: zero occurrences
- **Evidence**:
  - Controller tests verify admin/non-admin rejection ✓
  - Tests verify CSRF enforcement on mutating routes ✓

### Requirement 12: No cross-boundary Prisma `include`
**Status**: ✅ PASS

- **Paid read model** (`paid-read.service.ts:41–64`):
  - Content lookup: two-step query, not an `include`
    - Step 1 (line 54): find campaign IDs with `where: { contentId: query.contentId }`
    - Step 2 (line 58): find entries with `where: { ..., campaignId: { in: campaignIds } }`
  - Performance entries query (line 63): plain `findMany` with no `include`
- **Paid export** (`paid-export.service.ts:54–62`):
  - Only includes within namespace: `include: { campaign: { select: { channel: true } } }`
    - This is a Prisma relation within the paid namespace (entry → campaign)
    - Never reaches across to content/metrics/commerce
- **Evidence**:
  - No raw Prisma relations declared from Paid into other streams ✓
  - Boundary scan enforces this structurally (Layer 3 static check) ✓

---

## 2. Standards & Consistency Review

### Type Safety
- **No `any` types found**: Grep confirms zero `any` in `src/modules/paid/`
- **Proper error types**: 
  - `NotFoundException` for missing entities ✓
  - `BadRequestException` for validation failures ✓
  - `ConflictException` for idempotency violations ✓
- **Decimal handling**: Using Prisma.Decimal for money (not floating-point) ✓

### Test Quality
- **Real logic tested**, not just happy path:
  - `paid-performance.service.spec.ts`: edge cases (missing campaign, wrong campaign, duplicate, sourceRef validation, currency validation)
  - `paid-campaign.service.spec.ts`: conflict handling, content validation, audit meta exclusion
  - `paid.constants.spec.ts`: 27 tests covering regex edge cases, erasure surface, currency pattern
  - `paid.controller.spec.ts`: route-absence tests (structural proof)
  - E2E: byte-identity proof with adversarial fixture
- **Separation tests**:
  - `commerce-boundary.spec.ts`: three-way scan (paid-payout, paid-commerce, payout-commerce)
  - `commerce-vocabulary-freeze.spec.ts`: vocabulary disjointness across three streams
  - `csv-header-freeze.spec.ts`: header freeze across three exports

### Code Organization
- **Layering**:
  - DTOs (create/update/response/summary)
  - Services (campaign, performance, read, export)
  - Controller (HTTP routes)
  - Utils (sourceRef format, currency guard)
  - Constants (policy values frozen at 7.0 gate)
- **Mirrors Commerce**: Follows established patterns for services/DTOs/guards

### Audit Logging
- All mutating actions logged with proper action names:
  - `ad_campaign_created`, `ad_campaign_updated`, `ad_campaign_retired`
  - `ad_performance_entry_added`
  - `paid_report_exported`
- Meta excludes PII per SA-P4 ✓
- CSV exports audit via audit log ✓

---

## 3. Static Analysis Results

### ESLint
No ESLint violations reported in paid module.

### Test Coverage
- Unit tests: all critical paths covered
- Integration: e2e byte-identity proof on real database
- Separation: static scan + vocabulary freeze + csv header freeze

### Schema Constraints
All required CHECK constraints in place (migration verified):
- `ad_campaigns_planned_budget_nonneg_chk` (P-A2) ✓
- `ad_campaigns_date_range_chk` ✓
- `ad_campaigns_currency_chk` (SA-P6) ✓
- `ad_performance_entries_spend_nonneg_chk` ✓
- `ad_performance_entries_reach_nonneg_chk` ✓
- `ad_performance_entries_impressions_nonneg_chk` ✓
- `ad_performance_entries_clicks_nonneg_chk` ✓
- `ad_performance_entries_result_count_nonneg_chk` ✓
- `ad_performance_entries_period_chk` ✓
- `ad_performance_entries_no_self_correction_chk` (P-A3) ✓
- `ad_performance_entries_currency_chk` (SA-P6) ✓

---

## 4. Findings Summary

### Critical Issues
None.

### Major Issues
None.

### Minor Issues

**Info-1: Import organization in reports.module.ts**
- **File**: `backend/src/modules/reports/reports.module.ts`
- **Note**: Module properly registers `PaidExportService` as a provider without importing `PaidModule` (line 6, 31). Correct design — avoids pulling `ContentModule` transitively. Documented in docblock (lines 25–27). No fix needed; recorded for design hygiene.

**Info-2: Audit meta shape for campaign update**
- **File**: `backend/src/modules/paid/paid-campaign.service.ts:93–98`
- **Note**: Campaign update records `changedFields` in meta (line 97). This is safe and consistent with Commerce's pattern, but does reveal *which* fields were changed. For updates, this is acceptable (unlike create, where free-text values would be exposed). Correct implementation; no fix needed.

---

## 5. Exit Criteria & Gate Conditions

All Phase 7A-blocking conditions from System Analyst sign-off (conditions 9–10) are closed:

- **Condition 9** (§4.2 finding — performance-entry idempotency): ✅ IMPLEMENTED
  - 60s window, same-payload, same-recordedBy → 409
  - Mirrors Commerce exactly
  
- **Condition 10** (P-B4 — import graph verification): ✅ VERIFIED
  - PaidModule imports exactly {ContentModule, common/*}
  - Confirmed via code inspection and ESLint zones
  - No transitive coupling to Publishing/Ranking (unlike Commerce)

---

## 6. Verification of 7.0 Gate Conditions (inherited by 7A)

All prior conditions from 7.0 gate carry through to 7A:

- **P-A1** (sourceRef regex, service-layer enforcement): ✅ IMPLEMENTED
- **P-A2** (plannedBudget >= 0 CHECK): ✅ IN MIGRATION
- **P-A3** (correctsEntryId same-campaign validation): ✅ IMPLEMENTED
- **P-A4** (retention/erasure policy, PAID_ERASABLE_FREE_TEXT_COLUMNS): ✅ CONSTANTS DEFINED
- **SA-P4** (audit meta exclusion, all four fields): ✅ IMPLEMENTED
- **SA-P6** (currency CHECK + service guard): ✅ IMPLEMENTED
- **P-B1** (boundary scan extends existing constants, not hand-derived): ✅ VERIFIED
- **P-B2** (separation tests proven to fail first): ✅ CI ENFORCES

---

## 7. Summary by Severity

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 0 | — |
| Major | 0 | — |
| Minor | 0 (2 info notes recorded) | — |
| **Overall** | **APPROVED** | **Ready for QA Tester** |

---

## Handoff Summary

Phase 7A closes all QA-blocking conditions. The code is well-structured, follows all binding requirements from System Analyst sign-off, mirrors Commerce's established patterns exactly, and includes comprehensive tests covering both happy path and edge cases. Separation guarantees are enforced at five layers (schema, Prisma relations, ESLint zones, static boundary scan, byte-identity proof). Ready for QA testing.

---

**Prepared by:** Senior Quality Control Engineer, Loop Engineering Position #5  
**Date:** 2026-08-01  
**Verdict:** **APPROVED — Ready for QA Tester**  
**Next phase:** Senior QA Test Engineer (Position #6) — Phase 7A functional/regression testing

# Phase 7A — Paid/Ads Visibility Backend · QA Test Report

- **Author**: Senior QA Test Engineer, Loop Engineering position #6
- **Date**: 2026-08-01
- **Subject**: `backend/src/modules/paid/**` and mounted routes (`/api/paid/*`, `/api/reports/paid.csv`), commit `7601918`
- **Input**: QC-reviewed code (see `docs/phase7a-qc-review.md`, reviewed in parallel), `docs/phase7-project-plan.md`, `docs/phase7-architecture-design.md`, `docs/phase7-system-analyst-signoff.md` (binding conditions)
- **Method**: Adversarial black-box HTTP testing against the live Docker stack (curl), cross-checked against backend logs and source, plus execution of the repo's own automated unit and e2e (byte-identity) suites. No frontend exists this phase — backend-only, as scoped.

---

## 0. Environment

- Backend container **did not** contain the `PaidModule` on first inspection (`find /app -iname 'paid*'` returned nothing; `/app/dist/modules/paid` did not exist) — confirming the running image predated commit `7601918`.
- Rebuilt: `docker compose build backend && docker compose up -d backend`. Build succeeded (`Image content-hub-backend Built`).
- Post-rebuild boot confirmed clean: all `/api/paid/*` routes mapped (`PaidController {/api/paid}` with 8 routes logged), `PrismaService connected`, `Nest application successfully started`, `content_hub_e2e`/main DB migrations up to date (`npx prisma migrate status` → "Database schema is up to date!", 11 migrations). Container health: `healthy`, `RestartCount: 0` throughout the entire test session — no crash induced by any adversarial input, including the one bug found (§2, BUG-7A-01).
- Admin login (`admin@example.com` / `TestPassw0rd!2026XYZ`) succeeded; session cookie + CSRF token obtained and used for all authenticated calls.

---

## 1. Test execution summary

| Priority # | Area | Result |
|---|---|---|
| 1 | Full campaign lifecycle (create/edit/immutable fields/retire/duplicate) | **PASS** |
| 2 | `sourceRef` adversarial (space, valid, 64/65 char boundary) | **PASS** |
| 3 | Performance-entry idempotency (immediate double-submit) | **PASS** |
| 4 | `correctsEntryId` adversarial (cross-campaign, nonexistent, valid) | **PASS** |
| 5 | Currency adversarial (USD on campaign + entry) | **PASS** |
| 6 | Append-only proof (PATCH/DELETE route-absence) | **PASS** |
| 7 | Boundary values (negative numerics, negative budget) | **PASS** |
| 7 (cont.) | `endDate` before `startDate` | **FAIL — BUG-7A-01 (High)** |
| 8 | `/api/paid/summary` — totals correctness + forbidden keys | **PASS** |
| 9 | `/api/reports/paid.csv` — headers, content, PII | **PASS, with one observation** |
| 10 | Byte-identity regression (`npm run test:e2e`) | **PASS — executed, 28/28** |
| 11 | Guard/auth checks (401/403/CSRF) | **PASS** (AdminGuard-rejection not independently re-exercised live — see §5) |
| 12 | Regression on existing endpoints | **PASS** |

Automated suites executed directly (not just read):

| Suite | Result |
|---|---|
| `npm test` (unit, `backend/`) | **703/703 passed**, 62 suites, 0 failed |
| `npm run test:e2e` (byte-identity, against disposable `content_hub_e2e` DB) | **28/28 passed**, 2 suites (`paid-unaffected-by-payout-and-commerce.e2e-spec.ts`, `payout-unaffected-by-commerce.e2e-spec.ts`) |

---

## 2. Bug list

### BUG-7A-01 — `endDate` before `startDate` returns raw 500 instead of clean 400 — **Severity: High**

**Repro:**
```
POST /api/paid/campaigns
{"channel":"meta","externalCampaignName":"QA Bad Dates","externalCampaignId":"qa-ext-baddates",
 "objective":"Traffic","startDate":"2026-07-10","endDate":"2026-07-01"}
```
**Observed:** `HTTP 500 {"success":false,"statusCode":500,"message":"Internal server error", ...}`

**Backend log (verbatim):**
```
PrismaClientUnknownRequestError: ... PostgresError { code: "23514", message: "new row for
relation \"ad_campaigns\" violates check constraint \"ad_campaigns_date_range_chk\"" ...
    at PaidCampaignService.createOrConflict (.../paid-campaign.service.js:113:20)
```

**Root cause:** `CreatePaidCampaignDto` has no cross-field date-order validation (`@IsDateString()` only, on each field independently). `PaidCampaignService.createOrConflict` catches only Prisma error code `P2002` (unique-violation → clean 409) and rethrows everything else — including Postgres `23514` (CHECK-constraint violation) — unhandled, so Nest's default exception filter returns a generic 500.

**Impact:** The DB-level `CHECK (end_date IS NULL OR end_date >= start_date)` constraint (correctly present per the architecture design and System Analyst sign-off) **does** prevent the bad row from being persisted — no data-integrity break, confirmed via follow-up `GET /api/paid/campaigns?q=QA%20Bad` → `[]`. But the API contract is violated: this is exactly the "raw DB error, not a clean validation response" failure mode the task brief calls out by name for the duplicate-campaign case (which the code *does* handle cleanly via `P2002`→409) — the identical discipline was not extended to the date-order CHECK. A client integrating against this API gets an opaque `"Internal server error"` with no indication which field is wrong, and every occurrence pollutes the server error log as an `ERROR`-level unhandled exception (relevant to NFR "no new errors in backend logs" — this is a **latent** one, triggered by any admin typo, not just adversarial QA).

**Recommendation:** Add `@ValidateIf`/class-validator custom validator (or a manual check in the service, mirroring the `createOrConflict` P2002 pattern) that rejects `endDate < startDate` with a 400 before it reaches Postgres. Apply symmetrically to `UpdatePaidCampaignDto` (not tested directly here, but the same DTO shape and same missing cross-field check applies — update path likely shares the identical failure mode since `update()` also lacks date-order validation before its own `prisma.adCampaign.update()` call).

**Route to:** Bug Fixer.

---

## 3. Detailed findings by test priority

### 1. Full campaign lifecycle — PASS

- `POST /api/paid/campaigns` (channel=meta, THB) → `201` with all expected fields (`id`, `channel`, `externalCampaignName`, `externalCampaignId`, `objective`, `contentId`, `startDate`, `endDate`, `plannedBudget`, `currency`, `status`, `isActive`, `retiredAt`, `source`, `createdBy`, timestamps).
- `PATCH` attempting `channel`+`externalCampaignId` together with a legitimate field → **400**, `["property channel should not exist","property externalCampaignId should not exist"]` — rejected outright by the global `ValidationPipe`'s `forbidNonWhitelisted`, not silently dropped. This satisfies the task's "rejected, not silently accepted" bar cleanly (arguably a stronger guarantee than silent-ignore, since the caller is told exactly why).
- `PATCH` with only a legal field (`objective`) → `200`, updated; confirmed via follow-up `GET` that `channel`/`externalCampaignId` were unchanged.
- Retire → `POST /api/paid/campaigns/:id/retire` → row returned with `isActive:false`, `retiredAt` set to a real timestamp; row still fully readable via `GET ?isActive=false`. Soft-retire confirmed, never a hard delete.
  - **Minor/cosmetic observation** (not filed as a bug — Low, informational): the retire endpoint returns HTTP `201 Created` rather than `200 OK`. The controller has no `@HttpCode` decorator on `retireCampaign`, so Nest defaults a `@Post` handler to 201. Retiring isn't creating a resource; `200` would be more semantically correct. Harmless functionally (response body is correct, tests found no client-side reliance on the code), but worth a one-line fix for contract cleanliness.
- Duplicate create (same `channel`+`externalCampaignId`) → clean `409 ConflictException`, human-readable message, **not** a raw Prisma/Postgres error. This is exactly the pattern BUG-7A-01 shows is missing for the date-order case.

### 2. `sourceRef` adversarial — PASS

- `"John Smith"` (contains a space) → `400`, message: *"sourceRef accepts letters, digits and . _ - / only (no spaces) — never audience, buyer, or individual-recipient detail."* Confirmed via follow-up `GET` on the campaign's performance-entries that **no row was created**.
- Valid ref (`"AdsManager-Screenshot-2026-07-07"`) → `201`, persisted correctly.
- Exactly 64 chars → `201`, persisted with the full 64-char string round-tripped exactly.
- 65 chars → `400` (two validator messages fired together: the length cap *and* the regex, both correctly triggered).

This confirms the System Analyst's mandated fix (P-A1 — replacing the pre-fix regex with the space-free, anchored `COMMERCE_STATEMENT_REF_PATTERN`-style pattern) was actually shipped and is enforced in the service layer, not merely in the DTO — matches `paid-source-ref.util.ts`'s stated design.

### 3. Performance-entry idempotency — PASS

- First submit of a specific payload → `201`.
- Immediate byte-identical resubmit (same campaign, same `recordedBy` session, same all fields) → `409`, message names the original entry's id and the 60s window.
- Confirmed via `GET` that exactly **one** row exists for that period — not two.

### 4. `correctsEntryId` adversarial — PASS

- Correction submitted on campaign 3's endpoint pointing at an entry that actually belongs to campaign 2 → clean `400`, message explicitly names the mismatch: *"correctsEntryId ... belongs to campaign ..., not ... — a correction must reference an entry on the same campaign."* Not a 500, not silently accepted.
- Correction pointing at a nonexistent UUID → clean `404`, *"The performance entry this row corrects was not found."*
- Valid same-campaign correction → `201`; confirmed via history `GET` that the row carries `correctsEntryId` set to the original entry's id and is distinguishable from a normal entry (not merged/confused with it) — this is also reflected correctly in `/api/paid/summary`'s `entriesCount` (which counts the correction as its own row, by design — append-only, no netting logic).

### 5. Currency adversarial — PASS

- Campaign create with `currency: "USD"` → clean `400`, *"Unsupported currency \"USD\". This system currently accepts: THB."* Confirmed no row created via follow-up search.
- Performance entry with `currency: "USD"` → same clean `400`, same message, same guard (`assertPaidSupportedCurrency`) reused correctly across both call sites.

### 6. Append-only proof — PASS (strongest form confirmed)

- `PATCH /api/paid/campaigns/:id/performance-entries/:entryId` — both a **real** entry id and a **fake** UUID → `404`, message *"Cannot PATCH /api/paid/campaigns/.../performance-entries/..."* — this is Nest/Express's own route-not-found message, i.e. genuine **route absence**, not a guard or handler returning 404 for a business reason. Confirmed by log inspection (`routes-resolver.js:77` in the stack trace — the router's own "no matching route" path, not `PaidController`/`PaidPerformanceService` code).
- `DELETE` on the same two ids → identical result, identical route-absence proof.

This is the strongest possible confirmation requested: the route genuinely does not exist at the Express routing layer, for both a real and a fake id, on both verbs.

### 7. Boundary values — PASS except BUG-7A-01

- `spend: -10.00` → `400 "spend must not be less than 0"`.
- `reach: -5` → `400 "reach must not be less than 0"`.
- `impressions: -5` → `400 "impressions must not be less than 0"`.
- `clicks: -5` → `400 "clicks must not be less than 0"`.
- `resultCount: -5` → `400 "resultCount must not be less than 0"`.
- `plannedBudget: -500` on campaign create → `400 "plannedBudget must not be less than 0"`.
- `endDate` before `startDate` → **500**, not 400 — see BUG-7A-01. Confirmed the row is *not* persisted (DB CHECK still enforces the invariant), so this is an error-handling/API-contract defect, not a data-integrity defect.

### 8. `/api/paid/summary` — PASS

Seeded data (4 performance entries across 1 active campaign at the time of the check: spends 100, 150, 222.22, 225 THB):
- `totals[0].totalSpend = 697.22` = 100+150+222.22+225 ✓ (arithmetically verified by hand)
- `totalReach = 2000`, `totalImpressions = 10000`, `totalClicks = 60`, `totalResultCount = 10` — each independently verified against the two entries (the idempotency-test entry and its correction) that carried those fields; the other two entries had them `null` and correctly contributed 0.
- `entriesCount = 4` — correctly includes the correction row as its own countable entry (append-only, no netting), matching design intent.
- `byResultType` breakdown (`null`→2 entries/250 THB, `"leads"`→2 entries/447.22 THB) cross-checked and correct.
- Grepped the full JSON response for `revenue` and `commissionAmount` — **neither key found anywhere**.
- Grepped for `plannedBudget` — **not present** in the summary response, confirming SA-P5 (indicative-only, never reconciled/exposed in aggregate reads) is honored.

### 9. `/api/reports/paid.csv` — PASS, one observation

- Fetched successfully (`200`, `Content-Type: text/csv`, `Content-Disposition: attachment; filename="paid-report.csv"`).
- Header: `campaign_id,channel,period_start,period_end,spend,reach,impressions,clicks,result_type,result_count,currency,corrects_entry_id,source,recorded_by,created_at`
- Content contains exactly the 4 entries created during this test session, with correct values (spend, dates, `corrects_entry_id` populated only on the correction row) — cross-checked against the JSON responses captured at creation time.
- No PII-shaped values found (UUIDs, dates, THB decimals, short alphanumeric `sourceRef`s only — no names/emails/phone-shaped strings; the values that would have been PII-risk, e.g. `"John Smith"`, were the ones already rejected at write time in test #2).
- **Observation, not a bug**: literally compared to `commerce.csv` (`channel,period_start,period_end,orders_count,items_sold,gross_sales_amount,commission_amount,currency,product_id,placement_id,post_id,affiliate_link_id,source,recorded_by,created_at`) and `revenue.csv` (`content_id,content_title,content_pillar,platform,post_id,publish_method,collected_at,metric_source,reach,engagement,revenue_thb`): the three headers are **not** literally 100% disjoint — `paid.csv` shares generic structural column names (`channel`, `period_start`, `period_end`, `currency`, `source`, `recorded_by`, `created_at`) with `commerce.csv`, and shares `reach` with `revenue.csv`. However, the **money-bearing** column names — the actual anti-summation concern the architecture design and System Analyst sign-off are about (§2.5 vocabulary-freeze: no key named `revenue`/`commissionAmount` under `modules/paid/`) — are fully disjoint: `spend` (paid) vs. `gross_sales_amount`/`commission_amount` (commerce) vs. `revenue_thb` (revenue). I read this as consistent with the shipped `csv-header-freeze.spec.ts` and `commerce-vocabulary-freeze.spec.ts` design intent (disjoint money vocabulary, not zero column-name overlap across all metadata), but flagging the literal overlap for the record since the task instruction asked for "no shared column" specifically.

### 10. Byte-identity regression — PASS, executed directly

- Created disposable database via `assertDisposableDatabase`'s naming convention (`content_hub_e2e`, already existed from a prior run); ran `npx prisma migrate deploy` (schema already current, 11 migrations, no-op) then `DATABASE_URL=...content_hub_e2e npm run test:e2e`.
- Result: **2 suites, 28 tests, all passed** — `paid-unaffected-by-payout-and-commerce.e2e-spec.ts` and `payout-unaffected-by-commerce.e2e-spec.ts`. This is the phase's actual definition of done (exit criterion #4 / 7A.5) and it is genuinely green, not merely present.
- Also ran the full unit suite (`npm test`) as a broader regression check: **703/703 passed, 62 suites**, including all six `modules/paid/*.spec.ts` files and all five `testing/separation/*.spec.ts` files (`enum-freeze`, `commerce-schema-freeze`, `commerce-boundary`, `commerce-vocabulary-freeze`, `csv-header-freeze`).

### 11. Guard/auth checks — PASS, with one caveat

- `GET /api/paid/campaigns`, `GET /api/paid/summary`, `GET /api/reports/paid.csv`, `POST /api/paid/campaigns` — all four, called with **no session cookie** → `401 "Authentication required"`.
- `POST /api/paid/campaigns`, `PATCH /api/paid/campaigns/:id`, `POST /api/paid/campaigns/:id/retire` — all three, called **with a valid session but no CSRF token** → `403 "Invalid or missing CSRF token"`.
- **Caveat**: this system has a single-admin model (confirmed via `backend/prisma/seed.ts` — one seeded user, `role: 'admin'`, no user-creation endpoint exposed to create a second, non-admin account). I could not independently exercise a live "authenticated-but-non-admin" HTTP request against the paid routes for lack of a second account to create through the API. I instead read `AdminGuard`'s implementation directly (`backend/src/common/guards/admin.guard.ts`): it re-queries the user's role from the database on every request (not a client-supplied claim) and throws `ForbiddenException` unless `role === 'admin'`, and `PaidController` applies `@UseGuards(SessionAuthGuard, AdminGuard)` identically to every other admin-only controller in the system. This is the same shared, already-unit-tested guard (`admin.guard.spec.ts`, part of the 703 passing unit tests) applied with no paid-specific bypass — I consider this **verified by code inspection**, not independently reproduced live, and note the distinction rather than claiming a live repro I didn't perform.

### 12. Regression on existing endpoints — PASS

- `GET /api/dashboard/overview` → `200`, sane shape (`totals`, `byPlatform`, `trend`).
- `GET /api/commerce/summary` → `200`, sane shape with real seeded commerce data (`commissionAmount: 4894`, `grossSalesAmount: 51500`, etc. — pre-existing data, unaffected).
- `GET /api/contents`, `GET /api/posts`, `GET /api/reports/revenue.csv` → all `200`.
- Backend logs across the entire test session, filtered to the last 2 minutes at the end of testing → **0 unexpected `ERROR` lines** beyond the ones this session's own adversarial requests intentionally triggered (409s, 400s, 404s, and the one 500 in BUG-7A-01). Container health remained `healthy` throughout; `RestartCount: 0`.

---

## 4. Test data created and cleanup

| Item | Status |
|---|---|
| Campaign `QA Test Campaign 1` (`qa-ext-001`) | **Soft-retired** (`isActive:false`, `retiredAt` set) — cleanup performed via the only removal path that exists (retire). Row persists by design (append-only-adjacent soft-delete). |
| Campaign `QA Test Campaign 2` (`qa-ext-002`) | **Soft-retired** at end of session. |
| Campaign `QA Test Campaign 3` (`qa-ext-003`) | **Soft-retired** at end of session. |
| Campaign `QA USD Campaign`, `QA Negative Budget`, `QA Bad Dates` | **Never created** — all three were rejected at the API (400/500) before any row was persisted; confirmed via follow-up `GET` search returning `[]` in each case. Nothing to clean up. |
| 4 `AdPerformanceEntry` rows under campaign 2 (spend 100, 150, 222.22, 225 — the last a correction) | **Cannot be removed** — append-only by design, no DELETE route exists (confirmed in test #6). Left in place, clearly identifiable: campaign `qa-ext-002` / `QA Test Campaign 2`, `sourceRef` values `AdsManager-Screenshot-2026-07-07`, a 64×`A` string, `IdempotencyTest-1`, and `CorrectionOf-<entryId>`. |
| Rejected/duplicate performance-entry attempts (`John Smith`, 65-char ref, negative values, USD currency, bad correction targets) | **Never created** — all confirmed via follow-up `GET` to have produced no row. |
| Disposable `content_hub_e2e` database | Pre-existing (not created by this session); `test:e2e` run truncates and reseeds it as designed — no impact on the demo/docker-compose database (`content_hub`), which the harness's `assertDisposableDatabase` guard specifically refuses to touch. |

---

## 5. What I could and could not test

**Could test, and did, directly against the live stack:**
- Every numbered priority in the brief (1–12), via real HTTP requests (curl) with evidence (status codes + response bodies captured above), backend log cross-checks, and direct execution of both the unit suite and the e2e byte-identity suite.

**Could not test, and why:**
- Live non-admin-role rejection (test #11's admin-role half) — no second, non-admin user exists or can be created via the exposed API in this single-admin system; verified by code/test inspection instead (see §3.11). This is a genuine environment limitation, not a skipped test.
- Frontend/visual QA — explicitly out of scope per the task brief ("no frontend exists yet — this phase is backend-only").
- Multi-admin/concurrency race conditions on the idempotency window (e.g., two truly concurrent requests racing past the `findFirst` check before either commits) — not exercised; the 60-second-window sequential-resubmit case specified in the brief was tested and passes. A true concurrent-race test would need parallel in-flight requests, which was out of scope for this pass's adversarial-but-sequential HTTP testing.

---

## 6. Verdict

**One High-severity bug found** (BUG-7A-01 — `endDate < startDate` on campaign create returns an unhandled 500/raw DB error instead of a clean 400). No data-integrity break results from it (the DB CHECK constraint still prevents the bad row), but it is a reproducible, unhandled-exception-class defect in the exact shape the task brief explicitly tests for and the exact shape the codebase already knows how to handle correctly one line away (`P2002` → clean 409 for duplicates). Everything else tested — the full campaign lifecycle, `sourceRef` PDPA-adversarial validation, idempotency, correction cross-campaign/not-found/valid handling, currency guards, append-only route-absence, all other boundary values, summary correctness and vocabulary separation, CSV export, the byte-identity separation proof (executed, 28/28), the full unit suite (703/703), and every guard/regression check — passed cleanly with no other Critical/High/Medium defects found.

**REJECTED — route to Bug Fixer** for BUG-7A-01 (High). Given the fix is narrowly scoped (a cross-field date-order check on `CreatePaidCampaignDto`/`UpdatePaidCampaignDto`, mirroring the existing `P2002`-catch pattern already in `PaidCampaignService.createOrConflict`), this should be a fast turnaround, not a re-architecture. Recommend re-running priority #7's `endDate`/`startDate` case (both create and update paths) plus a full regression pass once fixed, before advancing to DevOps.

---

**Prepared by:** Senior QA Test Engineer, Loop Engineering Position #6
**Date:** 2026-08-01
**Next agent:** Bug Fixer (BUG-7A-01), then back to QA for re-verification before DevOps/Rollout.

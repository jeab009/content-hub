# Phase 6A — Commerce Backend: Senior QA Test Report

**Role**: Senior QA Test Engineer (position #6 of 8, Loop Engineering)
**Scope**: Phase 6A backend (catalog/links, product anchors, manual-external
placements, append-only conversions, commerce read model, commerce CSV
export) on branch `phase6.0-schema-separation-gate`, commit `89105c7` at
session start (no code was modified during this QA pass).
**Date**: 2026-07-21
**Method**: Independent re-execution — full unit + e2e suites re-run from
zero, then live curl-driven adversarial HTTP testing against the rebuilt
Docker stack (backend/frontend/postgres/redis, all healthy), plus direct
source reading of every guard/service discussed below. Nothing in this
report is carried over from the prior informal (non-QA) pass or from commit
messages — nothing was treated as verified until reproduced here.

This report supersedes no other role's document. It does not speak for
Quality Control, which is running independently on the same delivery.

---

## 1. Test Execution Summary

| Suite | Command | Result |
|---|---|---|
| Backend unit | `npm test` | **595/595 passed, 56/56 suites**, 18.1s |
| Backend e2e (separation) | `DATABASE_URL=...content_hub_e2e npm run test:e2e` | **14/14 passed**, 3.0s |
| HTTP adversarial (this pass) | curl against live Docker stack, admin session + CSRF | see §2–§7 below |
| Regression smoke | 9 core endpoints (`/api/contents`, `/api/posts`, `/api/dashboard/*`, `/api/comments`, `/api/scheduler/overview`, 3×commerce) | **all 200** |
| Backend log scan | `docker compose logs backend` for the full session window | **zero 5xx responses** (verified by grep on `"status":50x`) |

No test was skipped. No flaky behavior observed on repeated runs.

---

## 2. QA-1 (`statementRef`) — re-verified and stress-tested beyond the original repro

Read `commerce.constants.ts`, `commerce-statement-ref.util.ts`,
`create-conversion.dto.ts`, and `commerce-conversion.service.ts`. The DTO's
`@Matches` decorator and the service's `assertStatementRefShape()` import
the **same exported constant** (`COMMERCE_STATEMENT_REF_PATTERN` /
`COMMERCE_STATEMENT_REF_MAX_LENGTH`) — there is no way for the two layers to
disagree on the HTTP path, by construction, not just by testing. I confirmed
the DTO layer catches every case below before the service is ever reached
(class-validator runs in the global `ValidationPipe`, ahead of the
controller method).

I also checked for a second ingestion path that could bypass both layers:
`CommerceAdapter.fetchConversions()` is defined on the interface and
implemented by both mock adapters, but **grep confirms it is called nowhere
in the codebase outside its own adapter files and tests** — no sync job or
controller wires it into `CommerceConversionService.create()` in 6A. There
is currently no live/adapter-fed conversion path to bypass; the only
ingestion route is the HTTP DTO, which is validated.

Live results:

| Case | Input | Result |
|---|---|---|
| Original repro | `"John Smith"` | `400` — `"statementRef accepts letters, digits and . _ - / only (no spaces)..."` |
| 64 chars (boundary) | `"A"×64` | `201` — accepted, stored verbatim |
| 65 chars (boundary+1) | `"A"×65` | `400` — both the regex-length and `MaxLength(64)` messages fired together |
| Empty string `""` | explicit empty | `400` — regex requires ≥1 alnum-leading char |
| Omitted field | not sent | `201` — persisted as `null` (correct; optional) |
| Thai unicode | `"สมชาย"` | `400` — rejected |
| SQL-metacharacter string | `"1;DROP TABLE users;--"` | `400` — rejected (also: Prisma parameterizes all writes regardless, so this was never an injection risk, only a format-policy check) |

All seven cases behaved exactly as documented in `commerce.constants.ts`'s
`COMMERCE_STATEMENT_REF_PATTERN` docblock. **QA-1 is closed with no residual
finding.**

---

## 3. Manual-external placement (6A.5) — each guard defeated/attacked individually

### 3.1 Field-smuggling (forbidNonWhitelisted)
```
POST /api/commerce/placements/manual-external
{ ..., "status":"published", "publishMethod":"adapter", "recordedBy":"attacker-id", "version":99 }
→ 400 ["property status should not exist","property publishMethod should not exist",
       "property recordedBy should not exist","property version should not exist"]
```
Confirmed: rejected outright (400), not silently stripped — there is no
"ignore extra fields" fallback to trick.

### 3.2 Duration boundary — all four values tested explicitly, not assumed
| durationSeconds | Result |
|---|---|
| 9 | `422` — `"...between 10 and 60 seconds; got 9."` |
| 10 | `201` — created |
| 60 | `201` — created (fresh content, to avoid the active-duplicate guard masking this case) |
| 61 | `422` — `"...between 10 and 60 seconds; got 61."` |
| omitted (null) | `422` — `"...None was provided or could be parsed from the source asset — enter it by hand."` (confirms "null is a rejection, not a pass", matching the DB CHECK's documented `FALSE OR NULL = NULL` fix) |

Inclusive bounds [10, 60] confirmed exactly; exclusive boundaries at 9 and
61 confirmed exactly.

### 3.3 Duplicate-placement race — 4-way concurrency, twice
First run (content `817f1819`, channel `tiktok_shop`) was contaminated by
throttle exhaustion (2 of 4 got 429 before reaching the handler), but still
showed the key evidence: exactly **1** `201`, and among the two that reached
the service, one returned
`"An active tiktok_shop placement for this content already exists (created concurrently)"`
— the DB-constraint race backstop, not just the app-level check.

Re-ran clean (fresh content `dfe01ce0`, cleared throttle first, budget
verified sufficient): 4 concurrent `POST .../manual-external`, same
`(contentId, channel)`:
```
201, 409, 409, 409
```
- The `201` row: `f79e5575-9894-4201-a3df-2af4fc6f4473`
- One `409`: `"...already exists (placement f79e5575... Remove it first...")` (app-level `assertNoActiveDuplicate` check)
- One `409`: `"...already exists (created concurrently)"` (DB unique-index `P2002` backstop caught a true race)
- One `409`: app-level check again

**Exactly one success under concurrency, confirmed twice, with the DB-level
backstop demonstrably firing** — this is the same class of defense as
`BUG-QA-001` (Phase 2 publish), and it holds here.

### 3.4 Content-readiness chain, not just the placement endpoint in isolation
- Placement against a `draft` (not-ready) content → `409` `"Content must be in \"ready\" status..."`.
- Attempted to move a **drama** content straight to `copyrightCleared: cleared` with no evidence → `400`
  `"Copyright gate: drama content requires a non-empty copyrightEvidenceUrl before it can be
  copyright-cleared (only the comedy pillar is exempt)."` — confirmed the drama-without-evidence
  content **cannot even reach the state** a placement would need, so the placement-layer copyright
  check (`assertPublishableContent`) is defense-in-depth on top of an already-enforced upstream gate,
  not the only thing standing between drama content and a placement.
- Cleared-comedy content (exempt from the evidence rule) placed successfully in every test above.

### 3.5 Throttle isolation — CommerceModule's own budget, proven not shared
`commerce.module.ts` registers its own `ThrottlerModule.forRootAsync(...)`
(name `'default'`, `limit: 5, ttl: 15min`), separate from `PublishModule`'s
and `CommentsModule`'s own repeated registrations of the same pattern. I
verified this is **not just a DI-registration nicety but a genuinely
separate rate-limit bucket** by reading `@nestjs/throttler`'s
`ThrottlerGuard.generateKey()`:
```js
generateKey(context, suffix, name) {
    const prefix = `${context.getClass().name}-${context.getHandler().name}-${name}`;
    return sha256(`${prefix}-${suffix}`);
}
```
The Redis key is `throttle:default:<sha256(ControllerClass-handlerMethod-default-ip)>`
— hashed per controller+handler, not just per throttler name — so even
though three modules all name their throttler `'default'`, their Redis keys
never collide.

Live proof: cleared all `throttle:*` keys in Redis db1, then fired 6
requests at `/api/commerce/placements/manual-external` (wrong password,
still counts):
```
401, 401, 401, 401, 401, 429   ← exhausted at exactly the 6th request (limit=5)
```
Immediately after (same exhausted state), hit the other two
password-carrying endpoints:
```
POST /api/posts/manual-external          → 400 (DTO validation) — NOT 429
POST /api/comments/:id/reply             → 400 (DTO validation) — NOT 429
```
Confirmed: exhausting commerce's budget did not touch posts' or comments'
budget, and vice versa was implied by the same key-derivation logic.
Cleared the throttle keys again afterward to leave a clean state.

**Verdict on 6A.5: all five guards (CSRF, step-up, copyright gate,
duration gate, active-duplicate) held under adversarial testing, and the
concurrency backstop was directly observed firing, not just asserted.**

---

## 4. Append-only conversions — backdoor hunting

| Attempt | Result |
|---|---|
| `PATCH /api/commerce/conversions/:id` | `404 Cannot PATCH ...` |
| `PUT /api/commerce/conversions/:id` | `404 Cannot PUT ...` |
| `DELETE /api/commerce/conversions/:id` | `404 Cannot DELETE ...` |
| `POST` with an `id` field naming an existing row (upsert attempt) | `400 ["property id should not exist"]` — whitelist rejects it outright, never reaches the service to even consider upserting |
| Negative `commissionAmount` (-101) with `reversalOfId` pointing at a real prior row | `201` — accepted as a **new row** |
| Re-fetch of the original row after the reversal | **Untouched** — `commissionAmount` still `101`, `reversalOfId: null`, same `createdAt` |
| Field-smuggling: `recordedBy`, `currency`, `status` in the create body | `400` — all three rejected by `forbidNonWhitelisted` |

No backdoor found. Append-only holds at the route level (no route exists),
the whitelist level (no id/status smuggling), and the data level (reversal
is additive, original is immutable).

### 4.1 One reconciliation-view finding (not a separation or append-only defect) — see BUG-QA-6A-01 below.

---

## 5. Anchors (6A.4) — concurrency and duplicate behavior

- **Idempotent duplicate**: fired 4 concurrent `POST .../product-anchors`
  with the same product against the same placement. All 4 returned `201`
  with the **identical anchor row id** (`e366fa08-...`), and a follow-up
  `GET` confirmed exactly one row exists. No duplicate rows, no 409 needed
  (idempotent-by-design, backed by the partial unique index as the
  race-proof layer underneath — matches the documented design).
- **Soft-remove / re-add history**: removed the anchor (`204`), confirmed
  the active list is empty, re-added the same product (`201`, new anchor
  id `103e2517-...`). Queried the table directly:
  ```
  id                                   | removed_at              | anchored_at
  e366fa08-39b9-40e8-beb0-0631ba14b1b2 | 2026-07-21 02:49:34.708  | 2026-07-21 02:49:03.59
  103e2517-b771-4c25-abf6-7c18bd034035 | (null)                   | 2026-07-21 02:49:34.828
  ```
  Confirmed: **history survives** — the original row is retained with
  `removed_at` set, not deleted; a new row represents the re-anchor.
- **Inactive (retired) product anchoring**: created a fresh product,
  retired it via the dedicated `POST /products/:id/retire` route, then
  attempted to anchor it to a *different* placement → `409` `"Product ...
  is retired and can no longer be anchored"`. Confirmed rejected.
- **Field-smuggling**: `recordedBy`, `removedAt` in the anchor body → `400`,
  both rejected by whitelist.

No findings.

---

## 6. Separation — attacked adversarially at the HTTP layer

### 6.1 Adversarial commerce fixture vs. payout/ranking
Sequence, all against the live Docker stack (not the e2e harness, which
already covers this at the DB layer — this repeats it one layer up):
1. Captured baseline `GET /api/dashboard/overview`, `/api/dashboard/revenue`,
   `GET /api/reports/revenue.csv`.
2. Created a conversion with `commissionAmount: 9999999` (THB ~10M, dwarfing
   any real payout figure in this environment) linked to a real placement.
3. Created a matching `commissionAmount: -9999999` reversal
   (`reversalOfId` pointing at the row from step 2).
4. Re-fetched all three endpoints and diffed byte-for-byte against the
   baseline.

Result:
```
dashboard/overview: only `generatedAt` timestamp differs — totals identical (all zero, unmoved)
dashboard/revenue:  only `generatedAt` timestamp differs — totalRevenue still 0
revenue.csv:        byte-identical (diff produced no output)
```

### 6.2 Ranking unaffected by commerce data on the same content
- Ranked a content (`817f1819`) that had **no** commerce data yet — captured
  the full 4-platform score + 5-factor reasoning JSON (v2 engine).
- Attached the ฿9,999,999 commission conversion from §6.1 to this same
  content's placement (i.e., commerce data now anchored to the content
  being re-ranked).
- Re-ranked the same content.
- Diffed both score arrays with `id`/`computedAt` stripped (those are
  expected to differ on every recompute): **byte-identical** — same scores,
  same 5 factors (`engagement_history`, `override_feedback`,
  `cadence_pressure`, `pillar_alignment`, `api_availability`), no new
  "commerce" factor appeared anywhere.

### 6.3 Commerce CSV vs. revenue CSV — separate route, no PII
```
GET /api/reports/revenue.csv   → Content-Disposition: attachment; filename="revenue-report.csv"
GET /api/reports/commerce.csv  → Content-Disposition: attachment; filename="commerce-report.csv"
```
Different routes, different filenames, both `Content-Type: text/csv;
charset=utf-8`. Grepped `commerce.csv` for `statement|buyer|note|email|
phone|address|John|Smith|customer` — **no matches**. Grepped `revenue.csv`
for `commerce|shopee|tiktok_shop|commission|affiliate|conversion` — **no
matches**. The commerce CSV's columns are exactly the aggregate/business
fields (`channel, period_start, period_end, orders_count, items_sold,
gross_sales_amount, commission_amount, currency, product_id, placement_id,
post_id, affiliate_link_id, source, recorded_by, created_at`) — no
`statement_ref`, no `note`, consistent with the SA-4 exclusion list cited in
the source comments.

**Separation held under all three adversarial angles tried.**

---

## 7. CommerceAdapterRegistry / mock adapters / boot guard

- **Mock determinism**: covered by the existing unit contract spec
  (`commerce-adapter.contract.spec.ts`, part of the 595 tests I re-ran from
  zero), which calls each mock method twice with identical input and
  asserts `toEqual`. I read the spec and the two mock adapter
  implementations (`mock-shopee.adapter.ts`, `mock-tiktok-shop.adapter.ts`)
  directly — both return static/derived-from-input values with no
  randomness or wall-clock dependence, consistent with the passing test.
  There is no HTTP-exposed endpoint that calls an adapter directly in 6A
  (no sync job wires `fetchProducts`/`fetchConversions` into a route), so
  there is nothing further to curl here — this is accurately a unit-level
  guarantee, not one I could additionally prove over HTTP.
- **Boot guard — live env var outside production**: ran a disposable
  container (`docker compose run --rm`, not the persistent stack) with
  `COMMERCE_IMPL_SHOPEE=shopee` and `NODE_ENV=development`:
  ```
  Error: Refusing to boot: COMMERCE_IMPL_SHOPEE resolved to a real (non-mock)
  adapter implementation while NODE_ENV="development" (not "production")...
  ```
  Repeated for `COMMERCE_IMPL_TIKTOK_SHOP=tiktok_shop` — same refusal.
  The persistent backend container (`content-hub-backend-1`, up the whole
  session) was never touched by these — confirmed via `docker compose ps`
  (uptime unchanged) and `docker compose exec backend printenv` showing
  `RANKING_ENGINE=v2` and no `COMMERCE_IMPL_*` override, i.e. no lasting
  env-var change.

---

## 8. Regression sanity

- 9 core endpoints spanning content CRUD, posts, dashboard (both), comments,
  scheduler, and all three commerce read routes: **all returned 200**
  throughout the session.
- `docker compose logs backend` for the full test window
  (`2026-07-21T02:30:00` onward): status-code histogram was
  `400×21, 401×7, 403×1, 404×5, 409×9, 422×5, 429×7`, **zero 5xx**. Every
  non-2xx code observed corresponds to a deliberate adversarial test in
  this report (guard rejections, throttle exhaustion, boundary tests) —
  none is an unexpected crash.

---

## 9. Bug list

| ID | Severity | Description | Repro | Recommendation |
|---|---|---|---|---|
| BUG-QA-6A-01 | **Low** | `CommerceConversionService.loadAndValidateReversalTarget` validates that a `reversalOfId` target shares the same `channel` and `currency`, but **not** the same `placementId`/`postId`. If an admin enters a reversal without re-supplying the original row's `placementId`/`postId`, the reversal nets correctly in the **global** `/api/commerce/summary` (grouped by currency/channel, no content scoping) but **not** in the **per-content** `/api/commerce/summary/:contentId` view, which joins conversions to a content only via `placementId`/`postId`. Result: a content's own commerce summary can show an inflated total until the admin notices the mismatch — the full ledger (`GET /api/commerce/conversions`) is still correct and complete, so this is a display/reconciliation-convenience issue, not a data-integrity or separation issue. Demonstrated live: created a conversion (+฿9,999,999) linked to a placement, reversed it with `reversalOfId` set but **no** `placementId`, and the per-content view showed the reversal absent (total still ฿9,999,999) even though the *global* summary correctly netted the pair to 0. A follow-up test with the reversal properly carrying the same `placementId` netted correctly in the per-content view. | See §4.1 / commerce-read.service.ts `conversionsForTargets` | Either validate that `reversalOfId`'s `placementId`/`postId` is copied automatically when omitted, or add a UI/API warning when a reversal's linkage fields don't match the row it reverses. Non-blocking for this gate — no payout/ranking exposure, no PII exposure, ledger itself is complete and auditable. |

**No Medium, High, or Critical bugs found.**

---

## 10. What I could not test / explicitly out of scope

- **AdminGuard rejecting a non-admin user**: not independently re-tested
  live in this pass (no non-admin test account was created, to avoid
  proliferating demo-DB users beyond the QA scope given). This guard is
  shared, unmodified code already covered by `admin.guard.spec.ts` (part of
  the 595 passing unit tests) and exercised in every phase back to Phase 1.
  I relied on that existing coverage rather than re-proving it fresh.
- **Live Shopee/TikTok Shop HTTP behavior**: does not exist by design
  (Decision 5, no HTTP client this phase) — confirmed by reading both live
  adapter files, which reject every method with a typed, audited error
  regardless of input. Nothing to test beyond the boot-guard refusal in §7.
- **Frontend/browser-based visual QA**: out of scope for 6A (backend-only
  phase per the WBS; 6B frontend has not been built yet).
- **Load/k6 testing**: not performed — no NFR throughput target is defined
  for 6A in the project plan beyond the throttle limits already verified
  functionally in §3.5.

---

## 11. Test data cleanup

All content and products created during this pass were cleaned up:

| Item | Action | Final state |
|---|---|---|
| 5 test contents (`0895c833`, `da34c4f7`, `817f1819`, `dfe01ce0`, `0ffada2b`) | `PATCH status: archived` | archived |
| 2 test products (`f82c88d6`, `1877f3ff`) | `POST /products/:id/retire` | `isActive: false` |
| Test placements (created via manual-external, e.g. `e28c3d18`, `a3921678`, `f79e5575`, `bf773ca9`) | **no delete/removal API exists for placements** — left in place, their owning content is now archived | permanent, by design (financial-record retention posture, `commerce.constants.ts`) |
| Test conversions (incl. the ฿9,999,999 fixture and its reversal, the `statementRef` boundary probes) | **append-only, no delete path exists** | permanent, by design |
| Redis `throttle:*` keys (db1) | cleared after each exhaustion test | clean at end of session |
| `COMMERCE_IMPL_SHOPEE` / `COMMERCE_IMPL_TIKTOK_SHOP` / `NODE_ENV` overrides | used only in disposable `docker compose run --rm` containers, never the persistent stack | persistent backend container untouched (verified: uptime unchanged, env unchanged, `RANKING_ENGINE=v2` unmodified) |

Note: I observed pre-existing leftover demo data from an earlier informal
(non-QA) pass — a retired "QA smoke product", a retired "Smoke Test
Product", and a `ready` "Smoke Test Content" — none of which I created.
I left these untouched since they predate this QA pass and are not mine to
clean up; flagging for whoever owns demo-DB hygiene.

---

## 12. Verdict

Zero Critical or High severity bugs found. One Low-severity, non-blocking
observation (BUG-QA-6A-01) about per-content reconciliation display, which
does not affect the append-only guarantee, the separation guarantee, or any
guard on the placement endpoint.

Every claim in the prior informal pass that fell within this pass's scope
was independently reproduced with fresh evidence (not re-read off logs):
595/595 unit tests, 14/14 e2e tests, all five 6A.5 guards individually
defeated/confirmed under adversarial conditions including live concurrency,
`statementRef` rejecting `'John Smith'` plus 6 additional edge cases,
`revenue.csv` clean of commerce vocabulary, dashboard/revenue/ranking
unmoved by a live ฿9,999,999 commission plus its reversal, and
CommerceModule's throttler independently confirmed isolated by key
derivation, not just by module boundary.

**SIGNED OFF — ready for DevOps.**

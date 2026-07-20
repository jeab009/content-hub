# Phase 6 — Commerce / Affiliate · System Analysis Report

- **Author**: Senior System Analyst (Loop Engineering position #3)
- **Date**: 2026-07-20
- **Input under review**: `docs/phase6-architecture-design.md` (1497 lines, read in full), `docs/phase6-project-plan.md` (§2 Decisions, §3.3 Exit criteria, Scope traps), `bussiness_rule.md` §"Commerce / Affiliate"
- **Code actually read for verification** (not taken from the design's claims): `backend/prisma/schema.prisma`, `backend/.eslintrc.cjs`, `backend/jest.config.js`, `backend/package.json`, `.github/workflows/ci.yml`, `backend/src/main.ts`, `backend/src/common/audit/{audit-log.service.ts,audit-log.constants.ts,audit-retention.service.ts}`, `backend/src/common/utils/{csv.util.ts,redact.util.ts}`, `backend/src/modules/reports/{reports.controller.ts,report-export.service.ts}`, `backend/src/modules/dashboard/dashboard.service.ts`, `backend/src/modules/ranking/ranking-factors-v2.service.ts`, `backend/src/modules/publish/{posts.controller.ts,publish.module.ts,step-up-auth.service.ts}`, `backend/src/modules/comments/comments.module.ts`, `backend/src/common/throttler/*`, `frontend/.eslintrc.json`, `frontend/src/` tree
- **Output to**: App Developer (6.0 build), with copies to PM, QC, QA

---

## 0. Verdict

**APPROVED WITH CONDITIONS.**

The design is strong and, in its central architectural judgement, correct. ADR-6.1 (no Prisma relation into commerce; hand-written FK DDL) is the right load-bearing choice and I sign it. ADR-6.3 (own append-only table, not a `metrics` discriminator) is correct and the plan's reasoning survives scrutiny — I confirmed by reading `ranking-factors-v2.service.ts:85-129` that the v2 `engagement_history` factor aggregates `_avg: { engagement, revenue }` directly off `prisma.metric`, so a discriminator really would have contaminated ranking on the first commerce row with no code change.

What blocks unconditional approval is not the architecture. It is that **three of the five separation layers, and two of the three PDPA controls, are specified as tests that the repository's current tooling would never execute**, plus a small number of concrete defects in the DTOs, the proposed regex, and the CSV path. These are all fixable inside 6.0/6A. None requires returning to the Designer.

Both mandated sign-offs are **YES WITH CONDITIONS**, and the conditions are numbered in §7.

---

## 1. SA-A — PDPA / no-buyer-data

### Answer: **YES, WITH CONDITIONS** (conditions A1–A6)

The claim under review: *no column in the five commerce tables is capable of holding buyer or order data.*

### What I verified, and what it establishes

| Control | Verified how | Holds? |
|---|---|---|
| Column inventory | Read every field table in design §1.3 for all five models. There is no `buyer_*`, `order_id`, `recipient`, `address`, `phone`, `email`, or per-transaction identifier. `orders_count` / `items_sold` are `Int` aggregate counters and cannot hold an identifier. | **Yes** |
| `ValidationPipe` whitelist | `backend/src/main.ts:57-61` — `whitelist: true, forbidNonWhitelisted: true, transform: true`, applied globally. A client genuinely cannot smuggle an unmapped field into a commerce write. | **Yes** |
| Adapter shape | `ConversionSnapshot` (design §3.5) has no buyer field. A future live adapter cannot hand order-level data to ingestion without editing a reviewed interface. | **Yes, but see A3** |
| Audit meta exclusion | `AuditLogService.record()` passes every entry through `redactSensitive` once and uses the same object for both sinks (`audit-log.service.ts:95-107`) — there is genuinely no code path that persists raw meta. Excluding `note`/`statementRef` from meta is therefore sufficient, provided the developer actually omits them. | **Yes** |
| Data-subject scope | The only personal data commerce introduces is `created_by` / `recorded_by` — the single admin user, already a data subject of the existing system. **Commerce introduces no new category of data subject.** This is the strongest part of the PDPA case and the design under-sells it. | **Yes** |

### Where the claim does not hold as written

**A-i — The regex the design recommends does not do what the design says it does.** §1.5 and the `CreateConversionDto` propose `@Matches(/^[A-Za-z0-9._\-\/ ]+$/)`, justified as *"a pasted name, address, phone or email fails validation."* The character class **includes a space**. `John Smith`, `Somchai P`, `Ratchada Rd 42` all pass. What it actually blocks is Thai script, `@`, `+`, `(`, `,` — so it blocks emails and Thai-language names and addresses, and it does not block Latin-script names. That is a partial control being described as a complete one. Digits pass unavoidably (`0812345678` is indistinguishable from a statement id by regex), which is acceptable, but the space is not.

**A-ii — The regex is on the DTO, so it does not protect the path it was written for.** The stated purpose of `ConversionSnapshot` is that a *future live adapter* cannot introduce buyer data. But `ConversionSnapshot.statementRef: string | null` flows from the adapter into `commerce_conversions.statement_ref` through the service, **not through a DTO** — class-validator decorators only run on HTTP request bodies. So on the exact future path the control exists to guard, the control is absent.

**A-iii — `commerce_placements.note` has no structural control at all.** It is 500 characters of free text — nearly eight times `statement_ref`'s blast radius — and the design's only answer is UI helper copy. §1.5 discusses `statementRef` at length and then quietly leaves `note` to policy.

**A-iv — There is no commerce retention rule, and the design does not mention retention once.** I checked the two existing regimes: `audit-log.constants.ts` — audit rows are permanent with `actor` anonymized in place after 90 days (`AUDIT_ACTOR_ANONYMIZE_AFTER_DAYS = 90`), deliberately not deleted because the copyright gate rests on them; `comments.constants.ts:59` — `RETENTION_MONTHS = 12`, hard delete. Commerce falls into neither. As designed, `commerce_conversions` and `commerce_placements` are **permanent, with two uncontrolled free-text fields and no erasure path**. Phase 4 built PDPA controls and a comment-erasure capability; commerce ships with neither. If a buyer identifier ever lands in `statement_ref`, there is today no job, no endpoint and no documented procedure to remove it.

This is the most substantive PDPA gap in the design, and it is a gap of omission rather than error. The fix is cheap because the pattern already exists: audit's *anonymize-in-place, keep the row* model is exactly right for financial records, which have a legitimate long retention basis under Thai accounting practice and must not be deleted wholesale.

### Conditions for SA-A

| # | Condition | Sub-phase |
|---|---|---|
| **A1** | Apply the `statementRef` format constraint, **without the space**: `^[A-Za-z0-9][A-Za-z0-9._\-\/]{0,63}$`. Anchored, length-bounded in the pattern itself, first character alphanumeric. Reject the design's proposed class. | 6.0.6 / 6A.7 |
| **A2** | Implement the constraint as an exported pure function (`assertStatementRefShape(value)`) in `modules/commerce/`, called by **the service**, with the DTO decorator as a second, redundant layer. The service call is the one that matters — it is the only one a future adapter path passes through. | 6A.7 |
| **A3** | Apply the same sanitizer to `ConversionSnapshot.statementRef` at the ingestion seam, not only to HTTP bodies. Add a `commerce-adapter.contract.spec.ts` case asserting an adapter returning `"Order #55123 — Somchai"` is rejected, not stored. | 6A.1 / 6A.7 |
| **A4** | Reduce `commerce_placements.note` to **200 characters** and add the same PDPA helper text. 500 characters is an invitation; 200 still holds *"reshot vertical, approved by admin 07-14"*. No regex — a note has genuine prose value and a regex here would be theatre. | 6.0.2 |
| **A5** | Write a **commerce retention position** into the 6.0.6 policy doc, and state it as: commerce rows are financial records and are **never deleted**; `statement_ref` and `note` are the **only** two fields capable of holding personal data and are **clearable in place** by an admin action (mirroring `AuditRetentionService.anonymizeExpiredActors`). Ship the clearing capability as a documented DB-level procedure in 6.0.6 — a UI is not required this phase, but the *procedure* is, because "we have no way to comply with an erasure request" is not an acceptable answer at a PDPA gate. | 6.0.6 |
| **A6** | The column allow-list test (§1.4.1) and the export byte test (§1.4.3) must be in a location jest actually collects — see **B1**. As specified they would never run, which would make the entire mechanical basis of SA-A vacuous. | 6.0.7 |

With A1–A6 applied, the honest and defensible statement of the PDPA posture is:

> Commerce introduces **no new data subject** and **no structural capacity** for buyer or order data. Two free-text fields remain capable of holding personal data if an admin deliberately types it; both are format- or length-constrained, neither is exported or audited, both are clearable in place, and the ingestion seam applies the same constraint as the HTTP seam.

That is a defensible signature. The design's stronger claim — *"no column capable of holding it"* — is not literally true and should not be signed as written.

---

## 2. SA-B — Commerce ⇄ payout separation

### Answer: **YES, WITH CONDITIONS** (conditions B1–B7)

The claim: *summing them is prevented structurally at five independent layers.* I probed each. The layers are **not** five of equal weight — they are one strong layer, one medium, and three that are currently either unexecutable or convention.

### Layer 1 — no Prisma relation into commerce. **HOLDS. This is the design's best idea.**

Verified the mechanism is real and the precedent is real. `schema.prisma:335-380` shows `Post` with explicit relation fields (`content`, `executor`, `rankingScore`, `metrics`, `comments`), and the schema comment at line 379 documents `posts_content_platform_active_key` as a partial unique index Prisma cannot express, declared in hand-written migration SQL. The technique is established in this repo, not invented for Phase 6.

The consequence the design claims is correct: with no relation field, `Post` gains no `productAnchors`, and `this.prisma.post.findMany({ include: { productAnchors: ... } })` inside `dashboard.service.ts` does not typecheck. The traversal genuinely is unspellable.

**Its limit, which the design states honestly:** it prevents *traversal*, not *access*. `PrismaService` exposes `prisma.commerceConversion` to every module that injects it, and injecting `PrismaService` is legitimate everywhere. Layer 1 stops the accidental `include`; it does not stop a deliberate second query. That is exactly the threat model the design declares (R1: a well-meaning "add a total revenue card"), so the limit is acceptable — but it means Layers 2 and 3 are carrying the rest, and those are weaker than advertised.

### Layer 2 — ESLint import zones. **HOLDS FOR BACKEND IMPORTS ONLY. Three gaps.**

`backend/.eslintrc.cjs` currently has no `overrides` key, so the addition is clean and additive. `npm run lint` is `eslint "{src,test}/**/*.ts" --max-warnings 0` and CI runs it before anything else — so a violation genuinely fails the build. Good.

Gaps:

- **G2a — The frontend has no equivalent and cannot get one for free.** `frontend/.eslintrc.json` is exactly `{"extends": "next/core-web-vitals"}`. There is no restricted-import zone, and the design's Layer 2 is backend-only. Since the commerce dashboard section is added to `frontend/src/app/dashboard/page.tsx` — the same page and the same component tree as the payout KPI cards — the frontend is where a summation is *most* likely to be written, and it is the layer with the least enforcement.
- **G2b — The zone list is incomplete.** It names `ranking`, `metrics`, `dashboard`, `reports/report-export.service.ts`. It omits `modules/scheduler/`, `modules/content/`, `modules/queue/`, `modules/publish/`, and all of `common/`. A shared helper in `common/utils/` that imports both sides would pass lint, and "no combined total anywhere" (scope trap #4) is a system-wide rule, not a four-directory rule.
- **G2c — The one sanctioned bridge is the most dangerous file in the phase.** The design deliberately exempts `reports/reports.controller.ts` so it can mount `commerce.csv`. I read that file: it is where all three CSV `Content-Disposition` headers and the `report_exported` audit call live. It is therefore the single file in the codebase permitted to see both `ReportExportService` and `CommerceExportService` — i.e. the exact file where a `commission_thb` column could be appended to `revenue.csv`. The exemption is correct (forcing commerce export into the payout service would be worse), but it must be paid for with a specific guard.

### Layer 3 — the static boundary test. **DOES NOT HOLD AS SPECIFIED. Critical.**

Two findings, the first of which is decisive.

**G3a — The test would never run.** `backend/jest.config.js` is `rootDir: 'src'`, `testRegex: '.*\\.spec\\.ts$'`. The design places its tests at:

- `backend/test/schema-freeze.spec.ts`
- `backend/test/commerce-boundary.spec.ts`
- `backend/test/payout-unaffected-by-commerce.e2e-spec.ts`

`backend/test/` exists but is **empty**, and with `rootDir: 'src'` jest will not collect anything in it. Additionally, `payout-unaffected-by-commerce.e2e-spec.ts` would not match `.*\.spec\.ts$` even under a corrected rootDir — the regex requires a literal dot before `spec`, and `e2e-spec` has a hyphen.

The consequence is severe and quiet: **exit criterion #1 (enum freeze), exit criterion #6 (byte identity), the column allow-list test, the export byte test and the boundary scan would all report green by never having run.** The suite count would rise by zero and nobody would notice, because nothing fails. This single configuration mismatch would hollow out the phase's entire definition of done while every gate reported success. It is the most important finding in this review.

**G3b — The `*.spec.ts` exclusion, assessed as the Designer asked.** My ruling: **close it, and it costs almost nothing to close.**

The Designer's justification is that the payout regression fixture must legitimately seed commerce rows. But given `rootDir: 'src'`, that fixture does not belong in a scanned directory in the first place. The exclusion exists to solve a problem the correct file layout does not have. Concretely: put the seeding helpers in `src/testing/commerce-fixture.ts` — outside `ranking`/`metrics`/`dashboard`/`reports` — and the scan can cover **every** `.ts` file under those four directories with no exclusion at all.

That said, I want to be precise about how big the hole actually is, because the design over-states it as a risk: production files are never named `*.spec.ts`, so the exclusion never admits production code. It is a hygiene hole, not a correctness hole. Close it because it is free, not because it is dangerous.

**G3c — The reverse-check token list will produce false positives.** The design proposes scanning commerce files for `'metrics'` and `'ranking_scores'` as bare substrings. The word "metrics" appears in ordinary English prose and will match any comment in commerce code mentioning metrics — including comments explaining *why* commerce does not touch metrics. Use word-boundary regexes (`/\bprisma\.metric\b/`, `/\branking_scores\b/`) and scan code with comments stripped, or the test becomes noise the team learns to edit around.

### Layer 4 — the byte-identity fixture. **CORRECT IN CONCEPT, NOT CURRENTLY BUILDABLE.**

This is the layer that would make the separation a proof, and its design is genuinely good — `score::text` rather than `Number(score)`, comparing `reasoning` JSON, an adversarial fixture with commission an order of magnitude above payout revenue and at least one negative reversal, re-ranking *after* commerce exists. I have no criticism of the test's specification. I checked its premise and it is sound: `ranking-factors-v2.service.ts:85-129` aggregates strictly over `prisma.metric`, so commerce genuinely cannot reach a score except through code someone writes on purpose — which is what the test is for.

The problem is infrastructure. I inventoried the existing suite: **39 `*.spec.ts` files, all unit-style with a mocked `PrismaService`.** There is exactly one supertest file (`content.controller.spec.ts`) and it mocks every dependency; `grep -rl "new PrismaClient" src` returns nothing. **This project has never had a test that touches a real database.** The byte-identity fixture needs migrations applied, a booted Nest app, seeded payout data, persisted `ranking_scores` under `RANKING_ENGINE=v2`, HTTP calls, and raw-buffer comparison. That is a new test category, not a new test.

The good news, which the design does not mention: it is feasible. `.github/workflows/ci.yml` **already** provisions `postgres:16-alpine` and `redis:7-alpine` as services, sets `DATABASE_URL`, and runs `npx prisma migrate deploy` before `npm test`. The missing pieces are a second jest project and a CI step — a bounded task, but a real one that the plan sizes inside 6.0.7 ("M") alongside four other tests. It should be its own work package.

### Layer 5 — vocabulary separation. **WEAKEST LAYER. Convention plus one test.**

Layers 1–4 are backend. Layer 5 is the only thing standing between a developer and `overview.totals.revenue + summary.commissionAmount` in JSX, and it consists of a naming convention, a "no shared props type" convention, and one UI assertion. Three concrete problems:

- **G5a — The UI test as specified will not catch the bug it is written for.** *"Assert that no rendered numeric text node equals `payoutTotal + commerceTotal`"* — but the page renders `฿ 140,690.00` via `formatTHB`, and the sum computed in the test is `140690`. Unless the test formats the expected value through the identical formatter, it compares `"฿ 140,690.00"` to `"140690"` and passes on a broken page. It must assert against `formatTHB(payoutTotal + commerceTotal)` and, because rounding differs, also against the ±0.01 neighbours.
- **G5b — There is a second summation surface the design never assigns.** `GET /api/commerce/summary/:contentId` is specified in §3.2, but §4 never says where `ContentCommerceSummaryDto` is rendered. The only existing per-content money page is `frontend/src/app/dashboard/revenue/[contentId]/page.tsx` — the **payout drill-down**. Putting a per-content commerce total on the per-content payout page is the highest-risk juxtaposition in the phase, and §4.6's six separation signals are designed only for `/dashboard`. The 6B.5 test covers only `/dashboard` too. Either the endpoint gets a designed, separated surface, or it should not ship in v1.
- **G5c — No frontend lint zone.** See G2a. This is cheap to add and it is the only mechanical control available on the layer that most needs one.

### Is any layer's failure making the others cosmetic?

Yes — **G3a does exactly that**, and it is why SA-B cannot be signed unconditionally. Layers 3 and 4, and the enum-freeze and column-allow-list tests supporting SA-A, are all specified into a directory jest does not read. If 6.0 ships as written, the team would hold a green board while four of its six mechanical controls had never executed once. Layer 1 would still hold, because it is a compile-time property rather than a test — which is a nice validation of the Designer's instinct that the load-bearing layer should not be a test. But the claim "five independent layers" would in practice be "one layer plus some lint."

### Conditions for SA-B

| # | Condition | Sub-phase |
|---|---|---|
| **B1** | **Fix the test topology before writing any separation test.** Either (a) add a second jest project — `jest.e2e.config.js` with `rootDir: '.'`, `testRegex: '\\.e2e-spec\\.ts$'`, plus an `npm run test:e2e` script and a CI step after `prisma migrate deploy`; or (b) move every separation test under `src/` with a `.spec.ts` name. Recommended: **(a) for the byte-identity fixture, (b) for enum-freeze, column-allow-list, boundary-scan and export-byte tests** — those four are pure static/introspection checks that belong in the fast unit suite. Whichever is chosen, **prove it by making each test fail on first commit and observing the failure in CI output.** A separation test that has never been seen to fail is not evidence. | 6.0.7 |
| **B2** | Build the real-DB e2e harness as its **own work package** in 6.0, not a line item inside 6.0.7. Scope: jest e2e project, a `beforeAll` that applies migrations against the CI Postgres, a deterministic payout seed with fixed uuids and fixed `collectedAt`, and the `captureBaseline()` helper. CI already provides Postgres and Redis, so the infrastructure cost is a config file and a workflow step, not a container. | 6.0.7 (new WP 6.0.8) |
| **B3** | Drop the `*.spec.ts` exclusion from the boundary scan. Put seeding helpers in `src/testing/commerce-fixture.ts`, outside the four scanned directories. Use word-boundary regexes and strip comments before scanning (G3c). | 6.0.7 |
| **B4** | Extend the ESLint zones to `src/modules/scheduler/**`, `src/modules/content/**`, `src/modules/queue/**`, `src/modules/publish/**` and `src/common/**` on the payout side of the ban. The rule is system-wide; the config should be too. | 6.0.7 |
| **B5** | Add a **frozen-header test for all three existing CSVs** (`revenue`, `override-log`, `comment-summary`) asserting the header array deep-equals a literal. This is the specific price of the `reports.controller.ts` exemption (G2c). The byte-identity test covers `revenue.csv` only when the fixture runs; the header freeze covers it always and is a two-line unit test. | 6.0.7 |
| **B6** | Add a restricted-import zone to `frontend/.eslintrc.json` (`next/core-web-vitals` + a `no-restricted-imports` override) banning commerce modules from payout components and vice versa, mirroring the backend zones. Fix the 6B.5 UI assertion to compare through `formatTHB` (G5a). | 6.0.7 / 6B.5 |
| **B7** | **Decide `GET /api/commerce/summary/:contentId` (G5b).** My ruling: **ship the endpoint, do not render it on `/dashboard/revenue/[contentId]` this phase.** Surface it on the *placement detail* and *post detail* views, which are commerce/publish surfaces with no payout total in the same viewport. Revisit a per-content combined view only with its own separation design. | 6A.8 / 6B |

With B1–B7, I sign SA-B. Without B1 specifically, the sign-off would be meaningless, and I would rather state that plainly than sign a claim I have shown cannot execute.

---

## 3. Adjudication of SA-1 … SA-10

Decisive rulings, as requested.

### SA-1 — free-text `statement_ref` / `note` · **AGREE with the direction, REJECT the specific regex** · Severity: **HIGH**

Apply a format constraint — yes. But not the one proposed: the space in `[A-Za-z0-9._\-\/ ]` defeats the stated purpose (a Latin-script personal name passes). **Use `^[A-Za-z0-9][A-Za-z0-9._\-\/]{0,63}$`.** Additionally the control must live in the service, not only the DTO, or it does not cover the adapter path it was written to protect (A-ii). And `note` must not be left to policy alone — cut it to 200 characters (A-iii/A4). See conditions **A1–A4**.

### SA-2 — `reversal_of_id` is a PDPA control · **AGREE** · Severity: **MEDIUM** · in scope for 6.0.2

The argument is sound and slightly unusual in a good way: absence of a structured "this cancels that" field creates pressure to encode the linkage in free text, which is where PII enters. Confirmed in scope.

**Two additions the design omits:** add `CHECK (reversal_of_id <> id)` (a row cannot reverse itself), and validate in the service that the reversed row shares the same `channel` and `currency`. A reversal pointing at a different channel is meaningless data that the summary would then net across streams.

### SA-3 — anchoring requires no step-up · **AGREE** · Severity: **LOW** · confirmed

The reasoning is correct and I endorse it including the second-order argument, which is the important one: step-up on a bookkeeping entry trains reflexive password entry and measurably degrades step-up where it matters. `step-up-auth.service.ts` documents password-per-request precisely to keep each confirmation a deliberate act; diluting it across low-stakes routes would undo that. CSRF + AdminGuard + audit is the correct stack for anchoring. Confirmed.

### SA-4 — audit meta exclusion list · **AGREE, with one correction** · Severity: **MEDIUM**

Excluding `note`, `statementRef`, product `name` and affiliate `url` from audit meta is right, and I verified it is sufficient: `AuditLogService.record()` redacts once and reuses the same object for both the log line and the row (`audit-log.service.ts:95-107`), so there is no path that persists unredacted meta.

**Correction:** `redactSensitive` matches `SENSITIVE_FIELD_PATTERNS` by case-insensitive **substring**, and the list includes `'code'` (for OAuth authorization codes). Therefore `trackingCode` in audit meta will be silently written as `[REDACTED]`. If the developer intends tracking codes to be auditable, that will not work and will look like a bug. Either accept it (fine — a tracking code is not needed in the audit trail) or rename the meta key. Document the choice so QA does not file it.

### SA-5 — copyright gate on the placement path records but cannot block · **AGREE** · Severity: **LOW** · reasoning still holds

It holds, and it holds *more* firmly than in Phase 5, for a reason worth stating: the gate's value is entirely the audit trail, and the audit trail is now durable (`audit_logs` persisted in 5D). The Phase 5 argument was made when audit rows died on container recreate; that objection is gone. A third record surface does not weaken it. Confirmed.

### SA-6 — new step-up / rate-limit surface · **AGREE it needs a ruling; the premise is factually wrong** · Severity: **MEDIUM**

The design says this is "the third password-carrying endpoint" and that the total is "15 attempts/15min against one credential." I counted the actual call sites:

```
src/modules/publish/posts.controller.ts:53    POST /api/posts                  @Throttle(STEP_UP_RATE_LIMIT)
src/modules/publish/posts.controller.ts:73    POST /api/posts/manual-external  @Throttle(STEP_UP_RATE_LIMIT)
src/modules/publish/posts.controller.ts:87    POST /api/posts/:id/publish      @Throttle(STEP_UP_RATE_LIMIT)
src/modules/comments/comments.controller.ts:92   (reply)                       @Throttle(STEP_UP_RATE_LIMIT)
src/modules/comments/comments.controller.ts:111  (retention purge)             @Throttle(STEP_UP_RATE_LIMIT)
```

Five password-carrying routes exist today, not two. `@nestjs/throttler` v6 keys per handler (confirmed: `RedisThrottlerStorageService.increment` builds `throttle:${throttlerName}:${key}` where `key` includes class+handler), so the current budget is **5 routes × 5 = 25 attempts / 15 min** against one credential, and commerce placement makes it **30**. The design under-counts by 40%.

**Ruling: acceptable for now, but stop letting it grow implicitly.** 30 online guesses per 15 minutes against an Argon2id hash held by a single admin with a strong password is not a practical break, and login lockout still guards the primary credential path. But the trend is one-way, and it is exactly the kind of emergent property the design was right to flag.

**Required in 6A.5:** the commerce placement step-up must pass a `failureAction` and its failures must carry the **shared** `meta.reason: 'step_up_reauth_failed'` string, which `step-up-auth.service.ts` documents (condition C6a) as the aggregation key for brute-force detection across actions. If the new route invents its own reason, cross-route detection silently loses the newest surface — which is the one an attacker would pick.

**Recommended in 6C (not blocking):** add a step-up-failure counter keyed on `userId` alone, independent of route, that locks after N failures across all step-up routes. That converts a per-route budget into a per-credential one and makes the count stop growing with every new endpoint. Log it as tech debt if not done this phase.

### SA-7 — extend `assertPublisherFlagsAreSafe` rather than duplicate · **AGREE** · Severity: **LOW**

Correct shape. I read `main.ts:86-111`: the function builds a `nonMockFlags` array, throws outside production, warns inside it. Extending the array to six entries and renaming to `assertAdapterFlagsAreSafe` is a small, safe edit that keeps one refusal policy. A parallel function would be two policies that drift. Confirmed.

Note the rename touches `main.ts` and its call site at line 67 — trivial, but it is a real edit to a boot path, so it belongs in 6.0.5 with a test that boot refuses when `COMMERCE_IMPL_SHOPEE=shopee` and `NODE_ENV=test`.

### SA-8 — `commerce_report_exported` as a distinct action · **AGREE** · Severity: **LOW**

Correct, and the justification checks out against the schema: `audit_logs` is indexed on `(action, createdAt)`, so a distinct action is queryable and a meta discriminator is not. Also consistent with the existing `AuditAction` union style — a typed member rather than a free string. Confirmed.

### SA-9 — currency stored as received, never converted · **AGREE, and it is correctly identified as pre-migration** · Severity: **HIGH** (schedule), MEDIUM (correctness)

Store as received, never convert, and the summary must group by currency rather than emit one wrong number. Confirmed.

**Three additions:**
1. Add `CHECK (currency ~ '^[A-Z]{3}$')` on all money-bearing tables. **CORRECTION (Bug Fixer, P6-QA-1, 2026-07-20): there are TWO, not three** — `commerce_products` and `commerce_conversions`. `affiliate_links`, `product_anchors` and `commerce_placements` carry no money column and correctly carry no currency CHECK. The delivered migration implements 2, matching `docs/phase6-commerce-pdpa-separation-policy.md` §6; QA and DevOps each confirmed this live via `\d+` on all five tables. This line's original "three" was wrong and is corrected here so 6A does not inherit it. `@db.Char(3)` is blank-padded and accepts `'xx '`, `'123'`, or lowercase; the CHECK costs nothing and prevents a `'thb'`/`'THB'` split that would silently fragment every group-by.
2. **This does not need to block the migration.** The column exists either way — that is the expensive, irreversible part, and the design already includes it. Whether non-THB statements are *expected* only determines whether the v1 service **rejects** non-THB on write. Recommendation: ship the column, add a service guard rejecting anything but `THB` in v1, and note that relaxing a guard later is free whereas adding a column later is not. This removes SA-9 from the critical path without weakening it — the admin's answer can arrive during 6A.
3. The commerce summary must **never** produce a total across currencies even if the guard is later relaxed. Assert it with a test that seeds one THB and one non-THB row and asserts the response contains two groups and no scalar grand total.

### SA-10 — `auth.login.failure` stores an email in `actor` · **AGREE it is not worsened; ACTION still owed** · Severity: **LOW** for Phase 6

Correct that no commerce action introduces PII. And I verified the carry-forward is already partly handled, which the note does not credit: `AuditRetentionService.anonymizeExpiredActors` overwrites those actors after 90 days, idempotently, and `AUDIT_ACTIONS_WITH_ATTEMPTED_IDENTIFIER = ['auth.login.failure']`. So the open item is narrower than "an email is stored forever" — it is "an email is stored for 90 days, and the anonymizer has no scheduler." Confirm with DevOps that the anonymizer is actually invoked on a schedule; if it is not, that is the real open item and it is unrelated to commerce. Not a Phase 6 blocker either way.

---

## 4. STRIDE pass over the new surfaces

Scored DREAD-style; only findings at Medium or above are listed, plus the notable Lows.

### 4.1 `POST /api/commerce/placements/manual-external`

| Threat | Assessment |
|---|---|
| **S** — Spoofing | Session + AdminGuard + step-up password per request. Mirrors `posts/manual-external` exactly. **Adequate.** |
| **T** — Tampering | `ValidationPipe` whitelist blocks field smuggling; `status`/`source`/`recordedBy`/`version` are server-set. `version` optimistic-concurrency guard matches `Post.version`. **Adequate.** |
| **R** — Repudiation | `commerce_placement_recorded` audited to durable `audit_logs`. **Adequate** — provided the step-up failure reason string matches SA-6. |
| **I** — Info disclosure | `note` free text is the only exposure; not audited, not exported. **Adequate with A4.** |
| **D** — DoS / password oracle | 5/15min per route. **MEDIUM — implementation trap:** `ThrottlerModule` is registered **per importing module** in this codebase, deliberately and with a comment saying so (`publish.module.ts:33-42`, repeated verbatim in `comments.module.ts:34-41`). `CommerceModule` must register its own `ThrottlerModule.forRootAsync` with `RedisThrottlerStorageModule`. If the developer assumes it is inherited from `PublishModule` (which it is not — `PublishModule.exports` is `[PlatformAdapterRegistry, StepUpAuthService]` only), the endpoint either fails DI at boot or, worse, ships without a working throttle. **Name this explicitly in 6A.5.** |
| **E** — Elevation | AdminGuard at controller level, single admin role. **Adequate.** |

### 4.2 Anchor endpoints (`/posts/:id/product-anchors`, `/placements/:id/product-anchors`)

| Threat | Assessment |
|---|---|
| **S/E** | CSRF + AdminGuard, no step-up. Endorsed (SA-3). **Adequate.** |
| **T** | **MEDIUM — DTO defect.** `RecordProductAnchorsDto.affiliateLinkIds?: (string \| null)[]` is decorated `@IsUUID('4', { each: true, always: false })` and documented as *"`null` entries mean 'no link'"*. class-validator applies `each` to **every** element including `null`, so a `null` entry fails validation and the documented contract is unreachable. Also, the two arrays' lengths are never asserted equal, so an index-aligned pairing can silently misalign and attach the wrong link to the wrong product — which the composite FK `(affiliate_link_id, product_id)` would then reject with a 500-shaped FK error rather than a clean 400. **Fix:** use `@IsOptional()` per element via a custom validator or accept `Array<{productId, affiliateLinkId?}>` objects instead of two parallel arrays. The object form removes the alignment class of bug entirely and I recommend it. |
| **T** | **LOW** — `@IsUUID('4')` version-pins where the rest of the repo uses bare `@IsUUID()`. Match the repo convention; a version pin buys nothing and can reject a legitimate id. |
| **R** | `product_anchor_recorded` / `_removed` audited; soft-remove preserves history. **Adequate.** |
| **D** | `@ArrayMaxSize(50)` bounds the batch. No throttle, but the write is cheap and admin-only. **Adequate.** |

### 4.3 `POST /api/commerce/conversions` (append-only)

| Threat | Assessment |
|---|---|
| **T** | **MEDIUM — no idempotency, and the design's answer to R8 does not cover the real case.** There is no unique constraint anywhere on `commerce_conversions` and no idempotency key. The overlap-check is warn-only and probes *period overlap*, which catches "I entered week 29 twice on two different days" but **not** the common case: a double-click or a client retry submitting the identical body twice within a second. Both rows land, the commerce total inflates, and because the table is append-only the only correction is a compensating negative row. The plan scores R8 at 9 and the mitigation as specified does not address its most likely trigger. **Fix (6A.7):** reject a byte-identical payload from the same user within a short window (e.g. 60s) with 409, or accept a client-generated `Idempotency-Key`. Cheap, and it preserves the append-only model. |
| **I** | `statementRef` — covered by A1–A3. |
| **R** | `commerce_conversion_added` audited; no PATCH/DELETE route, asserted by a route-absence test. **Adequate** — provided that test runs (B1). |
| **E** | Negative amounts are legal by design, bounded `±99,999,999.99`. Correct: a reversal must be expressible. **Adequate.** |

### 4.4 `GET /api/reports/commerce.csv`

| Threat | Assessment |
|---|---|
| **I** | **MEDIUM — the CSV is the one place both streams are one function call apart** (G2c). Mitigate with B5 (frozen headers on all three existing CSVs). The design's own export byte test covers the commerce file; nothing currently covers the *payout* file against gaining a commerce column, except the byte-identity fixture, which is the test most at risk of not running. |
| **T** | **MEDIUM — CSV formula-prefix defect, specific to commerce.** `escapeCsvField` (`csv.util.ts:39-42`) prefixes any cell starting with `= + - @` with a single quote. That is correct anti-injection behaviour and it has never mattered, because `revenue` is never negative. In commerce, **negative reversals are a designed, routine value** — the design's own §4.5 history mock shows `−฿ 240.00`. Every reversal row will export as `'-240.00`, a text cell that Excel will not sum. An admin reconciling the export against a payout statement gets a total that silently excludes every reversal — a money error, in the phase whose entire premise is not producing money errors. **Fix (6A.9):** in `escapeCsvField`, skip the formula-prefix guard when `typeof value === 'number'` (a number literal cannot carry an injection payload), and have the commerce exporter pass amounts as numbers rather than `.toFixed(2)` strings. Add a test asserting a negative commission round-trips as a numeric cell. Verify the change does not alter existing CSV bytes — it will not, since every current caller passes strings. |
| **R** | `commerce_report_exported` distinct action. **Adequate** (SA-8). |
| **D** | No pagination bound on the export. Same posture as existing reports; catalog is tens of rows. **Low, accept.** |

### 4.5 Mock / live adapter seam

| Threat | Assessment |
|---|---|
| **S** | Mocks reject `credentials: null`, faithful to live. Good — this is the detail that makes a rehearsal meaningful. **Adequate.** |
| **T/I** | **MEDIUM** — `ConversionSnapshot.statementRef` is the unsanitized ingestion path (A-ii/A3). This is the one place where the PDPA control and the adapter design fail to meet. |
| **E** | `COMMERCE_IMPL_*` boot refusal outside production, Joi-defaulted to `mock`. **Adequate** with SA-7. |
| **D** | Live stubs throw and are audited. **Adequate.** |

---

## 5. Things the design missed

Beyond the items already folded into SA-A/SA-B and STRIDE:

1. **`PublishModule` already exports `StepUpAuthService`.** Design §2.6 says it *"must be added to `PublishModule`'s `exports`* — a one-line change; note it for QC as a real, if trivial, edit to an existing module."* It was added in Phase 4 for `CommentsModule`; `publish.module.ts:63` reads `exports: [PlatformAdapterRegistry, StepUpAuthService]`. **No edit is needed.** Minor in itself, but it is a claim about existing code that was not checked, which is why I re-verified the others.

2. **`CommerceModule` → `PublishModule` → `RankingModule` transitively.** Importing `PublishModule` for `StepUpAuthService` pulls `RankingModule` into the import graph (`publish.module.ts:45`). No DI reachability results, because `PublishModule` re-exports only the registry and step-up service — so the separation is not breached. But the ESLint zone bans commerce from importing `**/modules/ranking/**` while the module graph connects them one hop away, and a future `PublishModule` export could quietly change that. Prefer extracting `StepUpAuthService` into `common/` (it depends only on `PrismaService` + `AuditLogService`) so `CommerceModule` imports nothing from `publish`. Not blocking; note for QC.

3. **`prisma migrate dev` drift is a standing operational hazard, not a one-time review item.** With five tables' FKs, CHECKs and partial indexes living only in migration SQL, every subsequent `migrate dev` will propose "fixing" the drift. The design lists this as a cost with the mitigation *"QC checklist item: `migrate diff` output is reviewed, not auto-applied."* A checklist item is a policy control on a repo that has otherwise consistently converted policy into mechanism. Recommend a CI step running `prisma migrate diff --from-migrations --to-schema-datamodel` and failing on unexpected drift — the same instinct as the enum-freeze test, applied to the DDL the enum-freeze test cannot see.

4. **`anchor_position` has no uniqueness per target.** Two anchors on the same post can both claim position 1; the UI orders by it. Cosmetic, but the drag-reorder UX in §4.3 implies a total order the schema does not guarantee. Either add a partial unique index on `(post_id, anchor_position) WHERE removed_at IS NULL` or document that ties break by `anchored_at`.

5. **Nothing defines what happens to commerce rows when a `Content` or `Post` is archived.** `content_archived` exists as an audit action; FKs are `ON DELETE RESTRICT`, so nothing breaks, but an archived content's active placement stays active and continues to appear in `/commerce/placements` and in the commerce summary. Decide in 6A.8: either filter archived content out of the commerce summary, or state that commerce records survive content archival deliberately (my preference — a commission was really earned). Either way it should be a decision, not a discovery in QA.

6. **The design has no rollback note.** ADR-6.3 says *"rollback is a table drop"*, but `content_assets.duration_seconds` is also part of the migration and dropping it loses parsed durations. A one-paragraph rollback procedure in 6.0.6 (drop five tables + three enums; leave `duration_seconds`, which is harmless and additive) makes the "clean rollback" claim concrete.

---

## 6. Non-functional requirements for Phase 6

Measurable, testable, handed to QA.

| ID | Requirement | Target | Verified by |
|---|---|---|---|
| NFR-6.1 | Payout endpoints unchanged with commerce data present | Byte-identical response bodies for `/dashboard/overview`, `/revenue`, `/revenue/:contentId` (modulo the single documented `generatedAt` normaliser) | 6.0.8 byte-identity fixture |
| NFR-6.2 | `revenue.csv` unchanged | `Buffer.compare(...) === 0`, unnormalised | 6.0.8 |
| NFR-6.3 | Ranking scores unchanged | `score::text` and `reasoning` JSON identical for every row, after re-rank with commerce present | 6.0.8 |
| NFR-6.4 | Enum stability | `Object.values(Platform)` and `Object.values(AssetPlatform)` deep-equal frozen literals | enum-freeze unit spec |
| NFR-6.5 | Commerce column inventory | Introspected column list for all 5 tables deep-equals a frozen array | column-allow-list unit spec |
| NFR-6.6 | Commerce CSV contains no PII-shaped value | No cell matches email / phone / Thai national id regex; header deep-equals frozen literal | export byte test |
| NFR-6.7 | Payout CSV headers frozen | All three existing report headers deep-equal frozen literals | B5 |
| NFR-6.8 | Duration gate fail-closed | 422 for `null`, `9`, `61`; 201 for `10`, `42`, `60`; DB CHECK rejects a direct NULL insert for `shopee` | 6A.5 + a migration-level negative-insert test |
| NFR-6.9 | Existing upload behaviour unchanged | `upload-validation.service.spec.ts` passes **with zero edits** | 6A.6 |
| NFR-6.10 | Step-up brute-force detectability | Every commerce step-up failure carries `meta.reason: 'step_up_reauth_failed'` | 6A.5 |
| NFR-6.11 | Append-only | `PATCH`/`DELETE` on `/api/commerce/conversions/:id` → 404/405 | route-absence spec |
| NFR-6.12 | Commerce summary never crosses currency | Two-currency fixture yields two groups and no scalar grand total | 6A.8 |

The plan's target of +60–85 backend tests over the 406 baseline looks right, with the caveat that 6.0.8 (the e2e harness) is net-new infrastructure whose cost is mostly setup rather than test count.

---

## 7. Conditions of approval — consolidated must-fix list

Each tied to a sub-phase. **A1–A6 and B1–B7 are the sign-off conditions**; C1–C7 are the findings from §3–§5 that must also land.

### Blocking 6.0 gate closure

1. **B1** — fix the jest test topology; prove each separation test fails first, in CI output. *(6.0.7)*
2. **B2** — real-DB e2e harness as its own work package. *(new WP 6.0.8)*
3. **A5** — commerce retention + erasure-procedure position written into the 6.0.6 policy doc. *(6.0.6)*
4. **A1** — `statementRef` pattern `^[A-Za-z0-9][A-Za-z0-9._\-\/]{0,63}$`, no space. *(6.0.6 decision, 6A.7 code)*
5. **A4** — `note` capped at 200 characters. *(6.0.2 — must be in the migration)*
6. **SA-9 / C1** — `CHECK (currency ~ '^[A-Z]{3}$')` on all money-bearing tables — **two of them: `commerce_products` and `commerce_conversions`** (see §-correction above); ship the column, guard non-THB in the service. *(6.0.2)*
7. **SA-2 / C2** — `CHECK (reversal_of_id <> id)`; service validates channel+currency match. *(6.0.2)*
8. **B3, B4, B5, B6** — boundary-scan exclusion removed and fixture relocated; ESLint zones extended; frozen CSV headers; frontend lint zone. *(6.0.7)*

### Blocking 6A

9. **A2 / A3** — `assertStatementRefShape` in the service and at the adapter ingestion seam, with an adapter-contract test. *(6A.1 / 6A.7)*
10. **C3** — `CommerceModule` registers its own `ThrottlerModule.forRootAsync` with `RedisThrottlerStorageModule`; test asserts the 6th request in 15 min returns 429. *(6A.5)*
11. **C4** — commerce step-up failures carry `meta.reason: 'step_up_reauth_failed'`. *(6A.5)*
12. **C5** — replace `RecordProductAnchorsDto`'s two parallel arrays with `Array<{ productId, affiliateLinkId? }>`; drop the `'4'` version pin. *(6A.4)*
13. **C6** — conversion idempotency: identical payload from the same user within 60s → 409, or an `Idempotency-Key` header. *(6A.7)*
14. **C7** — `escapeCsvField` skips the formula-prefix guard for `typeof value === 'number'`; commerce exporter passes amounts as numbers; test that a negative commission exports as a numeric cell **and** that existing CSV bytes are unchanged. *(6A.9)*

### Blocking 6B

15. **B7** — `GET /api/commerce/summary/:contentId` rendered on placement/post detail, **not** on `/dashboard/revenue/[contentId]` this phase. *(6B)*
16. **G5a** — 6B.5 assertion compares through `formatTHB`, including ±0.01 neighbours. *(6B.5)*

### Should-fix (6C, non-blocking)

17. Per-credential step-up failure counter independent of route (SA-6 second-order). 
18. `prisma migrate diff` drift check in CI (§5.3).
19. Archived-content behaviour for placements/summary decided explicitly (§5.5).
20. Rollback paragraph in 6.0.6 (§5.6).
21. Extract `StepUpAuthService` to `common/` so commerce does not import `PublishModule` (§5.2).

---

## Handoff summary — App Developer building 6.0

- **Before you write a single separation test, fix where tests live.** `backend/jest.config.js` is `rootDir: 'src'`, `testRegex: '.*\.spec\.ts$'`, and `backend/test/` is empty — every test the design specifies (`backend/test/schema-freeze.spec.ts`, `commerce-boundary.spec.ts`, `payout-unaffected-by-commerce.e2e-spec.ts`) would be **silently never collected**, and exit criteria #1 and #6 would report green having never executed. Put the four static checks under `src/**/*.spec.ts`; add a second jest project for the byte-identity e2e. Then make each one fail on first commit and watch the failure in CI — an unexecuted separation test is worse than no test, because it looks like proof.
- **The byte-identity fixture is new infrastructure, not a new test.** All 39 existing specs mock `PrismaService`; nothing in this repo has ever touched a real database. The good news is `.github/workflows/ci.yml` already runs `postgres:16-alpine` + `redis:7-alpine` and `prisma migrate deploy`, so what you need is a jest e2e config, a seed helper with fixed uuids and fixed `collectedAt`, and one CI step. Budget it as its own work package (6.0.8), not a line inside 6.0.7.
- **Layer 1 is the only separation layer that holds by itself — build it exactly as specified.** No Prisma relation from any commerce model to `Post`/`Content`/`ContentAsset`/`User`; FKs as hand-written `ALTER TABLE` in the migration, following the `posts_content_platform_active_key` precedent documented at `schema.prisma:379`. Everything else is lint and tests, and lint and tests can be disabled. Also: put the fixture helpers in `src/testing/`, outside the four scanned directories, and drop the `*.spec.ts` exclusion — it solves a problem correct file placement does not have.
- **Six concrete defects to fix as you go, each cheap and each real:** the `statementRef` regex must lose its space and must be enforced in the service (not just the DTO) so it also covers the adapter path; `RecordProductAnchorsDto`'s `null`-in-`@IsUUID(each)` contract is unreachable — use `Array<{productId, affiliateLinkId?}>`; `CommerceModule` must register its own `ThrottlerModule` (per-importing-module in Nest — see the comment at `publish.module.ts:33`) or the placement endpoint ships unthrottled; `escapeCsvField` will prefix every negative reversal with `'` and break the commerce CSV's sums in Excel; conversions have no idempotency, so a double-click inflates the total; and `PublishModule` **already** exports `StepUpAuthService` — the design's "one-line change" is not needed.
- **Both sign-offs are YES with conditions, and the conditions are numbered in §7.** SA-A holds on the honest formulation — commerce introduces no new data subject and no structural capacity for buyer data, with two constrained free-text residuals that are clearable in place — not on the design's stronger "no column capable of holding it". SA-B holds once the tests can actually run; today it would be one layer plus some lint. Nothing here requires returning to the Designer; the architecture is right.

---

**Prepared by:** Senior System Analyst, Loop Engineering Position #3
**Date:** 2026-07-20
**Verdict:** APPROVED WITH CONDITIONS (21 numbered items; 8 blocking the 6.0 gate)
**Next agent:** App Developer — 6.0 Schema & Separation Gate

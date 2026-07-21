# Phase 7 — Paid/Ads Visibility Module · System Analyst Sign-off (7.0 Gate)

- **Author**: Senior System Analyst (Loop Engineering position #3)
- **Date**: 2026-07-21
- **Input under review**: `docs/phase7-architecture-design.md` (816 lines, read in full), `docs/phase7-project-plan.md` (§0, §2 Decisions, §3.3 Exit criteria, Scope traps, Risk register — all read in full), `bussiness_rule.md` §"Ads/Paid Module" and §"Phase 7 kickoff decision"
- **Template / precedent**: `docs/phase6-system-analysis.md` (Phase 6.0 gate) for rigor and format; `docs/phase6-commerce-pdpa-separation-policy.md` and `backend/src/modules/commerce/commerce.constants.ts` for the shipped patterns this design should mirror.
- **Code actually read for independent verification** (not taken from the design's claims): `backend/.eslintrc.cjs`, `frontend/.eslintrc.js`, `backend/prisma/schema.prisma` (`Content`, `CommerceProduct`, `CommerceConversion`, `Platform`/`AssetPlatform`/`CommerceChannel` enum blocks), `backend/src/modules/commerce/commerce.constants.ts`, `backend/src/modules/content/content.module.ts`, `backend/src/common/audit/audit-log.service.ts`, `backend/src/common/utils/redact.util.ts`, `backend/src/testing/separation/{commerce-boundary.spec.ts,commerce-vocabulary-freeze.spec.ts}`, `backend/src/testing/e2e/*`, `backend/jest.config.js`, `backend/package.json`, `frontend/src/components/commerce/CommerceDashboardSection.tsx`, `backend/prisma/migrations/` (directory listing — confirms no paid migration exists yet), `global_config.md` §2.2 (forced text-dark pairing rule).
- **Output to**: App Developer (7.0 build), with copies to PM, QC, QA.

---

## 0. Verdict

**SIGNED OFF — 7A may begin, WITH BINDING CONDITIONS ON THE 7.0 BUILD.**

The architecture is correct in its central judgement, and it is a genuinely smaller, lower-risk phase than Commerce, as the design claims — no live-write path, no adapter registry, no step-up, two tables instead of five. Layer 1 (no Prisma relation into `AdCampaign`/`AdPerformanceEntry`) is the right load-bearing choice, for the identical reason it was right for Commerce, and I independently re-verified `Content` still carries no such relation field today. I also independently verified the design's most checkable factual claim — that `backend/.eslintrc.cjs`'s existing commerce zones are genuinely system-wide (ranking, metrics, dashboard, scheduler, content, queue, publish, common) — by reading the file myself rather than the design's description of it. **That claim is accurate.**

What blocks an unconditional sign-off is one **verified, concrete defect** that reproduces a bug this program already found and fixed once (§1, SA-P1), plus a **structural omission** — retention/erasure — that is the exact gap Phase 6's own SA-A found in the Commerce design before A5 closed it (§5.2). Both are cheap, both are already-precedented fixes sitting in this same repository, and neither requires returning to the Designer. They are conditions on **7.0** (the same gate this document is signing), not on the phase's viability.

Both mandated sign-offs are **PASS WITH CONDITIONS**, numbered below.

---

## 1. SA-P-A — PDPA / no-audience-data

### Answer: **PASS, WITH CONDITIONS** (conditions P-A1–P-A4)

The claim under review: *no column in the two paid tables is capable of holding audience-targeting, custom-audience/lookalike, or individual click/impression-level data.*

### What I verified, and what it establishes

| Control | Verified how | Holds? |
|---|---|---|
| Column inventory | Read every field in design §1.2 for both tables. There is no audience/segment/custom-audience/pixel/recipient/click-id column; `reach`/`impressions`/`clicks`/`resultCount` are `Int` aggregate counters, structurally incapable of holding an identifier. | **Yes** |
| `ValidationPipe` whitelist | Already verified system-wide in the Phase 6 review (`main.ts:57-61`, `whitelist: true, forbidNonWhitelisted: true`); nothing paid-specific is needed and the design correctly does not propose anything paid-specific. | **Yes** |
| No adapter ingestion seam this phase | Unlike Commerce, there is no `ConversionSnapshot`-equivalent path this phase (Decision 2/P-C: no live adapter, no MCP coupling). The entire PDPA surface really is the two tables' own columns and the one HTTP write path — a smaller, more auditable surface than Commerce's, as the design claims. | **Yes** |
| Data-subject scope | The only personal data paid introduces is `createdBy`/`recordedBy` — the single admin, already a data subject of the existing system. No new category of data subject. | **Yes** |

### Where the claim does not hold as written

**P-A-i — The `sourceRef` regex given in §1.5 is the exact defective pattern Commerce's SA-1 already found and rejected, not the fixed one it claims to mirror.**

Design §1.5 states: *"following Commerce's shipped resolution of its own equivalent finding (SA-1: the regex was applied, not just recommended), is format-constrained in the service layer — `^[A-Za-z0-9._\-\/ ]+$`."*

I read the actual shipped constant at `backend/src/modules/commerce/commerce.constants.ts:193`:

```ts
export const COMMERCE_STATEMENT_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,63}$/;
```

These are not the same pattern. The design's quoted regex — `^[A-Za-z0-9._\-\/ ]+$` — **contains a literal space in the character class**, which is precisely the defect `docs/phase6-system-analysis.md` §1 (finding A-i) identified and Commerce's own shipped code corrected: with the space present, `John Smith`, `Somchai P`, and `Ratchada Rd 42` all pass validation, so a pasted Latin-script personal name is **not** blocked — the opposite of the stated purpose. The fixed pattern that actually shipped is anchored, length-bounded in the pattern itself (`{0,63}` = 64 total, matching the 64-char cap), requires an alphanumeric first character, and **has no space**.

This is not a stylistic quibble — it is the one designed control standing between the highest-residual-risk field in the schema and a pasted name. Left as written, 7A would ship the exact regex Phase 6 already proved defective, under the belief that it was reusing the fix.

**P-A-ii — No CHECK constraint stated for `AdCampaign.plannedBudget` or `AdPerformanceEntry.correctsEntryId` self-reference, both cheap and both already precedented elsewhere in this design/codebase.**

- `plannedBudget` (`Decimal(12,2)`, nullable) has no stated non-negative CHECK, unlike every other numeric field in both tables (`spend`, `reach`, `impressions`, `clicks`, `resultCount` are all explicitly `CHECK ... >= 0`). A negative planned budget is meaningless and should fail at the DB, not rely on the DTO alone (`@Min(0)` is stated on the DTO but, as A-ii already established for Commerce, a DTO-only control is absent from any future non-HTTP write path).
- `correctsEntryId` has no stated `CHECK (corrects_entry_id <> id)`. Commerce's SA-2 required exactly this for `reversal_of_id` ("a row cannot reverse itself") and additionally required the service to validate that the corrected row shares the same channel/currency. The parallel validation here: a correction should reference an entry belonging to the **same campaign** — the design does not state this, and without it a correction could silently point at an entry under a different campaign, which the read model would then attribute to the wrong campaign's history.

**P-A-iii — No retention/erasure position at all.** Addressed in full at §5.2 below, since it affects SA-P-A and SA-P-B identically (it is a data-lifecycle gap, not a summation gap).

### Conditions for SA-P-A

| # | Condition | Sub-phase |
|---|---|---|
| **P-A1** | Replace the §1.5 regex with the actual shipped pattern, reusing the same shape: `^[A-Za-z0-9][A-Za-z0-9._\-\/]{0,63}$` (no space, anchored, alphanumeric-first, length-bound in the pattern). Define it as an exported constant (`PAID_SOURCE_REF_PATTERN`, mirroring `COMMERCE_STATEMENT_REF_PATTERN`) in a new `backend/src/modules/paid/paid.constants.ts`, enforced in **the service** (mirroring condition A2's ruling — the DTO decorator is the redundant second layer, not the primary one, since a future 7D live-sync path would otherwise bypass class-validator exactly as `ConversionSnapshot.statementRef` did in Commerce). | 7.0.4 policy doc + 7A.2 code |
| **P-A2** | Add `CHECK (planned_budget IS NULL OR planned_budget >= 0)` on `ad_campaigns`. | 7.0.2 |
| **P-A3** | Add `CHECK (corrects_entry_id <> id)` on `ad_performance_entries`; service validates the corrected entry belongs to the **same `campaignId`** before accepting the correction (400 otherwise). | 7.0.2 / 7A.2 |
| **P-A4** | Write a paid retention/erasure position into the 7.0.4 policy doc, freezing a `PAID_ERASABLE_FREE_TEXT_COLUMNS` list, per §5.2 below. | 7.0.4 |

With P-A1–P-A4 applied, the honest and defensible statement of the PDPA posture is:

> Paid-visibility introduces **no new data subject** and **no structural capacity** for audience-targeting, custom-audience, or individual click/impression-level data — the schema has no column that could hold any of it. Two free-text fields remain capable of holding personal data if an admin deliberately types it; `sourceRef` is format- and length-constrained in the service with the same pattern Commerce shipped (not the one Commerce's design draft proposed and rejected); `objective` is length-constrained only, per §4 (SA-P4); both are clearable in place under the retention policy.

---

## 2. SA-P-B — paid ⇄ payout ⇄ commerce separation

### Answer: **PASS, WITH CONDITIONS** (conditions P-B1–P-B4)

The claim: *summing any two, or all three, is prevented structurally at five independent layers.* I probed each, and — per the task's specific instruction — read `backend/.eslintrc.cjs` myself rather than trusting the design's description of it.

### Layer 1 — no Prisma relation into paid. **HOLDS, verified.**

Re-read `backend/prisma/schema.prisma:253` (`Content` model, full field list) — it has no relation field toward commerce today and the design proposes the identical non-relation treatment for `AdCampaign`/`AdPerformanceEntry`. `CommerceConversion` (`schema.prisma:821`) already demonstrates the exact technique the design proposes to reuse: `postId`/`placementId`/`productId`/`affiliateLinkId` are all plain nullable UUID columns with a comment stating "SQL FKs only; NO Prisma relation into posts." The traversal genuinely is unspellable for the identical reason it is for Commerce. Correct, and correctly reused rather than reinvented.

**Its limit is the same one Phase 6 named and it still applies:** this stops accidental `include`-based traversal, not a deliberate second query through an injected `PrismaService`. Layers 2–5 carry the rest of the weight — which is why I verified them independently rather than accepting the design's self-assessment.

### Layer 2 — ESLint import zones, now three-way. **The design's factual claim about existing coverage is ACCURATE, verified.**

The task specifically asked me to check this rather than restate the design's description, since independent verification — not restatement — is the job. I read `backend/.eslintrc.cjs` directly. The first `overrides` entry's `files` array is:

```
src/modules/ranking/**/*.ts, src/modules/metrics/**/*.ts, src/modules/dashboard/**/*.ts,
src/modules/scheduler/**/*.ts, src/modules/content/**/*.ts, src/modules/queue/**/*.ts,
src/modules/publish/**/*.ts, src/common/**/*.ts, src/modules/reports/report-export.service.ts
```

This is **exactly** the eight-directory-plus-one-file set the design's §2.2 describes ("ranking, metrics, dashboard, scheduler, content, queue, publish, and common — not just the four directories the Phase 6 plan originally named, per System Analyst condition B4"). I confirm this is not a restatement of the design's claim but an independent read of the file, and it matches. The design's proposed three edits (extend this override's banned group with `paid`; extend the commerce-side override with `paid`; add a new paid-side override banning `metrics`/`ranking`/`dashboard`/`reports`/`commerce`) are structurally sound **and notably do not ban paid from importing `content`, `scheduler`, `queue`, `publish`, or `common`** — which is correct, not an oversight: `PaidModule` legitimately needs `ContentModule` (§2.6, the content picker) and `common` (audit logging), and I independently verified `ContentModule` (`content.module.ts`) imports nothing from ranking, metrics, publish, or commerce — it is a clean leaf module. This means **`PaidModule` avoids the exact transitive-coupling risk Phase 6's SA found for Commerce** (finding §5.2 of the Phase 6 report: `CommerceModule → PublishModule → RankingModule`, because commerce needed `StepUpAuthService` from `PublishModule`). Paid needs no step-up (SA-P3, confirmed below), so it never imports `PublishModule` at all, and its only cross-module import is the leaf `ContentModule`. This is a genuine, verified structural improvement over Commerce's shape, not just a smaller feature set.

The frontend `.eslintrc.js` read directly confirms the same commerce-only zones exist today exactly as described (`src/app/dashboard/**`, `src/components/dashboard/**`, `src/components/reports/**` banning commerce; the reverse on the commerce side) — the design's proposed extension is the same pattern applied a third time, no gaps found.

### Layer 3 — the static boundary test. **Sound extension of a working mechanism, one gap.**

I read the actual `commerce-boundary.spec.ts`, not the design's description of the Phase 6 mechanism (the design cites it only in outline). `PAYOUT_AND_RANKING_DIRS` already includes `content`, `scheduler`, `queue`, `comments`, `connected-accounts`, and `common` in addition to `ranking`/`metrics`/`dashboard`/`reports` — so the design's plan to scan "the same `PAYOUT_AND_RANKING_DIRS` list already in use, plus `src/modules/commerce`" for `PAID_TOKENS` is correct and comprehensive: it already covers `content` (so `ContentModule` cannot reference a paid table), and it uses word-boundary matching with comments stripped (`source-scan.util.ts`), closing the exact false-positive risk (G3c) Phase 6 had to fix mid-review. One gap: **the design does not name `src/modules/comments` or `src/modules/connected-accounts` explicitly in its own §2.3 text**, but since it says "the same list already in use," this resolves correctly as long as the developer extends the existing constant rather than hand-copying a shorter list from the design doc verbatim — flagged as **P-B1** to make explicit, since a developer copying the design doc's own prose list would under-scope it.

### Layer 4 — the byte-identity fixture. **Sound, and feasible on the existing e2e harness — verified the harness is real, not aspirational.**

I confirmed `backend/src/testing/e2e/` contains `capture-baseline.ts`, `commerce-fixture.ts`, `payout-fixture.ts`, and `e2e-database.ts`/`e2e-database.spec.ts`, and `backend/package.json` has a working `test:e2e` script (`jest --config jest.e2e.config.js --runInBand`) separate from the unit `test` script (`rootDir: 'src'`, per `backend/jest.config.js`). This is exactly the two-jest-project fix Phase 6's condition B1 required after finding the design's original test-topology mismatch — and it is **already built and working**, so Phase 7 inherits a corrected foundation rather than repeating the Phase 6 mistake. The design's plan to add `paid-fixture.ts` alongside the existing two and extend `capture-baseline.ts`'s sequence is a direct, low-risk extension of working infrastructure. No gap found here beyond the general condition that the fixture must actually be proven to fail first (see P-B2, restating the Phase 6 lesson since it is a standing discipline, not a one-time fix).

### Layer 5 — vocabulary separation. **Mechanism verified real; the design's extension is sound but under-specifies one thing.**

I read `commerce-vocabulary-freeze.spec.ts` directly: it scans DTO source text (comments stripped) for the other stream's vocabulary as whole words, not a frozen key-list assertion — a stronger and self-updating design than the "frozen key set" language in the Phase 7 doc's §2.5 suggests. The design's plan to extend this to three pairwise-disjoint checks is structurally sound. **One gap:** Phase 6's own G5a finding (the UI test comparing an unformatted sum against `formatTHB`-rendered text, which would have passed on a broken page) is not restated or re-guarded against in the Phase 7 design's §2.5 UI-test extension. The four-assertion extension (§2.5, "no rendered numeric text node equals any pairwise or triple sum") **must** format each candidate sum through the same formatter the page actually uses (`formatTHB`) before comparing, or it inherits the exact defect Phase 6 caught and fixed. Flagged as **P-B3**.

### Conditions for SA-P-B

| # | Condition | Sub-phase |
|---|---|---|
| **P-B1** | The static boundary scan (Layer 3) must extend the **existing** `PAYOUT_AND_RANKING_DIRS`/`COMMERCE_SIDE_DIRS` constants in `commerce-boundary.spec.ts` (or a generalised sibling) rather than a developer re-deriving a directory list from the design doc's prose, which under-scopes it (omits `comments`, `connected-accounts`). | 7.0.5 |
| **P-B2** | Every new separation test (enum-freeze extension, column allow-list, boundary scan both directions, byte-identity fixture, vocabulary freeze) must be shown to **fail on first commit**, with the failure visible in CI output, before the corresponding 7A code lands — restating the Phase 6 B1 discipline; an unexecuted or trivially-passing separation test is worse than no test. | 7.0.5 → 7A.5 |
| **P-B3** | The extended dashboard UI test (§2.5, four sum assertions) must compare against sums rendered through the actual formatter the page uses (`formatTHB`), including the ±0.01 rounding neighbours — not a raw numeric comparison — mirroring the fix Phase 6 condition B6/G5a required. | 7B.3 |
| **P-B4** | Confirm `PaidModule`'s import graph is exactly `{ContentModule, common/*}` with no path to `PublishModule`, `RankingModule`, `MetricsModule`, `DashboardModule`, or `CommerceModule` — enforced by the boundary scan (P-B1) and spot-checked at code review, since this module's avoidance of the transitive-coupling problem Commerce had is a real advantage only if it is preserved as the module grows in 7A. | 7A.1 |

With P-B1–P-B4, I sign SA-P-B. The five-layer mechanism is real, working, and — unlike Phase 6's first draft — already correctly wired for test collection; this phase inherits a fixed foundation rather than repeating the topology mistake.

---

## 3. Adjudication of SA-P1 … SA-P7

Decisive rulings, as the design's §7 requests. Each is resolved explicitly — none is "obviously fine."

### SA-P1 — `sourceRef` format regex · **REJECT the specific regex as written; APPLY the corrected one** · Severity: **HIGH**

Already established in full at §1 (P-A-i) above: the regex quoted in design §1.5 is the exact pre-fix pattern Commerce's SA-1 rejected (the space in the character class defeats the stated purpose), not the pattern that actually shipped. **Decision: apply `^[A-Za-z0-9][A-Za-z0-9._\-\/]{0,63}$` — the real Commerce pattern — enforced in the service layer, not only the DTO.** This is not "accept the residual risk in writing," per the design's offered alternative; the fix is free and already exists in this codebase as `COMMERCE_STATEMENT_REF_PATTERN`. See condition P-A1.

### SA-P2 — no reversal/negative-amount mechanic for `AdPerformanceEntry` · **CONFIRM the `correctsEntryId`-only approach** · Severity: **LOW**

The boxed discussion in design §1.2 is correct and I endorse its reasoning without reservation: ad spend has no real-world refund/reversal event the way a commission chargeback does, and modelling one would force a nonsensical negative-impressions row purely to satisfy a borrowed mechanic. I probed for a counter-scenario — Meta does occasionally issue ad-account billing credits (policy-violation refunds, delivery-shortfall adjustments) that could, in principle, appear as a negative adjustment on an Ads Manager summary screen. Even so, the correct representation for a manual-entry, visibility-only feature is: log the corrected (lower) figure as a new entry referencing the one it corrects, exactly as the design proposes — not a signed ledger. This is a bookkeeping simplification appropriate to what this feature is (a visibility log, not a reconciliation system), and the residual case is fully expressible via `correctsEntryId`. **Confirmed, with the two structural additions required at P-A3** (self-reference CHECK, same-campaign validation) that the design's boxed discussion does not itself state.

### SA-P3 — no step-up on any paid write path · **CONFIRM the reasoning holds** · Severity: **LOW**

I re-read the reasoning that originally justified this for Commerce's anchoring (SA-3, Phase 6): step-up exists specifically to gate acts that push something live to an external platform or that write an override fact the ranking engine later learns from. Every paid write is neither — a campaign record and a performance entry are descriptive facts about something that already happened entirely outside Content Hub, on a platform Content Hub has no write access to this phase (Option B/C rejected at the PM level). The second-order argument holds even more strongly here than for Commerce: Commerce's anchoring at least changes what appears in a public-facing embedded storefront; paid records change nothing outside Content Hub's own admin-only screens. **Confirmed**, and I additionally note (§2, Layer 2 verification) that this decision has a compounding structural benefit: it is the reason `PaidModule` never needs `StepUpAuthService` from `PublishModule`, which is what keeps its import graph a clean leaf and avoids Commerce's transitive-coupling finding.

### SA-P4 — audit meta scope for paid actions · **RULE: exclude all four free-text/identifier fields, not only `sourceRef`** · Severity: **MEDIUM**

The design proposes excluding only `sourceRef` and explicitly leaves `objective`, `externalCampaignName`, and `externalCampaignId` open, contrasting this with Commerce's "blanket exclusion... despite it not being PII" precedent for `commerce_products.name`. Ruling: **apply the same blanket exclusion Commerce used, for the same reason.** Commerce's SA-4 finding endorsed excluding `note`, `statementRef`, product `name`, and affiliate `url` from `audit_logs.meta` collectively — not because all four carry equal PII risk, but because the audit trail does not need business-descriptive free text to do its job (the row itself, queryable via the normal campaign/performance-entry read paths, already retains the full value); the audit log's job is to prove *that* a mutation happened and *who* did it, not to duplicate the row's content. Narrowing the exclusion to "only the field with genuine residual PII risk," as this design proposes, creates an inconsistency with the shipped precedent for no functional benefit, and it means the next contributor who copies commerce's audit pattern for a fifth free-text field has two conflicting precedents to choose from. **Exclude `objective`, `externalCampaignName`, `externalCampaignId`, and `sourceRef` from `audit_logs.meta` for the five new paid actions**, matching Commerce's shape exactly.

### SA-P5 — `AdCampaign.plannedBudget` indicative-only, never reconciled · **CONFIRM** · Severity: **LOW**

Directly mirrors `CommerceProduct.commissionRatePct`'s shipped and confirmed treatment (never summed with or checked against `AdPerformanceEntry.spend`, labelled in the UI). **Confirmed**, with the non-negative CHECK added at P-A2 (the design states the field but not this constraint).

### SA-P6 — currency stored independently per entry, THB default · **CONFIRM the shape; ESCALATE the open question, and require the same guard Commerce shipped** · Severity: **HIGH** (schedule), **MEDIUM** (correctness)

The independent-currency design (mirroring Commerce's SA-9) is correct and I confirm it without reservation on the modelling question. On the open question the design itself flags ("confirm with the admin whether non-THB ad spend is expected at all... this must be settled before 7.0.2"): I am escalating this, not resolving it silently, because **it is materially likely to be "no, not THB."** Meta ad accounts are billed in whatever currency the ad account itself is configured for, which for a Thailand-based advertiser is commonly THB but is not guaranteed — a business account created under a regional or historical setting, or one billed via a card denominated in USD, can have a Meta ad account billing currency that differs from Content Hub's THB default. This is a real operational question the PM's own §9 OQ-4 ("Currency: default THB assumed, same as Commerce. Confirm.") already asks and has not yet been answered by the admin as of this document. **This sign-off cannot itself answer OQ-4** — that is the admin's call, correctly routed to the PM — but I require, mirroring Commerce's shipped SA-9 fix exactly, that:

- `CHECK (currency ~ '^[A-Z]{3}$')` is added to both `ad_campaigns.currency` and `ad_performance_entries.currency` in the 7.0.2 migration regardless of the admin's answer (the column and CHECK are the cheap, irreversible-if-skipped part; a currency restriction in the service is the expensive-to-relax-later part only if done backwards). The design states the column type but not this CHECK — add it.
- A service-level `PAID_SUPPORTED_CURRENCIES` guard (mirroring `COMMERCE_SUPPORTED_CURRENCIES`) rejects anything but the admin-confirmed currency (or currencies) in v1, so relaxing it later is free rather than requiring a new migration.
- The paid summary must group by currency and never emit a scalar grand total across currencies, exactly as commerce's NFR-6.12 requires — the design does not restate this test requirement for paid and should.

**Confirmed the shape; blocking on OQ-4's answer before 7.0.2 ships, per the design's own stated deadline.**

### SA-P7 — the one-line edit to `CommerceDashboardSection.tsx`'s alert copy · **CONFIRM in scope for 7B** · Severity: **LOW**

I read the actual shipped file (`frontend/src/components/commerce/CommerceDashboardSection.tsx:87-88`) rather than trusting the design's characterization. The current text is exactly the single line the design describes: *"Not included in platform payout revenue above."* The proposed edit — appending *", or in the paid/ads section below"* — is confirmed to be the one-sentence, non-structural change the design claims: it does not touch the component's props, data-fetching, or test assertions beyond the literal string comparison in whatever test currently asserts that copy (which QA/QC should re-run, not re-review from scratch). **Confirmed in scope for 7B, not a change requiring separate design review.**

---

## 4. STRIDE pass over the new surfaces

Scored DREAD-style; only Medium-or-above findings, plus notable Lows. This phase's surface is smaller than Commerce's (no adapter seam, no step-up), so the pass is correspondingly shorter.

### 4.1 `POST /api/paid/campaigns` and `PATCH /api/paid/campaigns/:id`

| Threat | Assessment |
|---|---|
| **S** — Spoofing | Session + AdminGuard + CSRF. Adequate — matches every other non-step-up admin write in the system. |
| **T** — Tampering | `ValidationPipe` whitelist blocks field smuggling; `channel`/`externalCampaignId` correctly immutable post-creation (§3.4, mirroring Commerce's `UpdateProductDto`). **MEDIUM** — no CHECK stated for `plannedBudget >= 0` or `start_date`/`end_date` ordering beyond the stated `CHECK (end_date IS NULL OR end_date >= start_date)` — the latter is present and correct; the former is the P-A2 gap. |
| **R** — Repudiation | `ad_campaign_created`/`ad_campaign_updated`/`ad_campaign_retired` audited. Adequate, pending P-A4/SA-P4 scope. |
| **I** — Info disclosure | `objective` (100 chars, free text) is the residual — see SA-P4/SA-P1. |
| **D** — DoS | No throttle; consistent with every other non-step-up CRUD route in the system (content, posts, commerce products). Not a new posture. Adequate. |
| **E** — Elevation | AdminGuard, single role. Adequate. |

### 4.2 `POST /api/paid/campaigns/:id/performance-entries` (append-only)

| Threat | Assessment |
|---|---|
| **T** — Tampering | **MEDIUM — no idempotency protection, and it is the identical gap Commerce's condition C6 found and fixed for `commerce_conversions`.** The design's own overlap-check (§3.2, `GET .../overlap-check`) is warn-only and probes *period* overlap — it catches "I logged this week twice on two different days" but not a double-click or client retry submitting an identical body within the same second. Both rows would land; since the table is append-only, the only correction is a new `correctsEntryId` row, which is more friction than the double-submission that caused it. **Fix, mirroring `COMMERCE_CONVERSION_IDEMPOTENCY_WINDOW_MS` exactly:** reject a byte-identical payload from the same `recordedBy` within a short window (60s, matching Commerce's shipped constant) with 409. Not a blocker for the 7.0 gate (there is no code yet to apply it to), but **required in 7A**, at the same severity Commerce treated it. |
| **I** — Info disclosure | `sourceRef` — covered by P-A1/SA-P1. |
| **R** — Repudiation | `ad_performance_entry_added` audited; no PATCH/DELETE route, to be proven by a route-absence test (exit criterion #3). Adequate once that test exists and passes. |
| **E** — Elevation | AdminGuard. Adequate. |

### 4.3 `GET /api/reports/paid.csv`

| Threat | Assessment |
|---|---|
| **I** | Design correctly identifies this as the one file with intentional cross-module visibility (mounted on `ReportsController`, same file-granularity exemption as commerce). Unlike Commerce's CSV, there is **no negative-amount CSV-escaping concern** here — `spend` is `CHECK >= 0`, so the `escapeCsvField` formula-prefix defect Commerce's C7 found (negative reversals silently breaking Excel sums) has no analogue in paid data. Confirmed by design (ADR-7.2) and independently by the schema: no signed money field exists in either paid table. **Adequate, and a genuinely simpler surface than commerce's CSV.** |
| **R** | `paid_report_exported` distinct action. Adequate, consistent with SA-8's reasoning (Phase 6) for a typed action over a meta discriminator. |
| **D** | No pagination bound; same posture as existing reports at "tens of rows" scale. Accept, unchanged from Commerce's identical posture. |

### 4.4 Content cross-reference chip (§4.5)

| Threat | Assessment |
|---|---|
| **I** | Display-only, sourced from the client's own already-authorized `GET /api/paid/campaigns` fetch, no new endpoint. No new information-disclosure surface — the chip cannot show anything the admin viewing `/paid` couldn't already see. Adequate. |

---

## 5. Findings beyond SA-P1–SA-P7

### 5.1 Idempotency on performance-entry append — see §4.2 above (required in 7A, not blocking 7.0)

### 5.2 No retention/erasure position anywhere in the design — the single most significant omission, structurally identical to Phase 6's own A5 gap

`docs/phase7-architecture-design.md` does not mention retention or erasure once, for either `ad_campaigns` or `ad_performance_entries`. This is the exact shape of gap Phase 6's SA-A found in the Commerce design (`docs/phase6-system-analysis.md` §1, finding A-iv: *"There is no commerce retention rule, and the design does not mention retention once"*), and it is not automatically inherited or covered by anything Phase 7 ships — the paid tables are new tables with their own free-text columns and no stated lifecycle.

Applying the same reasoning that produced `COMMERCE_ERASABLE_FREE_TEXT_COLUMNS` (`backend/src/modules/commerce/commerce.constants.ts:52`): paid campaign and performance records are business/marketing-spend records with a legitimate retention basis (an admin should be able to see "what we spent last quarter" indefinitely, the same way payout and commerce history persists), so the correct model is **not** the comment regime (hard-delete at 12 months) and **not** silence — it is the audit regime's own pattern, "anonymize/clear-in-place, keep the row," applied to exactly the columns capable of holding personal data.

**Required condition P-A4 (restated for emphasis, since it is the most consequential finding in this review):** freeze, in the 7.0.4 policy doc and as an exported constant mirroring the commerce pattern exactly:

```ts
export const PAID_ERASABLE_FREE_TEXT_COLUMNS: readonly { table: string; column: string }[] = [
  { table: 'ad_campaigns', column: 'objective' },
  { table: 'ad_performance_entries', column: 'source_ref' },
];
```

An admin erasure request is satisfied by NULL-ing these two columns on the named rows; the campaign/performance-entry row survives (it is a business record), the free text does not. The clearing procedure itself can be a documented DB-level operator runbook in 7.0 (as Commerce's A5 accepted — a UI is not required this phase), but the **policy and column list must be frozen at this gate**, because "we have no way to comply with an erasure request" was already ruled unacceptable once at a PDPA gate in this program and should not need ruling again.

### 5.3 `redactSensitive`'s substring-match collision — checked, and clean this time

Phase 6's SA-4 found that `redactSensitive`'s case-insensitive substring match on `'code'` silently redacted `trackingCode`. I checked the same risk for every new paid field name against the full `SENSITIVE_FIELD_PATTERNS` list (`redact.util.ts:12-32`: `password`, `token`, `secret`, `authorization`, `cookie`, `session`, `client_secret`, `app_secret`, `code`, `encryption_key`, and their casing/underscore variants). None of `channel`, `externalCampaignName`, `externalCampaignId`, `objective`, `contentId`, `startDate`, `endDate`, `plannedBudget`, `currency`, `status`, `spend`, `reach`, `impressions`, `clicks`, `resultType`, `resultCount`, `periodStart`, `periodEnd`, `sourceRef`, or `correctsEntryId` contains any of these substrings. **No collision. Confirmed clean** — worth stating explicitly since P-A4/SA-P4 already remove the descriptive fields from meta anyway, but the numeric/structural fields that do remain in meta are unaffected.

### 5.4 Migration-note and enum-freeze mechanics — verified sound

The design's plan to add a *second* comment on the `AssetPlatform` enum block (§1.7) is well-founded: I read the existing comment at `schema.prisma:139-151` and confirmed it already documents the `RANKED_PLATFORMS_V2 = PLATFORM_TIE_BREAK_ORDER` hazard in exactly the terms the design describes, added by Phase 6 for `CommerceChannel`. Adding a second, paid-specific line to the same comment (rather than a competing one) is correct — the design says this explicitly and I confirm it is the right instinct.

---

## 6. Exit criterion #11 — admin schedule confirmation

Verified directly against `bussiness_rule.md` §"Phase 7 kickoff decision (2026-07-21)": the admin has explicitly confirmed proceeding with "the Phase 7 slice ที่เล็กสุด เปลี่ยนกลับได้ง่ายสุดตอนนี้" — manual-entry paid/organic visibility only, read-only, no live API, no MCP coupling — while the original 8-week real-usage evidence window (started 2026-07-20, per `phase6-project-plan.md` §7.1) continues, unshortened, to gate any live-sync/MCP work. **Exit criterion #11 is satisfied** — this is a dated, recorded decision, not silence being read as consent.

I additionally checked the architecture design for silent scope expansion beyond what was actually approved, reading the full document rather than trusting its own "in scope" framing: I found **no** campaign-creation UI, **no** live API client, **no** MCP reference anywhere in the design (the only MCP mentions are in the "Handoff summary" explaining why one is *not* built), and no code-level coupling proposed. The design is faithful to the approved manual-entry-only scope. **No conflict found.**

---

## 7. Consistency check against Phase 6 System Analyst decisions

- **Revenue/commerce non-summation posture**: extended, not contradicted — Decision 4/P1 of this design is a direct, correctly-scoped restatement of Phase 6 C-A/C-B/C-C applied to a third stream. No inconsistency.
- **`COMMERCE_ERASABLE_FREE_TEXT_COLUMNS` pattern**: **not mirrored** — this is the §5.2 finding above, now a required condition (P-A4) rather than a silent gap.
- **`COMMERCE_STATEMENT_REF_PATTERN` (the shipped SA-1 fix)**: **not correctly mirrored** — this is the §1/SA-P1 finding, now corrected as condition P-A1.
- **`COMMERCE_SUPPORTED_CURRENCIES` + currency CHECK pattern (SA-9)**: **not restated** — required at SA-P6/condition (currency CHECK + service guard).
- **Audit meta exclusion shape (SA-4)**: **narrower than precedent, without a stated reason for the narrowing** — resolved at SA-P4 by ruling for consistency with the shipped shape.
- **`reversal_of_id <> id` / same-channel-and-currency validation (SA-2)**: **not mirrored for `correctsEntryId`** — required at P-A3.
- **Ranking-frozen posture (C-C)**: correctly restated (Decision 6), no inconsistency; independently confirmed no paid table is reachable from `RankingModule`'s import graph today (there is none yet — the boundary scan and lint zones are the enforcement, both verified present and extendable).
- **Test-topology lesson (B1/G3a)**: correctly **inherited as already-fixed** — `jest.e2e.config.js` and the `src/testing/{separation,e2e}/` layout already exist and work; Phase 7 is not at risk of repeating Phase 6's original test-collection mistake, because it is building on the corrected foundation, not the original draft.

---

## 8. Non-functional requirements for Phase 7

Measurable, testable, handed to QA — extending Phase 6's NFR set to the third stream.

| ID | Requirement | Target | Verified by |
|---|---|---|---|
| NFR-7.1 | Payout endpoints unchanged with paid data present | Byte-identical `/dashboard/overview`, `/revenue`, `/revenue/:contentId` | 7A.5 byte-identity fixture |
| NFR-7.2 | Commerce endpoints/CSV unchanged with paid data present | Byte-identical commerce summary + `commerce.csv` bytes | 7A.5 (extended fixture) |
| NFR-7.3 | Ranking scores unchanged | `score::text` and `reasoning` JSON identical after re-rank with paid data present | 7A.5 |
| NFR-7.4 | Enum stability | `AdChannel` frozen at `['meta']`; `Platform`/`AssetPlatform`/`CommerceChannel` unchanged | enum-freeze extension |
| NFR-7.5 | Paid column inventory | Introspected column list for both tables deep-equals a frozen array | column-allow-list unit spec |
| NFR-7.6 | Paid CSV contains no PII-shaped value | No cell matches email/phone/Thai-national-id regex; header frozen | export byte test |
| NFR-7.7 | Append-only | `PATCH`/`DELETE` on `/api/paid/campaigns/:id/performance-entries/:entryId` → 404/405 | route-absence spec |
| NFR-7.8 | `sourceRef` format | Rejects any value not matching `PAID_SOURCE_REF_PATTERN` (P-A1) | service unit test |
| NFR-7.9 | No summed totals anywhere | No rendered numeric text node equals `payout+commerce`, `payout+paid`, `commerce+paid`, or all three, **compared through `formatTHB`** (P-B3) | frontend UI test |
| NFR-7.10 | Currency never crossed | Paid summary groups by currency; no scalar cross-currency total | 7A.3, mirroring NFR-6.12 |
| NFR-7.11 | Correction integrity | `correctsEntryId` cannot equal its own `id`; must reference the same `campaignId` | migration CHECK + service test (P-A3) |
| NFR-7.12 | Performance-entry idempotency | Byte-identical payload from same `recordedBy` within 60s → 409 | 7A.2 (§4.2 finding) |
| NFR-7.13 | Retention/erasure | `objective`/`sourceRef` clearable in place on named rows without deleting the row | operator runbook (P-A4) |

---

## 9. Conditions of sign-off — consolidated must-fix list

Each tied to a sub-phase.

### Blocking 7.0 gate closure

1. **P-A1 / SA-P1** — replace the §1.5 regex with `^[A-Za-z0-9][A-Za-z0-9._\-\/]{0,63}$` (the actual shipped Commerce pattern), enforced in the service. *(7.0.4 doc, 7A.2 code)*
2. **P-A2** — `CHECK (planned_budget IS NULL OR planned_budget >= 0)` on `ad_campaigns`. *(7.0.2)*
3. **P-A3** — `CHECK (corrects_entry_id <> id)`; service validates same-campaign match. *(7.0.2 / 7A.2)*
4. **P-A4 / §5.2** — freeze `PAID_ERASABLE_FREE_TEXT_COLUMNS` and a retention position in the 7.0.4 policy doc, mirroring Commerce's A5 exactly. *(7.0.4)*
5. **SA-P4** — audit meta excludes `objective`, `externalCampaignName`, `externalCampaignId`, and `sourceRef` — all four, not only `sourceRef`. *(7.0.3 union definition, 7A code)*
6. **SA-P6** — `CHECK (currency ~ '^[A-Z]{3}$')` on both tables regardless of the admin's currency answer; a `PAID_SUPPORTED_CURRENCIES` service guard once that answer lands. **PM's OQ-4 must be answered before 7.0.2 ships**, per the design's own stated deadline. *(7.0.2)*
7. **P-B1** — the static boundary scan must extend the existing `PAYOUT_AND_RANKING_DIRS`/`COMMERCE_SIDE_DIRS` constants, not a hand-derived list from the design doc's prose. *(7.0.5)*
8. **P-B2** — every new separation test proven to fail first, in CI output, before 7A code lands. *(7.0.5 → 7A.5)*

### Blocking 7A

9. **§4.2 finding** — performance-entry idempotency window (60s, same-payload, same-recorder → 409), mirroring `COMMERCE_CONVERSION_IDEMPOTENCY_WINDOW_MS`. *(7A.2)*
10. **P-B4** — `PaidModule`'s import graph verified to stay `{ContentModule, common/*}` only, with no path to `PublishModule`/`RankingModule`/`MetricsModule`/`DashboardModule`/`CommerceModule`. *(7A.1, ongoing through 7A)*

### Blocking 7B

11. **P-B3** — the triple/pairwise-sum UI test compares through `formatTHB` (± rounding neighbours), not raw numbers, mirroring Phase 6's G5a fix. *(7B.3)*
12. **SA-P7** — confirmed in scope; QC/QA should re-run, not re-review from scratch, the existing `CommerceDashboardSection` test after the one-line copy edit. *(7B.3)*

### Re-verified at 7C (non-blocking here, restated for the record)

13. Exit criterion #6 (PDPA aggregate-only) must be re-verified by the System Analyst against the **shipped migration**, not this design — per the plan's own 7C.4 and exit criterion #6.

---

## Handoff summary — App Developer building 7.0

- **This design is correct in its architecture and inherits a fixed foundation from Phase 6 — it is not repeating Phase 6's original test-topology mistake.** The jest e2e project, the `src/testing/{separation,e2e}` layout, and the working `test:e2e` script all already exist; build the paid separation tests inside that structure, not a new one.
- **The one regex in this design is wrong, and it is wrong in a way that looks right.** §1.5's `sourceRef` pattern is the exact pre-fix Commerce regex (contains a space, lets a Latin-script name through) even though the design's own prose says it mirrors the shipped fix. Use `PAID_SOURCE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-\/]{0,63}$/` — copy `COMMERCE_STATEMENT_REF_PATTERN` verbatim in shape — enforced in the service, not only the DTO.
- **Retention/erasure was never mentioned in the design and must be written into the 7.0.4 policy doc before the gate closes.** Freeze `PAID_ERASABLE_FREE_TEXT_COLUMNS` (`ad_campaigns.objective`, `ad_performance_entries.source_ref`) mirroring `commerce.constants.ts`'s pattern exactly — anonymize/clear-in-place, never delete the row.
- **Two cheap CHECK constraints and one audit-scope decision are missing from the design, all one-line fixes**: `planned_budget >= 0`, `corrects_entry_id <> id` (plus same-campaign service validation), and audit meta excluding all four paid free-text/identifier fields (not only `sourceRef`), for consistency with the shipped commerce precedent.
- **Currency needs the admin's answer (PM's OQ-4) before the 7.0.2 migration ships**, and the CHECK constraint + service-side supported-currency guard must land regardless of that answer, exactly as Commerce's SA-9 required.
- **One idempotency gap carries into 7A**: performance-entry append has no protection against a double-click/retry submitting an identical payload twice — add the same 60-second same-payload guard Commerce shipped for conversions.
- **Both mandated sign-offs are PASS WITH CONDITIONS, none requiring a return to the Designer.** The architecture — two new tables, no discriminator, no relation into `Content`/`User`, three-way ESLint zones, static boundary scan, byte-identity fixture, disjoint vocabulary — is sound, and `PaidModule`'s avoidance of Commerce's transitive `PublishModule` coupling (because it needs no step-up) is a genuine, verified structural improvement worth preserving through 7A.
- **Exit criterion #11 is satisfied** — the admin's 2026-07-21 manual-entry-only confirmation is on record in `bussiness_rule.md`, and this design does not exceed that approved scope anywhere.

---

**Prepared by:** Senior System Analyst, Loop Engineering Position #3
**Date:** 2026-07-21
**Verdict:** **SIGNED OFF — 7A may begin**, subject to conditions 1–8 above landing within the 7.0 build (schema, policy doc, and test-topology items) before 7A code is written, and conditions 9–12 landing within 7A/7B as scheduled. Condition 6 (currency) additionally requires the admin's answer to the PM's open question OQ-4 before the 7.0.2 migration is written.
**Next agent:** App Developer — Phase 7.0 Schema & Separation Gate.

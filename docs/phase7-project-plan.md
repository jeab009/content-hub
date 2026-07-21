# Phase 7 — Paid/Ads Visibility Module · Project Plan

- **Author**: Senior Project Manager, Loop Engineering entry point, position #1
- **Date**: 2026-07-21
- **Iteration input**: Phase 6 close-out (`memory.md`, Phase 6.0→6D all closed 2026-07-21, zero open Critical/High). Baseline on `main`: **599/599 backend tests**, frontend jest green, **10 migrations** (`backend/prisma/migrations/`), `RANKING_ENGINE=v2`, 4/4 Docker containers healthy.
- **Trigger for this iteration**: not a bug-fixer feedback loop — a **standing gap-analysis item** (`makedown.md` §9.5 "Ads/Paid Module" row, `bussiness_rule.md` §"Ads/Paid Module") plus a **new external fact** recorded 2026-07-20 (`memory.md`, `SETUP-CHECKLIST.md` §6.4): Meta opened **Ads AI Connectors** — an MCP server (`https://mcp.facebook.com/ads`) + CLI — into open beta on 2026-04-29. Direct Business OAuth, no App Review, no code to write; campaigns it creates always land **paused**.
- **Downstream handoff**: App Designer (paid/organic dashboard separation design, ad-record entry UX) → System Analyst (PDPA/no-audience-data gate, paid/organic/commerce triple-separation sign-off) → App Developer.

---

## 0. The tension this plan must resolve before scoping anything

Two prior, explicit decisions bear directly on whether this plan should exist at all today, and I am naming the tension rather than quietly stepping past it.

1. **`bussiness_rule.md` "Ads/Paid Module" (2026-07-16)**: B-lite, revisit "หลังใช้งานจริง ~8 สัปดาห์" (after ~8 weeks of real ad-spend logging).
2. **Phase 6 plan §7.1 carry-forward**: *"Ads/Paid revisit — evidence window ~8 weeks of real operation. Clock started 2026-07-20. **Not due this phase.** Trigger is real usage, not a build milestone."*

Today is **2026-07-21** — one day into that clock. `SETUP-CHECKLIST.md` §6.3 confirms zero real ad-spend log entries exist yet ("จดบันทึกทุกครั้งที่ยิง ads ด้วยมือ" is still an open action item, not something with data behind it). **The 8-week evidence gate has not closed.** If I ignored that, this plan would contradict a decision this program made in writing one day ago.

**Resolution, and why it is not a contradiction:** the original B-lite gate was actually testing **two independent things** that happened to share one clock:
- (a) *Is real demand proven?* — the 8-week usage-evidence test. **Still open. Not resolved by anything below.**
- (b) *Is the integration cost too high to justify building anything?* — this was the actual reason B-lite was chosen as "kept entirely outside Content Hub" (`makedown.md` line 133/181-183: connecting an ad account needs its own OAuth, budget/campaign objective modeling, etc.). **This is the test the Meta MCP genuinely changes** — but only for the *campaign-creation* side of the problem, which admin can now do zero-code via Meta's own tool. It does **not** manufacture usage evidence, and it does not touch the *visibility* side of the problem (pulling ad numbers into the dashboard), which never needed MCP at all — that only ever needed the standard Meta Marketing/Insights API.

**Decision recorded here**: this plan authorizes starting the **lowest-risk slice only** — a manual-entry paid-visibility feature that costs nothing to keep decoupled and reversible (same posture Phase 5/6 used for TikTok/LINE and Commerce before credentials existed) — while **explicitly continuing to gate** the higher-risk slice (any live API sync, any code-level MCP coupling) behind the original 8-week real-usage evidence. Nothing in this plan reads a single ad number automatically; every figure the admin ever sees in Content Hub this phase is something they typed in, exactly as TikTok/LINE metrics and Commerce conversions are today. See Open Question 1 (§9) — **this call needs the admin's explicit sign-off before 7.0 starts**, since it is a schedule decision the PM does not have unilateral authority to finalize against the program's own written gate.

---

## 1. Project Charter

### 1.1 Objective

Close the **visibility gap** between paid and organic performance on the existing dashboard — without building any campaign creation, editing, or budget-management surface inside Content Hub, and without letting paid data blend into the payout revenue figure, the commerce figures, or the ranking engine.

### 1.2 Success statement

> Admin can log what was spent on a Meta ad campaign and what it returned (reach, spend, results) against the content it promoted, and see that alongside — never summed with — organic payout revenue and commerce/affiliate revenue on the dashboard. Campaign creation and management continue to happen entirely outside Content Hub, in Meta Ads Manager or via the admin's own use of the Meta Ads MCP. Ranking v2 recommendations are **byte-identical** before and after paid data exists. No audience-targeting or individual-ad-recipient data ever enters the database.

### 1.3 Constraints fixed by prior decisions (do NOT re-litigate)

| # | Constraint | Source | Consequence for this plan |
|---|-----------|--------|---------------------------|
| **P-A** | Revenue model is payout-only; commerce is a separate stream; neither is summed with the other. | `bussiness_rule.md` §Revenue, §Commerce; Phase 6 C-A/C-B | Paid data is a **third** stream. Same non-summation discipline extends, not a new argument. |
| **P-B** | Ranking v1/v2 use organic engagement/payout/override-feedback only. | `bussiness_rule.md` §Ranking Engine v2; Phase 6 C-C | Ranking stays frozen again this phase. If paid signal should ever inform ranking, that is its own future decision (this exact sentence already exists twice in this repo's history — see `makedown.md` §10). |
| **P-C** | The Meta Ads MCP is an **admin-side tool used outside the system**; Content Hub must not be wired to call it as a dependency. | `SETUP-CHECKLIST.md` §6.4, decided 2026-07-20 | Rules out any design where Content Hub's backend calls the MCP at runtime. This plan does not propose revisiting that call — see Decision 2. |
| **P-D** | Facebook OAuth today is scoped to Login/own-Page publishing only, and sits in "Dev Mode sufficient" because only the admin's own Page is connected (`docs/meta-app-review-status.md`). | `bussiness_rule.md` §Meta App Review | Ads API scopes (`ads_read`/`ads_management`) are a **different** OAuth grant on a **different** Meta product surface. Requesting them reopens the App Review question. This plan defers that (Decision 3 / 7D). |
| **P-E** | Publish/record actions are never automatic; admin confirms every write; step-up guards financially or legally meaningful mutations. | `bussiness_rule.md` §Publish Authority | Ad-record entry follows the same append-only, admin-confirmed, audited pattern already used for `Metric` and `CommerceConversion`. |
| **P-F** | Enum migrations are additive-only and irreversible. | Schema header rule, reaffirmed at Phase 6 C-F | Any new platform/channel enum value added this phase can never be removed — argues against touching `Platform`/`AssetPlatform` (Decision 2). |
| **P-G** | 8-week real-usage evidence window for the Ads/Paid revisit, clock started 2026-07-20. | Phase 6 plan §7.1 | Not yet elapsed. Governs what this plan is allowed to build now vs. defer — see §0 and Decision 1. |

---

## 2. Explicit decisions (the real unknowns, resolved)

### Decision 1 — Scope: **Option A (read-only visibility), manual-entry v1. Option B and Option C both rejected for this phase.**

Weighing the three options the brief poses:

**Option C — full campaign/budget management inside Content Hub.** Rejected outright, same reasoning `bussiness_rule.md` used in 2026-07-16 and the brief itself anticipates: Meta Ads Manager already does this well; duplicating campaign objective/budget/audience modeling inside Content Hub is the exact "six call sites that must each be individually fixed" shape this program's Commerce decision (Phase 6 §1.3) warned against, applied to a domain (ad budgets, real money, audience targeting) with materially higher blast radius than commerce catalog data. Not reconsidered further.

**Option B — creation assist (draft/launch a boosted-post campaign from Content Hub via the MCP under the hood).** Rejected **for this phase**, on three independent grounds, any one of which would be sufficient alone:

1. **It contradicts an existing, dated, reasoned decision (P-C) without new information that addresses that decision's actual reasoning.** `SETUP-CHECKLIST.md` §6.4 already considered exactly this shape ("ห้ามผูก Content Hub ให้ call MCP นี้เป็น dependency") and rejected it *because* the MCP is open beta with no pricing commitment, no SLA, and no announced GA date. Nothing has changed about that fact between 2026-07-20 and today. Building Option B means Content Hub's own feature set depends on a surface Meta could reprice, rate-limit, or deprecate mid-beta — and unlike the FB/YouTube publish adapters (which are gated behind `PUBLISHER_IMPL_*` mock/live and only run live once credentialed), an MCP integration cannot be "mocked" in the same way for anything beyond a UI stub, because the entire value proposition of Option B is that Content Hub calls Meta's real infrastructure.
2. **It provides no value the admin doesn't already have.** Because every campaign the MCP creates lands **paused** regardless of caller, and because `bussiness_rule.md` already forbids Content Hub from auto-publishing anything, the admin retains full manual control either way. The admin can already ask an AI assistant with the MCP configured — today, with zero Content Hub code — to draft a boosted-post campaign for a given piece of content, using exactly the same pillar/publish-history/engagement context that a Content Hub "creation assist" screen would otherwise need to surface. Building that screen inside Content Hub duplicates a capability that already exists, at the cost of taking on risk #1.
3. **It is the harder half of a problem this plan can solve without it.** The actual unmet need — "amplification decisions should account for paid, not just organic, performance" — is fully addressed by Option A. Option B only buys campaign-launch convenience, not visibility.

**Option A — read-only visibility. Recommended, with one refinement on sourcing: manual entry in v1, not a live pull through the MCP or otherwise, this phase.**

Why manual entry rather than live API sync now, even though Option A is the recommended shape:

- Pulling live numbers requires either (a) the Ads MCP — ruled out by Decision 2/P-C, or (b) the standard Meta Marketing/Insights API directly, which needs its own `ads_read` OAuth scope on the Meta App — reopening the App Review question (P-D) and adding real integration work this phase does not need in order to deliver the visibility value.
- This program has a proven, repeatedly-successful pattern for exactly this situation: **ship manual entry first, specify-but-don't-build the live path, revisit once real usage justifies the API cost.** TikTok/LINE metrics did this from Phase 5 onward; Commerce conversions did this from Phase 6 onward. Paid visibility should do the same — it is not a special case.
- Manual entry also directly serves the still-open evidence question in §0: every manual ad-spend entry an admin makes **is** the usage-evidence log that `SETUP-CHECKLIST.md` §6.3 already asked them to keep by hand. Building the visibility feature turns that ad-hoc note-taking into structured data, which makes the eventual 8-week review *better evidenced*, not premature.

### Decision 2 — Do NOT integrate with the Meta Ads MCP at the code level, at all, this phase

Restating and extending P-C rather than re-deciding it: the MCP stays exactly what `SETUP-CHECKLIST.md` §6.4 already says it is — a tool the admin uses directly, outside Content Hub, for campaign creation/management, with its own OAuth session, independent of anything this program ships. This plan's only relationship to the MCP is that its existence is why Option B is *newly cheap enough to be tempting* — which is precisely why Decision 1 spells out explicitly why "cheap" is not "in scope."

If this is ever revisited: the trigger should be **GA + published pricing/SLA** (per `SETUP-CHECKLIST.md` §6.4's own stated condition — "อย่าให้ระบบ production พึ่งพา" until then), not a build milestone internal to this program.

### Decision 3 — Meta-only this phase; Google Ads and TikTok Ads explicitly deferred

The trigger for this phase is a **Meta-specific** fact (the Meta Ads MCP). No equivalent low-friction connector has been confirmed for Google Ads or TikTok Ads. Mirroring how Phase 6 scoped Shopee + TikTok Shop as channels but deferred *live credentials* for both under one decision, Phase 7 makes the parallel call one level up: **the channel itself is Meta-only**; Google Ads and TikTok Ads are an explicit future-phase candidate, not a parallel work-stream this phase, and not something to pre-build an extensible-looking abstraction for. (Reason to be concrete about this: an `AdChannel` enum with only one populated value, `meta`, is fine and honest; designing a "generic ads platform" abstraction for two channels nobody has evidence for yet would be speculative generality this program has consistently avoided.)

### Decision 4 — Domain separation: a new, standalone paid-data stream; no discriminator anywhere; no ranking read

Applying the exact reasoning Phase 6 Decision 1.3 already proved out for commerce, to paid data:

- **New entities, not a column on `Metric`.** A `metric.source = paid` discriminator would make `DashboardService`, `ReportExportService`, `MetricIngestionService`, and — decisively — `RankingFactorsV2Service`'s revenue blend all silently paid-aware from the moment the first row lands, exactly the failure mode Phase 6 named and rejected. Not doing that again.
- Conceptual shape (App Designer owns the literal schema): an **ad campaign record** (channel `meta`, external campaign name/id as free text the admin copies from Ads Manager, objective, optional nullable link to a `Content` row — not `Post`, since one campaign commonly promotes a pillar or several pieces of content rather than a single post — date range, planned budget, status) and an **append-only ad performance entry** (spend, impressions/reach, clicks, a free-form result count + result-type label, currency, `collectedAt`, `source: manual` today). No FK into `Metric`, `CommerceConversion`, or anything ranking reads.
- **Structural guards to ship, mirrored 1:1 from Phase 6**: a static boundary test that no file under `modules/metrics/`, `modules/dashboard/`, `modules/reports/`, or `modules/ranking/` references the new paid tables or module; and a behavioural byte-identity test — seed paid data, then assert `GET /api/dashboard/overview`, `/revenue`, `/revenue/:contentId`, the revenue CSV bytes, the commerce summary/CSV bytes, and every persisted `ranking_scores.score` are unchanged. This is this phase's exit criterion #6, exactly as it was Phase 6's.

### Decision 5 — PDPA: aggregate campaign-level metrics only, same hard-rule shape as Commerce

Ads platforms genuinely can carry personal data in ways payout/commerce data cannot: **audience targeting configuration** (custom audiences built from uploaded customer lists, lookalike audiences, pixel-based retargeting segments) and **individual ad-recipient/click-level data** are both personal-data-bearing in ways aggregate spend/reach/clicks are not.

**Hard rule, enforced the same way Commerce enforced it — at schema-design time, not by policy reminder:** there is no column, this phase or ever without a fresh decision, for audience definitions, custom-audience/customer-list identifiers, individual click/impression records, or any per-recipient data. Content Hub records **campaign-level aggregate figures only** — spend, reach, impressions, clicks, a results count. This is a smaller PDPA surface than Commerce's (Commerce at least has a "the vendor's statement mentions an order" edge case; paid-visibility manual entry has no analogous edge because nothing is ingested from a vendor file this phase — the admin types in numbers they already see on an Ads Manager summary screen).

### Decision 6 — Ranking stays frozen; this is not the phase to answer `makedown.md` §10's old open question

`makedown.md` §10 flagged years ago (relatively) that *if* an ads module is ever added, ranking would need a decision about whether to fold in paid signal. This plan answers: **not this phase.** Same reasoning as Phase 6 C-C — v2 was enabled 2026-07-20 and already changed a live recommendation once; adding a second new signal source to it in the same breath as shipping that source's data model is how contamination happens by accident rather than by review. If paid-aware ranking is ever wanted, it is a dedicated, reviewed change to `RankingFactorsV2Service` with its own risk register entry — not a byproduct of this phase.

---

## 3. Scope

### 3.1 In scope

1. **Paid-data domain model** — ad campaign record (Meta-only, manual attributes) + append-only ad performance entry, structurally separate from `Metric`, `CommerceConversion`, and anything ranking reads.
2. **Manual entry** — admin logs campaign metadata and periodic spend/reach/clicks/results figures observed in Meta Ads Manager. No PATCH/DELETE on performance entries (append-only, corrections as new rows, same as `Metric`/`CommerceConversion`).
3. **Paid dashboard section + paid CSV export** — visibly and structurally separate from both payout and commerce sections; never summed with either.
4. **Optional, purely informational content cross-reference** — a content record can show "this content had a logged paid campaign" — display-only, no ranking read, no priority change.
5. **Separation guarantees** — boundary test + byte-identical payout/commerce/ranking regression test (this phase's defining deliverable, same shape as Phase 6 exit #6).
6. **Live-sync specification + rejecting stub** (non-blocking tail, 7D) — written spec for pulling data via the standard Meta Marketing/Insights API (`ads_read` scope) — explicitly **not** via the Ads MCP (Decision 2) — plus an adapter stub that rejects cleanly when enabled without credentials. No live HTTP client built.
7. Frontend for items 1–4.

### 3.2 Out of scope — explicit "not this phase"

- **Any campaign creation, editing, budget, targeting, or audience-management UI inside Content Hub** (Option B and C, Decision 1). Admin continues to use Meta Ads Manager and, at their own discretion, the Meta Ads MCP directly — neither is something Content Hub builds toward.
- **Any code-level integration with the Meta Ads MCP** (Decision 2). It is not a dependency of anything shipped this phase.
- **Live API pull of any kind** (Decision 1, Decision 5 exclusions). Manual entry only; spec + rejecting stub for the future live path (7D).
- **Google Ads, TikTok Ads, or any non-Meta paid channel** (Decision 3).
- **Any audience-targeting, custom-audience/customer-list, or individual ad-recipient/click-level data** (Decision 5, PDPA hard rule).
- **Making ranking paid-aware** (Decision 6). Ranking module stays frozen.
- **Amending the revenue model.** `Revenue = platform monetization payout only` is untouched; paid spend is not revenue and is never added to it, positively or negatively.
- **Reopening Meta App Review / requesting `ads_read` scope on the existing Meta App** this phase (P-D). That is the trigger condition for 7D, not a task inside 7.0–7C.
- **A generic multi-channel "ads platform" abstraction.** One channel (`meta`), built honestly for one channel.

### 3.3 Exit criteria (Phase 7 DONE when all true)

1. Migration applies clean on real Postgres; **additive-only**; `Platform` and `AssetPlatform` are **unchanged** (verified by diffing the enum blocks, same check as Phase 6 exit #1).
2. Admin can create/edit an ad campaign record (Meta-only, optional nullable content link) and soft-retire it; all writes audited.
3. Admin can append ad performance entries (spend/reach/clicks/results, THB default) against a campaign record; no PATCH/DELETE route exists on performance entries; full history is visible.
4. **The separation proof** — with paid data seeded: `GET /api/dashboard/overview`, `/revenue`, `/revenue/:contentId`, the revenue CSV bytes, the commerce summary/CSV bytes, and every persisted `ranking_scores.score` are **byte-identical** to the zero-paid-data fixture. Plus a static boundary test: no payout, commerce, or ranking module imports or references the new paid module/tables.
5. Paid dashboard section renders **visually separated** with explicit copy stating it is **not** included in payout revenue or commerce revenue; paid CSV is a **separate file** with no payout or commerce column.
6. **Zero audience-targeting or individual-recipient-level columns** exist in the paid schema — System Analyst signs off the PDPA/aggregate-only design at the 7.0 gate and re-verifies against the shipped migration.
7. No code path in the shipped system calls the Meta Ads MCP; grep-level check confirms no reference to `mcp.facebook.com` or an MCP client library in application code.
8. Backend suite green (target +30–50 over the 599 baseline — this is a materially smaller phase than Commerce), lint zero-warning, typecheck clean; frontend jest green + `next build` passes.
9. **Visual QA pass with browser tools is a first-class deliverable** — every new page/modal, all three widths, console clean. (Phase 5D and Phase 6C both established this is not substitutable by API-contract testing; the pattern holds again.)
10. 7D deliverable exists: written live-sync spec (standard Meta Marketing/Insights API, not MCP) + a stub adapter that rejects cleanly and audibly when enabled without credentials.
11. **Admin has explicitly confirmed the §0 schedule call** — proceeding with the manual-entry slice now, while the 8-week real-usage evidence window (started 2026-07-20) continues to gate any live-sync or scope-expansion decision. This is recorded as a decision, not assumed by silence.

---

## 4. Recommended sub-phase split

Following the established cadence (…4.0/4A/4B → 5.0/5A/5B/5C → 6.0/6A/6B/6C/6D):

| Sub-phase | Name | Blocking? | Entry criteria | Exit criteria |
|-----------|------|-----------|-----------------|---------------|
| **7.0** | Schema & Separation Gate | **Yes — blocks 7A** | Phase 6 (6.0→6D) closed; this plan accepted; **admin confirms §0 schedule call (exit #11)** | Migration verified on real Postgres; `Platform`/`AssetPlatform` diff empty; separation-test *design* agreed; **System Analyst signs off PDPA aggregate-only design**; audit actions + no-new-env-flag decision recorded (no live gating needed yet — nothing live exists) |
| **7A** | Backend | after 7.0 sign-off | 7.0 exit met | Campaign-record + performance-entry endpoints live with full guard parity; paid read model + CSV; **exit criteria #2–#5, #7 green**; API contract frozen |
| **7B** | Frontend | after 7A contract freeze | 7A contract frozen | Campaign record UI, performance-entry modal, **separated** paid dashboard section + export; jest green, `next build` passes |
| **7C** | QC / QA / Visual gate | **Yes — blocks exit** | 7A + 7B merged | QC APPROVED; QA signed off zero Critical/High; **visual QA pass performed with browser tools** (exit #9); System Analyst re-verifies #6 against shipped code |
| **7D** | Live-sync spec + rejecting stub (flagged tail) | non-blocking | — | Written spec in `docs/` (standard Marketing/Insights API, not MCP); stub rejects cleanly without credentials; **no live HTTP client built** |

App Designer receives 7.0 + 7A/7B scope together and must produce the **paid/organic/commerce triple-separation dashboard design** before code starts — the highest-risk UX surface in this phase (R1), by direct analogy to Phase 6's R1.

---

## 5. Work Breakdown Structure (WBS)

Effort in T-shirt sizes (S/M/L), dependency-ordered — no calendar dates until UAT, per `bussiness_rule.md` §Budget/Timeline.

### Phase 7.0 — Schema & Separation Gate [gate]

| ID | Work package | Size | Acceptance criteria |
|----|--------------|------|---------------------|
| 7.0.1 | `AdChannel` enum (`meta` only). **No change to `Platform` / `AssetPlatform`** — documented in the migration note citing the Decision 2/P-F irreversibility rule, same shape as Phase 6's `CommerceChannel` note. | S | Enum diff on the two existing platform enums is empty. |
| 7.0.2 | Tables: ad campaign record, ad performance entry (append-only). No FK to `Metric` or `CommerceConversion`. Optional nullable FK to `Content` on the campaign record only. | M | Migration applies clean on real Postgres; append-only proven by route-absence test once 7A lands. |
| 7.0.3 | Extend the typed audit-action union with the new mutating paths (campaign create/update/retire, performance entry added, paid report exported). | S | Typed union compiles; every mutating path has an action. |
| 7.0.4 | **PDPA + separation policy doc**, locked with System Analyst: no-audience-data column ban, paid/payout/commerce non-summation rule, paid export redaction posture. | M | Signed policy in `docs/`; feeds 7A.6 and the 7C gate. |
| 7.0.5 | **Separation test design** agreed and written as failing tests first: static boundary assertion + byte-identical payout/commerce/ranking fixture. | M | Tests exist and fail meaningfully before 7A code lands. |
| 7.0.6 | **Admin confirmation of the §0 schedule call**, recorded in `bussiness_rule.md` alongside the existing "Ads/Paid Module" entry. | S | Exit criterion #11 satisfied; dated entry added. |

**7.0 exit**: migration verified on real Postgres; platform-enum diff empty; System Analyst signs off PDPA + separation; separation tests scaffolded; admin schedule confirmation on record.

### Phase 7A — Backend

| ID | Work package | Size | Acceptance criteria |
|----|--------------|------|---------------------|
| 7A.1 | Ad campaign record CRUD — create/edit/soft-retire. AdminGuard + CSRF + audit. | M | CRUD works; retire is soft (never hard-delete, same as Commerce products); audit rows written. |
| 7A.2 | Ad performance entry — append-only add + history read; **no PATCH/DELETE route exists**. | M | Route-absence test proves append-only; entries visible in history. |
| 7A.3 | Paid read model — summary by campaign/period, optional by-content rollup (informational only). **Reads only paid tables.** | M | Totals correct; zero `metrics`/commerce-table reads (proven by the boundary test). |
| 7A.4 | Paid CSV export — separate report, never a column on the revenue or commerce report. Audited, no PII. | S | Separate file; byte-level test confirms no audience/individual-level values (there should be none to find). |
| 7A.5 | **Make the 7.0.5 separation tests pass** — boundary assertion + byte-identical payout/commerce/ranking fixture. | M | Exit criterion #4 green. This is the phase's definition of done. |
| 7A.6 | Grep-level guard: no reference to `mcp.facebook.com` or any MCP client library anywhere in `backend/src` or `frontend/src`. | S | Exit criterion #7 green; wire into CI as a standing check, not a one-time manual grep. |

### Phase 7B — Frontend

| ID | Work package | Size | Acceptance criteria |
|----|--------------|------|---------------------|
| 7B.1 | `/paid` (or equivalent nav entry) — campaign record list, create/edit/retire form, optional content-link picker. | M | CRUD round-trips; retire reflected; empty/loading states. |
| 7B.2 | Performance-entry modal + history view (append-only; corrections entered as new rows, shown as such). | M | Append-only visible in UI; no edit affordance anywhere. |
| 7B.3 | **Paid dashboard section** — a distinct, visually separated block on `/dashboard` with explicit copy: *"Paid/ads — logged manually from Meta Ads Manager, tracked separately, not included in platform payout or commerce revenue."* Separate export button. **No combined total with payout or commerce anywhere on the page.** | L | Design-reviewed for triple-separation clarity; a UI test asserts no element renders payout+paid or commerce+paid summed. |
| 7B.4 | Nav + labels (`AdChannel` label map — one value, `meta`) + client-logic unit tests. | S | jest green; `next build` passes. |

### Phase 7C — QC / QA / Visual gate [gate]

| ID | Work package | Size | Acceptance criteria |
|----|--------------|------|---------------------|
| 7C.1 | QC review — coding standards, tree hygiene, and a **specific check that no paid-module import crossed into payout/commerce/ranking modules**, and the MCP-reference grep guard is wired into CI. | M | QC APPROVED. |
| 7C.2 | QA — adversarial pass on the guards (retire-then-edit, append-only route absence, boundary/negative amount handling), plus the separation fixture. | M | Zero Critical/High. |
| 7C.3 | **Visual QA with browser tools** — every new page/modal at mobile/tablet/desktop; console clean; the triple-separation verified *by eye*. | M | Exit #9. If browser tools are unavailable, the criterion is reported **BLOCKED**, never "met by other means" (Phase 5/6 lesson). |
| 7C.4 | System Analyst re-verifies exit #6 (PDPA aggregate-only) against the shipped migration, not the plan. | S | Signed. |

### Phase 7D — Live-sync spec + rejecting stub (flagged tail, non-blocking)

| ID | Work package | Size | Acceptance criteria |
|----|--------------|------|---------------------|
| 7D.1 | Written spec: standard Meta Marketing API / Insights API pull (`ads_read` scope), **explicitly not the Ads MCP** (restate Decision 2 in the doc itself), OAuth-scope-review implications tied back to `docs/meta-app-review-status.md`. | M | Spec in `docs/`; sufficient that implementation-day work is bounded, not researched from scratch. |
| 7D.2 | Live stub rejects cleanly + audited when enabled without credentials. **No live HTTP client.** | S | Enabling live fails with an actionable message; manual stays the only real path. |

---

## 6. Dependency order (critical path)

```
7.0 (schema + PDPA/separation gate + failing separation tests + admin schedule sign-off)
      │  (System Analyst + admin sign-off)
      ▼
7A backend ──▶ 7A.5 SEPARATION PROOF ◀── gates everything ──▶ contract freeze ──▶ 7B frontend ──▶ 7C (gate)
                                                                                                    │
7D (spec + stub, non-blocking, no live client) ────────────────────────────────────────────────────┘ (parallel, no dependency)
```

- **Hard blocker**: 7.0 before any 7A code, same discipline as Phase 6.0 → 6A. The separation tests must exist and *fail* first.
- **API contract freeze**: 7A.1/7A.2/7A.3 shapes frozen before 7B, same cadence as every prior phase's contract freeze.
- **7A.5 is the gate on the phase**, not a final checkbox — if it cannot be made green, the design is wrong and must be revisited before 7B, exactly as Phase 6's 6A.10 was framed.
- **7D is genuinely independent** — it touches no shared code path and can start any time after 7.0, in parallel with 7A/7B, without risk to the critical path.

---

## 7. Risk Register

Probability (P) x Impact (I), 1–5. Score = P×I. Owner in parentheses.

| ID | Risk | P | I | Score | Mitigation | Owner |
|----|------|---|---|-------|-----------|-------|
| **R1** | **Paid spend/results summed into payout or commerce revenue** — a dashboard card, an API total, or a CSV column blends the three streams. This is the risk the whole design exists to prevent, restated a third time in this program's history. | 3 | 5 | **15** | Separate tables (Decision 4) so no existing query can see paid data; static boundary test; byte-identical payout/commerce/ranking fixture (7A.5, exit #4); UI test asserting no summed element; App Designer produces an explicit triple-separation design before code. | App Developer / QA |
| **R2** | **PDPA — audience/targeting or individual-recipient data ingress.** A well-meaning "let's also log which custom audience we targeted" turns Content Hub into a processor of consumer personal data with no DPA. | 3 | 5 | **15** | No column exists to hold it (Decision 5) — schema is the control; System Analyst sign-off at 7.0 **and** re-verification against shipped migration (7C.4); explicitly named out-of-scope in §3.2. | System Analyst / QA |
| **R3** | **Content Hub becomes coupled to the Meta Ads MCP** despite Decision 2 — e.g., a future contributor wires it in "since it's right there," reopening the exact dependency `SETUP-CHECKLIST.md` §6.4 warned against (beta, no SLA, no pricing). | 2 | 4 | 8 | Grep-level CI guard (7A.6, exit #7) makes this a build-breaking check, not a code-review hope; Decision 2 documented at the top of this plan and in the 7D spec itself. | Quality Control |
| **R4** | **Ranking contaminated by paid signal**, breaching Decision 6/P-B — silently, since v2 already blends `metric.revenue` from one source; a second blended source is an easy copy-paste mistake. | 2 | 5 | **10** | Ranking module frozen this phase; paid data lives in tables ranking does not query; boundary test names `modules/ranking/` explicitly; ranking-score byte-identity is part of exit #4. | App Developer |
| **R5** | **`AssetPlatform`/`Platform` gets a `meta_ads` value** by a future well-meaning change — irreversible (P-F), and it would enrol paid "posts" into `RANKED_PLATFORMS_V2`. | 2 | 5 | **10** | Decision 4/§3.2 recorded as a comment on the enum block itself with the ranking consequence spelled out, same as Phase 6 R4; QC checklist item. | Quality Control |
| **R6** | **Building ahead of the evidence gate** (§0) — shipping a feature before the 8-week real-usage window the program itself set has elapsed, on the theory that MCP-driven cost reduction is close enough to justify it. | 3 | 3 | 9 | Explicit admin sign-off required as exit criterion #11 before 7.0 starts, not assumed; scope kept to the cheapest, fully reversible slice (manual entry, no OAuth, no MCP coupling) precisely so that if the evidence never materializes, nothing costly was sunk. | PM |
| **R7** | **Manual-entry data quality drifts from reality** — spend/results typed in from memory or a screenshot, not reconciled against a statement (paid has no analogous "vendor statement" artifact the way Commerce conversions at least reference one). | 3 | 2 | 6 | UI captures the entry period and a free-text reference field (mirroring `CommerceConversion.statementRef`) so entries are at least traceable to "which Ads Manager screen this came from"; not a hard block — same posture as Commerce R8/R9. | App Developer / PM |
| **R8** | **Scope creep toward Option B or C** during 7B build — "just add a Boost button that opens a pre-filled MCP prompt" looks small in the moment. | 3 | 4 | 12 | Named explicitly in §3.2 and the Do-NOT list; QC 7C.1 checklist item; the rejection reasoning (Decision 1) is written down, not just implied, specifically so it can be pointed to mid-sprint. | PM / Quality Control |
| **R9** | **Pressure to add Google Ads / TikTok Ads** once the Meta slice ships and looks easy, without any equivalent low-friction connector existing for those channels. | 2 | 3 | 6 | Decision 3 recorded explicitly; `AdChannel` enum deliberately not designed as a speculative multi-channel abstraction — adding a channel later is an honest, visible migration, not a config flip. | PM |
| **R10** | **Visual QA skipped again.** Phase 5 and Phase 6 both proved substitution does not work. | 2 | 4 | 8 | Exit #9 is a first-class criterion; if tooling is unavailable the criterion is reported **BLOCKED**, never "met by other means." | QA Tester |
| **R11** | **Unverifiable live code** built for an API scope (`ads_read`) nobody has requested yet, reading as capability. | 2 | 3 | 6 | Decision 1/7D: spec + rejecting stub only, no live HTTP client, directly extending the Phase 5/6 standing recommendation. | PM |

### 7.1 Carry-forward register (inherited, non-blocking)

| Item | Source | Disposition in Phase 7 |
|------|--------|------------------------|
| **8-week Ads/Paid evidence window** | Phase 6 plan §7.1; `SETUP-CHECKLIST.md` §6.3 | **Still running** (started 2026-07-20). This phase's manual-entry data becomes part of that evidence, but the window itself is not shortened by shipping this feature. Live-sync (7D→future) stays gated on it. |
| **5C never built** (live TikTok/LINE adapters + PDF export) | Phase 5 plan §5C | Unchanged; unrelated to this phase. |
| **6D live commerce integration** (Shopee/TikTok Shop) | Phase 6 plan §Decision 5 | Unchanged; unrelated to this phase — same "spec, not code, without credentials" posture now extended a third time (paid). |
| **Cron auto-sync** (metrics + comments) still manual | Phase 3.5 defer | Unchanged. Paid data is manual **by design** this phase too, so no new cron need is created. |
| **QA5B-OBS-1 / commerce record-surface question** | Phase 5B QA / Phase 6 §9.6 | Unrelated; still owed by admin, unaffected by this phase. |
| **Meta App Review submission** | Phase 1.5 | Admin action; Dev Mode still sufficient for own-Page publish. **Requesting `ads_read` scope (7D, future) would be the trigger to revisit this** — noted explicitly in the 7D spec. |
| **Single `.env` source of truth** | P4-OBS-1, recurring | No new env flags needed this phase (no live gating exists yet for paid) — first phase in this program's history that doesn't add one. |
| **401-as-ERROR log noise** | Phase 2 | Unchanged. |

---

## 8. Resource / agent allocation

| Deliverable | Primary agent | Support |
|-------------|--------------|---------|
| Paid/organic/commerce **triple-separation design**, campaign-record UX, performance-entry modal | App Designer | PM (scope constraints, P-A/P-B/Decision 4) |
| PDPA aggregate-only + separation sign-off (7.0.4, 7C.4) | System Analyst | PM (risk register) |
| 7.0 schema, 7A backend, 7B frontend, 7D spec/stub | App Developer | — |
| Coding standards + **cross-module import check** + **MCP-reference grep guard** (R3, R4, R5) | Quality Control | — |
| Guard/adversarial tests, separation fixture, **visual QA** (exit #9) | QA Tester | — |
| Admin schedule sign-off (§0, exit #11); MCP usage stays admin's own tool, unchanged workflow | **Admin** | PM (tracks, does not own) |
| Loop close-out + next-iteration verdict | Bug Fixer → PM | — |

---

## 9. Open questions for the admin/user (need an answer before build starts)

1. **§0 schedule call**: proceed now with the manual-entry visibility slice while the 8-week real-usage evidence window (started 2026-07-20) keeps gating live-sync — or wait for that window to close before starting *any* Phase 7 work, manual-entry included? This plan recommends **proceed with the manual slice now** (it's cheap, reversible, and its own data feeds the evidence window) but this is explicitly the admin's call to make, not the PM's to assume. **This is exit criterion #11 — blocking, must be answered before 7.0 starts.**
2. **Content-linkage granularity**: is a nullable link from an ad campaign record to a single `Content` row sufficient, or do campaigns typically promote a pillar/set of content such that a many-to-many link (or no link at all, freestanding entries) fits reality better? Recommend the simple nullable single-link version for v1; say so now if that's already known to be wrong.
3. **Results taxonomy**: what result types matter to the admin — leads, purchases, video views, link clicks, engagement, reach-only awareness campaigns? Recommend a free-text `resultType` label + numeric count rather than a rigid enum, given how little is known yet; confirm or push back.
4. **Currency**: default THB assumed, same as Commerce. Confirm.
5. **Ownership unchanged?**: `bussiness_rule.md` §Ownership has admin as sole owner of platform priority/budget/compliance — confirm paid-visibility data follows the same single-admin model with no new role.
6. **7D trigger condition**: confirm that "request `ads_read` scope + revisit Meta App Review" is the correct, and only, trigger for building the live-sync path — not simply "the 8-week window closes" by itself (closing the window only re-opens the *decision*, it doesn't by itself grant the scope or clear App Review).

---

## 10. Consistency check against existing docs

- Implements the still-open `bussiness_rule.md` §"Ads/Paid Module" row by **explicitly not treating B-lite as fully closed** — it narrows what "revisit" means (visibility, not the module `makedown.md` §10 originally sketched with ad-account OAuth + budget allocation + spend-ROI dashboard) rather than building that original, broader sketch.
- Honours `SETUP-CHECKLIST.md` §6.4's Meta Ads MCP guidance in full: MCP stays admin-side, no production dependency, checked with a standing CI grep rather than a one-time read.
- Honours every standing business rule: no auto-publish/no campaign automation, admin confirms every write, revenue definition untouched, organic-only ranking preserved a third time.
- Reuses every established pattern: manual-first-live-later (TikTok/LINE, Commerce, now Paid), append-only with no PATCH/DELETE, AdminGuard + CSRF + audit, `source: manual|api` provenance shape, byte-identical separation regression testing, the gate → backend → frontend → QC/QA cadence, spec-not-code for unverifiable live integrations.
- Extends the **channel-enum-parallel-to-`Platform`** precedent (`AssetPlatform` since Phase 1.5, `CommerceChannel` since Phase 6) with `AdChannel` — the same solution to the same class of problem a third time, not a new idea.
- Names, rather than silently overrides, the one place this plan is in tension with a prior written decision (§0) — consistent with this role's standing instruction not to over-plan in isolation from real feedback, and not to let "vague scope" or "skipped risk register" creep in on a phase that looks small.

---

## Handoff summary (for App Designer / Developer building next)

- **This is a visibility feature, not an ads module.** Campaign creation/editing/budget/audience management stay entirely outside Content Hub — in Meta Ads Manager, or in the admin's own direct use of the Meta Ads MCP. Content Hub's only job this phase is to let the admin log what a campaign cost and returned, next to organic and commerce numbers, without ever summing the three.
- **The MCP is not something this codebase calls.** `SETUP-CHECKLIST.md` §6.4 already decided that; this plan extends the same call to a CI-enforced grep guard (7A.6) rather than a one-time judgment. If a future contributor proposes wiring it in, that proposal is contradicting a recorded, reasoned decision and should be treated that way.
- **Third stream, same discipline as the second.** New standalone tables (campaign record + append-only performance entry), no discriminator on `Metric`, no FK into `Metric`/`CommerceConversion`, no read from `modules/ranking/`. The phase's definition of done is exit criterion #4: with paid data seeded, every payout endpoint, every commerce endpoint, the two CSV exports, and every persisted ranking score are **byte-identical** to the zero-paid-data fixture.
- **Meta only, `AdChannel` enum with one value.** No `Platform`/`AssetPlatform` change — same irreversibility argument Phase 6 made for `CommerceChannel`. Google Ads/TikTok Ads are a named future candidate, not a parallel workstream.
- **PDPA line: aggregate campaign metrics only.** No audience/targeting data, no custom-audience/customer-list data, no individual ad-recipient or click-level rows — there must be no column capable of holding any of that.
- **Sequence: 7.0 gate (admin sign-off on the §0 schedule call, then write the separation tests first and let them fail) → 7A backend → freeze contract → 7B frontend → 7C QC/QA + visual gate → 7D spec-only tail (parallel, non-blocking).** Top risks: streams summed together (R1) and PDPA audience-data ingress (R2), both scored 15 — same top-two shape as Phase 6, same reason.

### Scope traps — things that must explicitly NOT be done

1. **Do NOT build campaign creation, editing, targeting, or budget management inside Content Hub.** Meta Ads Manager and the admin's own MCP usage already cover this; duplicating it is Option C, rejected.
2. **Do NOT wire Content Hub to call the Meta Ads MCP at runtime**, for any reason, this phase or without a fresh decision superseding `SETUP-CHECKLIST.md` §6.4 and Decision 2 above.
3. **Do NOT put paid spend/results in the `metrics` table**, with or without a discriminator column.
4. **Do NOT let anything under `modules/ranking/` read a paid-data table.** Ranking stays organic-only. Making it paid-aware is a separate future decision, not a Phase 7 improvement.
5. **Do NOT sum paid, payout, and commerce anywhere** — no combined KPI card, no combined API total, no shared CSV column, no "total revenue/spend" that includes more than one stream. Three sections, three exports, three totals.
6. **Do NOT store audience-targeting, custom-audience/customer-list, or individual ad-recipient/click-level data** — campaign-level aggregate figures only. There must be no column capable of holding it.
7. **Do NOT add `meta_ads` (or any paid value) to `Platform` or `AssetPlatform`.** Irreversible, and it would silently enrol paid data into `RANKED_PLATFORMS_V2`.
8. **Do NOT build a live Meta Marketing/Insights API HTTP client** without the `ads_read` scope actually granted and App Review implications resolved. Spec + rejecting stub only.
9. **Do NOT expand to Google Ads or TikTok Ads this phase**, and do not pre-build a generic multi-channel abstraction in anticipation of them.
10. **Do NOT skip visual QA.** Established twice already as non-substitutable.
11. **Do NOT start 7.0 without the admin's explicit §0 schedule sign-off** (exit criterion #11) — this plan flags a real tension with a decision the program made in writing one day ago, and silence is not the same as resolving it.

---

**Prepared by:** Senior Project Manager, Loop Engineering Position #1
**Date:** 2026-07-21
**Baseline:** 599/599 backend tests, frontend jest green, 10 migrations, `RANKING_ENGINE=v2`, Phase 1–6 (6.0→6D) fully closed
**Next agent:** App Designer — the paid/organic/commerce **triple-separation dashboard design** is the first and highest-risk deliverable, by direct analogy to Phase 6's commerce/payout separation design.

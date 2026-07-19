# Phase 5 — Multi-Platform Expansion + Full Analytics · Project Plan

- **Author**: Senior Project Manager (Loop Engineering entry point, position #1)
- **Date**: 2026-07-19
- **Iteration input**: Phase 4 close-out (`docs/phase4-bugfix-feedback.md`, verdict CONTINUE→now closed) — Phase 4B frontend shipped, QC APPROVED + QA clean, Phase 4 done end-to-end. 285 backend + 44 frontend tests on `main`.
- **Depends on**: Phase 2 (adapters + registry + ranking v1 + publish step-up/CSRF/audit + `was_override` recompute + idempotency index), Phase 3 (append-only metrics + Dashboard read-model), Phase 4 (CommentsModule + PDPA controls).
- **Downstream handoff**: App Designer (adapter + manual-record UX, ranking-v2 reasoning UI, export UX, revenue drill-down) → System Analyst (export-PII + TikTok/LINE data-handling gate) → App Developer.
- **Status doc alignment**: implements `makedown.md` §5 Phase 5 (4 bullets) + §9.5 phase table row 5; consumes the `override tracking` logged since Phase 2 (§8, business rule "log recommendation-followed-vs-overridden"); closes System Analyst condition "PlatformAdapter contract tests (gate Phase 5)".
- **Note — final planned phase**: Phase 5 is the last committed phase. Its exit includes the **Ads/Paid B-lite revisit decision** (`bussiness_rule.md` — "ตัดสินใหม่ตอน Phase 5 จบ") and a loop-termination assessment. Phase 6 (optimization backlog) and Phase 7 (Ads candidate) remain uncommitted.

---

## 1. Project Charter

### 1.1 Objective
Bring the system to **all four platforms** (Facebook, YouTube, **TikTok, LINE OA**) in the publish pipeline, upgrade the ranking engine to a **v2 that learns from real accumulated data** (metrics + override history now exist) while staying rule-based and explainable, and deliver **exportable analytics** (CSV/PDF) with revenue drill-down per content — all within the existing organic-only, admin-confirms-every-publish, PDPA-compliant guardrails.

### 1.2 Success statement
> Admin can record/track a publish on all four platforms in one place; the scheduler ranks all four with an **explainable v2 score** that reflects real per-pillar×platform earnings/engagement **and** the admin's own past override behavior (visible in the reasoning); admin can drill into revenue per content and export revenue / override-log / comment-summary reports as CSV (and PDF) with **no comment PII leaking into exports**; and none of this regresses v1 ranking behavior, publish authority, or the append-only/idempotency invariants.

### 1.3 Constraints fixed by prior decisions (do not re-litigate)
| # | Constraint | Consequence for this plan |
|---|-----------|---------------------------|
| C-A | No real platform credentials in this demo; FB/YT live paths themselves are only **mock-verified** (`PUBLISHER_IMPL_*` gating). | TikTok/LINE **cannot** be delivered as verified live adapters. Delivery posture must match FB/YT: mock-first, live path built-but-flagged-and-unverified. See Decision 1. |
| C-B | Revenue for TikTok + LINE OA is **manual** (no public revenue API) — `metric.source=api\|manual` and the manual endpoint already exist. | No new revenue-sync work for TikTok/LINE; ranking's earnings signal for them comes from manually-entered metrics. |
| C-C | Publish is **never automatic**; admin confirms every publish; override always available; `was_override` recomputed server-side. | The manual-external-post path and TikTok/LINE adapters keep the same step-up + audit + override-recompute flow. No auto-anything. |
| C-D | Ranking must be **explainable in UI, no black-box ML** (`ranking_scores.reasoning` jsonb). | v2 stays a transparent weighted rule set; the override-feedback signal must appear in the reasoning jsonb. |
| C-E | Ads/Paid = **B-lite, out of scope through Phase 5**. | Ranking v2 uses organic signal only; no paid metric split. |
| C-F | `EngineVersion` enum already has `v1\|v2`; `Platform`/`AssetPlatform` enums already carry all 4 values; `platform-map.util` already bridges tiktok + line/line_oa. | **No platform-enum migration and no platform-map change needed.** v1 engine/factors are frozen and untouched. |

---

## 2. Explicit decisions (the real unknowns, resolved)

### Decision 1 — TikTok/LINE publish feasibility → **Mock adapters + first-class manual-external-post path (recommended)**

**Options weighed**
- **(A) Full live adapters.** TikTok **Content Posting API** requires an audited app (unaudited apps can only post to private/SELF_ONLY), and LINE **Messaging API** does a *broadcast/push to OA followers*, not a feed "post" like FB. Both need credentials this demo does not have. Even FB/YT live paths are only mock-verified — shipping "live" TikTok/LINE would be unverifiable theater.
- **(B) Mock adapters + manual-external-post record path.** Admin publishes manually on the native platform (the realistic single-admin workflow today), then records the `external_post_id` + URL in Content Hub so the post becomes a first-class tracked entity — metrics and comments can attach to it, and it counts toward cadence/ranking.

**Recommendation: (B), with the live path present-but-flagged (same posture as FB/YT).**

Rationale: it matches every fixed constraint — no creds (C-A), single admin (C-C), revenue already manual for these two (C-B) — and it is **honest**: it delivers real tracking value without pretending to verify an unverifiable live integration. Concretely:
1. Implement `TikTokAdapter` + `LineAdapter` against the existing `PlatformAdapter` interface, **mock mode as the mandatory default** (deterministic dry-run ids, faithful `accessToken: null` rejection), gated by new `PUBLISHER_IMPL_TIKTOK` / `PUBLISHER_IMPL_LINE` flags — identical to FB/YT. Register them in `PlatformAdapterRegistry` (the Map that currently throws for them). This makes the **whole pipeline uniform across 4 platforms** for publish/metrics/comments.
2. Add a **manual-external-post record path** as the *primary* Phase-5 publish mechanism for TikTok/LINE: the admin records that they posted externally, supplying `external_post_id` + optional URL. This **reuses the Phase 2 `posted_unconfirmed` → "Mark posted (enter external id)" mechanism** already built and QA-verified, extended with an explicit `publishMethod` so a manually-recorded post is distinguishable from an adapter-published one for audit/analytics.
3. The live adapter code paths ship **disabled and unverified** behind their flags (mirrors the "live FB/YT paths only mock-verified" reality) — a documented follow-up, not a Phase-5 exit gate.

This means "add TikTok/LINE to publish" = adapters + registry entry + manual-record path + ranking inclusion — **not** a live-integration project.

### Decision 2 — Ranking v2 → **same transparent weighted engine, +1 factor, revenue-blended, re-weighted, flag-selected, v1 frozen**

v1 shipped with mostly-neutral factors on empty history; metrics + override history now exist. v2 keeps the rule-based/explainable contract (C-D) and changes exactly these inputs:

| Factor (v2) | vs v1 | Change |
|-------------|-------|--------|
| `engagement_history` | changed | Now has real data, **and** the value blends **engagement + earnings (revenue)** per pillar×platform (v1 exposed `platformAvgRevenue` in `input` but the *value* used engagement only). v2 value = normalized blend so the **business objective (payout)** actually drives the score. |
| `api_availability` | unchanged | Constant map already has tiktok/line_oa = 0.4. |
| `pillar_alignment` | unchanged formula | Behaves richer now that 4 platforms post. |
| `cadence_pressure` | unchanged formula | Requires seeding cadence targets for tiktok/line_oa (see 5A.3). |
| `override_feedback` | **NEW** | Consumes logged `was_override` history — see Decision 3. |

**Weights (v2), must sum to 1.0** (unit-tested like v1): `engagement_history 0.30`, `override_feedback 0.20`, `cadence_pressure 0.20`, `pillar_alignment 0.15`, `api_availability 0.15`. (Rationale: real data now justifies shifting share toward earnings/engagement + the admin's revealed preferences, and trimming the api_availability thumb-on-scale that mattered most when history was empty.)

**Platform coverage**: extend `RANKED_PLATFORMS` from `[facebook, youtube]` to `[facebook, youtube, tiktok, line_oa]` — **appended, never reordered** (the list order is the documented tie-break; appending preserves the exact FB/YT tie-break v1 tests assert).

**Versioning + no-regression strategy**:
- v2 lives in a **new** `RankingEngineV2Service` (+ `RankingFactorsV2Service` or a v2 method set); the v1 `RankingEngineService`/`RankingFactorsService` and `ranking.constants.ts` FACTOR_WEIGHTS stay **byte-frozen** so all existing v1 unit tests pass unchanged.
- Selection via env flag `RANKING_ENGINE=v1|v2`, **default `v1`** until QA verifies v2; flip to `v2` at the QC/QA gate. Every persisted row is tagged `engineVersion` (v1 rows stay attributable to v1 logic — the reason the enum exists).
- `pickRecommendedScore` + the append-only `RANKED_PLATFORMS` are **shared and unchanged in shape**; v2 just feeds it a 4-element set. This keeps the scheduler-overview vs per-content recommendation agreement (BUG-QA-003) intact.
- Regression guard: a golden test asserts that, for a fixed empty-history fixture, v2 with only FB/YT present produces the **same recommendation** as v1 (documents the migration is monotone on the legacy case).

### Decision 3 — Override feedback loop → **new `override_feedback` factor, raw counts in reasoning jsonb (auditable)**

Data source (logged since Phase 2, never yet consumed): `Post.wasOverride`, `Post.recommendedPlatform`, `Post.selectedPlatform`, `Post.overrideReason`. For a given (pillar, platform) over a lookback window (e.g. 90 days / last N decisions):
- **Overridden-away**: platform was `recommendedPlatform` but admin picked a different `selectedPlatform` (`wasOverride=true`) → the admin rejected this platform's recommendation → **down-weight**.
- **Chosen-as-override-target**: platform was `selectedPlatform` on an override away from a different recommendation → admin actively prefers it → **up-weight**.

`value = clamp01(0.5 + (towardRate − awayRate) / NORMALIZER)`, where rates are over decisions for that pillar. **Neutral 0.5 below a min-sample threshold** (e.g. < 5 decisions) — avoids overfitting sparse single-admin data (same "we know nothing → don't move the score" reasoning as `NEUTRAL_FACTOR_VALUE`). The factor's `input` jsonb carries `{pillar, sampleSize, recommendedCount, overriddenAwayCount, selectedAsOverrideCount, towardRate, awayRate}` so the UI renders exactly *why* the override signal moved the score — transparent + auditable (C-D). Sentiment is **not** fed into ranking (out of scope, per Phase 4 boundary).

### Decision 4 — Export → **CSV-first (must-have), PDF second (should-have via `pdfkit`); 3 reports; PII-redacted**

- **CSV** = must-have, no dependency, streamable, admin-only, audited (`report_exported` audit action). Ships in the backend pass.
- **PDF** = should-have, sequenced after CSV. Recommend **`pdfkit`** (pure-Node, server-side) over a headless-Chromium approach (puppeteer) — no browser binary in the container, smaller attack/ops surface. If schedule tightens, PDF drops to the 5C flagged tail; CSV alone still satisfies the "export report ใช้งานได้" exit criterion.
- **Reports (3)**: (1) **Revenue by content / platform / period** (the drill-down, latest-per-post semantics matching Dashboard); (2) **Override log / recommendation-adherence** (recommended vs selected, override_reason, was_override) — this is also the human-readable audit of Decision 3's input; (3) **Comment summary** — **aggregate counts only** (sentiment / priority / SLA-breach tallies), **never raw author/text**.
- **PII handling**: comment exports are aggregate-only by default; if any per-comment export is ever added it MUST route through the existing `redact-comment-meta.util` (PDPA rule from Phase 4). Revenue/override exports are business data, admin-only. Every export writes an audit row (who/when/report/filters) with **no PII in the audit meta**. Read-only ⇒ step-up not required, but the download is logged. System Analyst signs off the export-PII design at the 5.0 gate.

---

## 3. Scope

### 3.1 In scope
1. TikTok + LINE OA adapters (mock-first) registered in the publish pipeline; manual-external-post record path; metric + comment attachment for those posts; TikTok/LINE cadence targets seeded.
2. Ranking engine **v2** (rule-based, explainable): revenue-blended engagement factor, new override-feedback factor, 4-platform coverage, flag-selected, v1 frozen.
3. Override-tracking feedback loop feeding v2 (Decision 3), surfaced in reasoning jsonb + UI.
4. Export (CSV must-have, PDF should-have): revenue drill-down per content, override log, comment summary (redacted).
5. Frontend for all of the above (publish modal 4-platform + manual-record UI, v2 reasoning display + engine badge, revenue drill-down, export buttons, override-log view).

### 3.2 Out of scope — explicit "not this phase"
- **Verified live TikTok/LINE (or FB/YT) publishing/metrics** — no creds; live paths ship flagged + unverified (Decision 1, mirrors Phase 3/4 live-path defers).
- **Automated revenue sync for TikTok/LINE** — no API (C-B); stays manual.
- **Cron auto-sync of metrics/comments** — still the deferred Phase 3.5 bundle (shared `getValidToken` system-context fix); Phase 5 keeps manual Sync buttons.
- **Sentiment → ranking** — Phase 4 boundary holds; only override + engagement/earnings/pillar/cadence/api feed ranking.
- **Learned/ML ranking** — v2 is still a transparent weighted rule set (C-D).
- **Ads/Paid** — B-lite (C-E); its go/no-go *decision* is a Phase-5-exit output, but no build.
- **Per-comment PII export** — aggregate-only comment reports; no raw author/text leaves the system.
- **Audience sub-segment analytics, A/B creative test, competitor benchmark, KPI target/alert** — remain `makedown.md` §10 backlog, not pulled in.

### 3.3 Exit criteria (Phase 5 DONE when all true)
1. All 4 platforms are selectable in the publish flow; `PlatformAdapterRegistry` returns adapters for tiktok + line_oa (no longer throws); `platform-adapter.contract.spec` updated — **all 4** adapters satisfy the contract, and the "throws for unimplemented platform" case is removed/retargeted.
2. Admin can record a manual external post for TikTok/LINE (`external_post_id` + URL, `publishMethod=manual_external`), it appears in `/posts`, and a metric + a comment can attach to it — verified live on the Docker stack.
3. Ranking v2 scores all 4 platforms; `reasoning` jsonb shows 5 factors including `override_feedback` with raw counts; `engineVersion=v2` persisted; UI renders the v2 breakdown + engine-version badge.
4. A seeded override-history fixture demonstrably moves a v2 recommendation (down-weight a repeatedly-overridden pillar→platform), and the reasoning explains it.
5. v1 is not regressed: all existing v1 ranking tests pass unchanged; with `RANKING_ENGINE=v1` behavior is byte-identical to today; the FB/YT tie-break order is unchanged.
6. Revenue drill-down per content works in `/dashboard`; **CSV export** of revenue / override-log / comment-summary downloads correctly, comment export carries **zero raw author/text**, each export writes an audit row. (**PDF** if delivered in 5A.7, else flagged in 5C.)
7. Backend suite green (target +45–65 over the 285 baseline), lint zero-warning, typecheck clean; frontend jest green + `next build` passes.
8. System Analyst signs off **export-PII handling + TikTok/LINE data-handling** (compliance gate, analogous to Phase 1.5 / Phase 4.0).
9. **Loop control**: Bug Fixer close-out records the Ads/Paid B-lite revisit decision and a TERMINATE/CONTINUE verdict for the program.

---

## 4. Recommended sub-phase split

Following the established cadence (1.5 gate → 2A/2B → 3A/3B → 4.0/4A/4B): **one blocking gate → backend → frontend → QC/QA gate**, with live adapters + optional PDF as a flagged tail.

| Sub-phase | Name | Blocking? | Rationale |
|-----------|------|-----------|-----------|
| **5.0** | Schema & Contract Gate | **Yes — blocks 5A** | Additive schema (manual-external fields, publishMethod enum, export audit actions), v2 constants + engine-select flag, override read-model shape, `RANKED_PLATFORMS` append order, cadence-target seed for tiktok/line_oa. System Analyst export-PII + TikTok/LINE data-handling sign-off. Cheap now, expensive to retrofit (the `content.media_url` lesson). |
| **5A** | Backend | after 5.0 | Adapters + registry, manual-record path, ranking v2 + override factor (v1 frozen), export (CSV; PDF tail), all with audit/step-up parity. |
| **5B** | Frontend | after 5A contract frozen | 4-platform publish + manual-record UI, v2 reasoning + engine badge, revenue drill-down, export buttons, override-log view. |
| **5C** | Live adapters + PDF (flagged) | non-blocking tail | Live TikTok/LINE (+FB/YT) paths behind flags, unverified; PDF export if not landed in 5A.7. Ships disabled/optional; does not gate exit 1–8. |

App Designer receives 5.0 + 5A/5B scope together to produce adapter/manual-record UX, the v2 reasoning panel, revenue drill-down, and export UX before code starts.

---

## 5. Work Breakdown Structure (WBS)

Effort in T-shirt sizes (S/M/L), dependency-ordered (no calendar dates until UAT, per `bussiness_rule.md`).

### Phase 5.0 — Schema & Contract Gate  [gate]
| ID | Work package | Size | Acceptance criteria |
|----|--------------|------|---------------------|
| 5.0.1 | Add `Post.externalPostUrl` (nullable) + `Post.publishMethod` enum (`adapter`/`manual_external`, default `adapter`, additive) to distinguish manually-recorded posts. Legacy rows valid (default `adapter`). | S | Migration applies clean on real Postgres; additive-only; no rename. |
| 5.0.2 | Confirm **no platform-enum + no platform-map migration** needed (both enums + bridge already cover 4 platforms — verified). Document this in the migration note. | S | Written confirmation; contract spec references all 4. |
| 5.0.3 | v2 constants: `FACTOR_WEIGHTS_V2` (sum=1.0, unit-tested), `RANKED_PLATFORMS` **appended** to 4 (order preserved), `override_feedback` factor name + `input` shape, min-sample threshold + normalizer. `RANKING_ENGINE` env flag (Joi default `v1`). | M | Weights sum test passes; v1 constants untouched; flag defaults v1. |
| 5.0.4 | Extend `AuditAction` union: `manual_external_post_recorded`, `report_exported`, `ranking_v2_recomputed` (or reuse `ranking_recomputed` + engineVersion meta). | S | Typed union compiles; each new mutating/export path has an action. |
| 5.0.5 | Seed `platform_cadence_targets` + `pillar_ratio_policies` coverage for tiktok/line_oa (provisional, `is_provisional=true`) so cadence/pillar factors aren't forced neutral for the new platforms. | S | Seed idempotent; ranking v2 reads non-neutral cadence for all 4. |
| 5.0.6 | Export-PII + TikTok/LINE data-handling policy doc: comment export aggregate-only, redaction rule, audit-no-PII, manual-external-id provenance. Locked with System Analyst. | M | Signed policy in `docs/`; feeds 5A.6 + the compliance gate. |

**5.0 exit**: migration verified on real Postgres, seed idempotency verified, System Analyst approves export-PII + data-handling design, v2 constants compile with v1 frozen.

### Phase 5A — Backend
| ID | Work package | Size | Acceptance criteria |
|----|--------------|------|---------------------|
| 5A.1 | `TikTokAdapter` + `LineAdapter` implementing `PlatformAdapter` (publish/fetchMetrics/fetchComments/replyComment), **mock default**, gated by `PUBLISHER_IMPL_TIKTOK`/`PUBLISHER_IMPL_LINE`. Register both in `PlatformAdapterRegistry`. Live paths stubbed-but-flagged (reject cleanly if enabled without creds). | L | Registry returns adapters for tiktok/line_oa; mock deterministic; `accessToken:null` rejected faithfully in mock. |
| 5A.2 | Update `platform-adapter.contract.spec` — all 4 adapters pass the contract; remove/retarget the "throws for unimplemented platform (Phase 5 scope)" assertion. | M | Contract green for 4 platforms; closes System Analyst "contract tests gate Phase 5" condition. |
| 5A.3 | Manual-external-post path: `POST /api/posts/:id/record-external` (or extend the `posted_unconfirmed` resolve) → sets `externalPostId`, `externalPostUrl`, `publishMethod=manual_external`, status `posted`. **Admin + CSRF + step-up + audit** (`manual_external_post_recorded`); server-side `was_override` recompute still applies. Idempotent under the active-publish partial-unique index. | L | Records post; metrics + comments can attach; audit written; idempotency respected; step-up enforced. |
| 5A.4 | Ranking **v2** engine (`RankingEngineV2Service` + v2 factors): revenue-blended `engagement_history`, new `override_feedback` factor, 4-platform coverage, `FACTOR_WEIGHTS_V2`, writes `engineVersion=v2`. Selected by `RANKING_ENGINE` flag; **v1 service/factors/constants untouched**. Shares `pickRecommendedScore`. | L | v2 produces 5-factor reasoning summing to total; v1 tests all still pass; flag switches engines. |
| 5A.5 | `override_feedback` factor service + read model over `Post.wasOverride/recommendedPlatform/selectedPlatform` (lookback window, min-sample neutral). Raw counts in `input` jsonb. | M | Deterministic; neutral below threshold; seeded override history moves the value; counts present for UI/audit. |
| 5A.6 | Export service — **CSV**: revenue-by-content/platform/period (drill-down), override-log, comment-summary (**aggregate-only, redacted**). Endpoints `GET /api/reports/*.csv`, admin+CSRF, audit `report_exported` (no PII). | L | CSVs download; comment CSV has zero raw author/text; audit rows written; filters (period/platform/content) honored. |
| 5A.7 | Export **PDF** via `pdfkit` (same 3 reports). *May defer to 5C if schedule tightens.* | M | PDFs render server-side; no headless-browser dependency; same redaction as CSV. |
| 5A.8 | Revenue drill-down read API: `GET /api/dashboard/revenue?contentId=...` per-content/platform/period breakdown (extends DashboardModule read-model). | M | Drill-down totals match latest-per-post semantics; pure aggregation. |

### Phase 5B — Frontend
| ID | Work package | Size | Acceptance criteria |
|----|--------------|------|---------------------|
| 5B.1 | Publish flow: TikTok + LINE selectable; `PublishConfirmModal` shows 4-platform ranking + recommended; **manual-external-record modal** (enter external id + URL, step-up) reusing the `posted_unconfirmed` "Mark posted" UX. | L | 4 platforms rankable/selectable; manual-record works live; step-up enforced; override reason required when selected ≠ recommended. |
| 5B.2 | Ranking v2 reasoning UI: `ScoreReasoning` renders 5 factors incl. `override_feedback` (counts), **engine-version badge** (v1/v2), PROVISIONAL badge honored for provisional cadence/pillar rows. | M | 5-factor breakdown renders; override factor human-readable; engine badge correct. |
| 5B.3 | Revenue **drill-down** per content in `/dashboard` (expand content → per-platform/period). | M | Drill-down matches 5A.8 API; empty/loading states. |
| 5B.4 | Export buttons (CSV; PDF if 5A.7 landed) on `/dashboard` + a **override-log view** (recommended vs selected + reason). | M | Downloads trigger; override-log renders; disabled states while empty. |
| 5B.5 | Nav/labels + client-logic unit tests (publish-logic 4-platform, export-enable), jest. | S | jest green; `next build` passes. |

### Phase 5C — Live adapters + PDF (flagged tail, non-blocking)
| ID | Work package | Size | Acceptance criteria |
|----|--------------|------|---------------------|
| 5C.1 | Wire live TikTok Content Posting API / LINE Messaging API (broadcast) paths behind `PUBLISHER_IMPL_*=live`; ships disabled + unverified (no creds). | L | Enabling without creds fails cleanly + audited; mock stays default; documented as unverified (mirrors FB/YT). |
| 5C.2 | PDF export if not delivered in 5A.7. | M | Same acceptance as 5A.7. |

---

## 6. Dependency order (critical path)

```
5.0 (schema + v2 constants + export-PII gate)  ──▶  5A  ──▶  5B
        │  (System Analyst sign-off)                 │
        │                                            ├─ 5A.1 adapters ─▶ 5A.2 contract spec
        │                                            ├─ 5A.3 manual-record (needs 5.0.1 fields + audit)
        │                                            ├─ 5A.4 ranking v2 ─▶ needs 5A.5 override factor
        │                                            │        (5A.4 also needs 5.0.5 cadence seed)
        │                                            ├─ 5A.6 export CSV (needs 5.0.6 PII policy)  ─▶ 5A.7 PDF
        │                                            └─ 5A.8 revenue drill-down API
        ▼
  Compliance gate (export-PII + data-handling) ─────────────────────▶ Phase 5 exit ─▶ Ads B-lite revisit + loop verdict
                                                     5C (flagged, non-blocking)
```

- **Hard blocker**: 5.0 (schema + export-PII policy + v2 constants with v1 frozen) before any 5A code — manual-record and export both write audit rows that must be PII-safe first, and v2 must not touch v1 constants.
- **API contract freeze**: 5A.1/5A.3 (publish + manual-record shapes), 5A.4 (v2 reasoning shape), 5A.6/5A.8 (export + drill-down) frozen before 5B — exactly as Phase 2 froze the Post contract for Pass C.
- 5A.4 depends on 5A.5 (override factor is an input to the v2 engine). 5A.6 (export) can proceed in parallel with the ranking track.

---

## 7. Risk Register

Probability (P) × Impact (I), 1–5. Score = P×I. Owner in parentheses.

| ID | Risk | P | I | Score | Mitigation | Owner |
|----|------|---|---|-------|-----------|-------|
| R1 | **Ranking v2 regression** — new weights/factor/4-platform list flip existing recommendations or break v1 tie-break (BUG-QA-003 class). | 4 | 4 | 16 | v1 service/factors/constants **byte-frozen**; v2 in a separate service; `RANKED_PLATFORMS` **appended not reordered**; `RANKING_ENGINE` flag default v1; golden test: v2-on-legacy-FB/YT-empty == v1 recommendation; flip to v2 only at QC/QA gate. Exit criterion #5. | App Developer / QA |
| R2 | **TikTok/LINE live path untestable** — no creds; TikTok needs audited app, LINE is broadcast-not-post. | 5 | 2 | 10 | Decision 1: mock-first + manual-record is the delivered path; live is flagged/unverified (5C), same posture as mock-only FB/YT. Not an exit gate. Documented as known limitation. | PM / App Developer |
| R3 | **Export PII leak** — comment text/author lands in a CSV/PDF and leaves the system (PDPA breach). | 3 | 5 | 15 | Comment export **aggregate-only**; any per-comment path routes through `redact-comment-meta.util`; audit meta carries no PII; System Analyst sign-off is exit criterion #8; explicit test asserts zero raw author/text in export bytes. | System Analyst / QA |
| R4 | **Override-feedback overfitting** — sparse single-admin history swings scores unfairly or encodes one bad call. | 3 | 3 | 9 | Min-sample neutral threshold; bounded normalizer (factor can't dominate); weight capped at 0.20; raw counts shown in reasoning so any swing is auditable/reversible; advisory only (admin still overrides). | App Developer |
| R5 | **Manual-external-post integrity** — admin records a wrong/duplicate external id; metrics/comments attach to the wrong post. | 3 | 3 | 9 | Reuse the active-publish partial-unique index (one active intent per content×platform); step-up + audit on record; URL captured for cross-check; editable/reopenable like `posted_unconfirmed`. | App Developer |
| R6 | **Contract-spec gap** — removing the "throws for unimplemented platform" assertion drops coverage that caught mis-registration. | 2 | 3 | 6 | Retarget (don't just delete) the assertion: contract now asserts all 4 adapters conform + registry returns each; add a negative test for a genuinely-unknown enum value. | QA |
| R7 | **PDF dependency risk** — `pdfkit` adds a dependency + container weight; scope slip. | 2 | 2 | 4 | CSV is the must-have exit path; PDF is should-have and demotable to 5C; `pdfkit` chosen specifically to avoid a headless-Chromium footprint. | PM |
| R8 | **Token/env drift for any live verification** — recurring `APP_ENCRYPTION_KEY` / `PUBLISHER_IMPL_*` / `SENTIMENT_IMPL` discoverability drift (P2/P3/P4-OBS-1). | 4 | 2 | 8 | Mock defaults cover CI/demo; document the new `PUBLISHER_IMPL_TIKTOK/LINE` flags in `.env.docker.example` + compose (closes the P4 discoverability carry-forward); pursue the "single `.env` source of truth" tech-debt task. | DevOps |
| R9 | **Scope creep** — pressure to make TikTok/LINE truly live, or to auto-publish, or add ML to ranking. | 2 | 4 | 8 | Boundaries in §3.2; Publish Authority + "no black-box ML" cited; live = 5C flagged tail; Ads stays B-lite. | PM |

### 7.1 Carry-forward register (inherited, non-blocking)
| Item | Source | Disposition in Phase 5 |
|------|--------|------------------------|
| **Cron auto-sync** (metrics + comments) still manual | Phase 3.5 defer / Phase 4 §3.3 | Stays deferred; Phase 5 keeps manual Sync buttons. Bundled with the `getValidToken` system-context fix — a DevOps follow-up, not Phase 5 scope. |
| **QC-4B 3 UX-minors** | Phase 4B QC review | Fold into 5B polish where the same components are touched; else carry to Phase 6 backlog. |
| **QA-OBS-2** — `TargetAgeSegment` enum exceeds `bussiness_rule.md` sub-segments; docs sync | Phase 4 §3.4 | Docs-only sync during 5.0 gate documentation pass. |
| **401-as-ERROR log noise** | Phase 2 carry-forward | Downgrade to WARN when Prometheus/Grafana/Sentry stood up — DevOps, later phase. |
| **QA-OBS-1** — pillar/cadence idempotency app-layer only | Phase 4 §3.4 | 5.0.5 seeds new rows idempotently; consider a DB UNIQUE while touching those tables. |
| **Single `.env` source of truth** | P4-OBS-1 | Tech-debt task; add new `PUBLISHER_IMPL_TIKTOK/LINE` to example+compose (R8) as the minimum. |
| **Meta App Review submission** | ongoing admin action | Dev Mode still sufficient (own-Page); blocks real live verification only. Admin action. |

---

## 8. Resource / agent allocation

| Deliverable | Primary agent | Support |
|-------------|--------------|---------|
| Adapter + manual-record UX, v2 reasoning panel, revenue drill-down, export UX | App Designer | PM (scope constraints) |
| Export-PII + TikTok/LINE data-handling sign-off | System Analyst | PM (risk register) |
| 5.0 schema, 5A backend (adapters, v2, override, export), 5B frontend, 5C tail | App Developer | — |
| Coding-standard + tree-hygiene review | Quality Control | — |
| Behavioral tests (v2 no-regression, export-PII, manual-record integrity, contract) | QA Tester | — |
| `.env`-drift/discoverability + cron system-context follow-up | DevOps | — |
| Loop close-out + Ads B-lite revisit decision | Bug Fixer → PM | — |

---

## 9. Open decisions for downstream agents

1. **Manual-record vs `posted_unconfirmed` reuse** (App Designer/Developer): extend the existing "Mark posted" resolve endpoint, or a dedicated `record-external` endpoint? Recommend a **dedicated endpoint** so `publishMethod=manual_external` and provenance are explicit (posted_unconfirmed is a failure-recovery semantic; conflating them muddies audit).
2. **v2 engagement blend ratio** (App Developer + admin): engagement:revenue mix inside `engagement_history` (e.g. 50/50). Ship a sensible default, tune at UAT — same provisional pattern as pillar-ratio/cadence.
3. **Override lookback window + min-sample + normalizer** (System Analyst + admin): default provisional (e.g. 90 days / ≥5 decisions), tune with real data.
4. **v2 default flip timing** (PM/QA): keep `RANKING_ENGINE=v1` through 5A/5B; flip to `v2` only after QA verifies exit #3–#5 live.
5. **PDF in 5A.7 or 5C** (PM): land in 5A.7 if schedule holds; otherwise CSV satisfies exit #6 and PDF drops to 5C.
6. **Cadence/pillar targets for TikTok/LINE** (admin): provisional values needed for 5.0.5 seed (FB 7/wk, YT 3/wk are confirmed; TikTok/LINE cadence was explicitly deferred "จะกำหนดเมื่อเข้า Phase 5" in `bussiness_rule.md`) — **admin input now due**.

---

## 10. Consistency check against existing docs
- Implements `makedown.md` §5 Phase 5 (all 4 bullets) and §9.5 row 5; closes System Analyst "PlatformAdapter contract tests (gate Phase 5)".
- Honors every fixed business rule: no auto-publish (manual-record still admin-confirmed + step-up), organic-only (no paid signal in v2), explainable ranking (v2 is a transparent weighted rule set with override counts in reasoning), revenue-manual for TikTok/LINE.
- Reuses every established pattern: `PUBLISHER_IMPL_*` mock/live gating, `PlatformAdapterRegistry` extension seam, append-only metrics, per-post failure isolation, admin+CSRF+step-up, central `AuditLogService` typed union, `platform-map.util` bridge (unchanged — already 4-platform), DashboardModule read-model, `EngineVersion` enum (already `v1|v2`), the gate→backend→frontend cadence.
- **Additive-only** schema (new nullable `Post` fields + `publishMethod` enum default); v1 ranking code frozen; no platform-enum or platform-map migration (both already cover 4 platforms — verified in code).

---

## Handoff summary (for App Designer / Developer building next)
- **TikTok/LINE = mock adapters + manual-external-post record path, NOT a live integration.** Implement `TikTokAdapter`/`LineAdapter` (mock default, `PUBLISHER_IMPL_TIKTOK/LINE` flags), register them in `PlatformAdapterRegistry` (the Map that throws today), and build a manual-record flow (`external_post_id` + URL, `publishMethod=manual_external`, step-up + audit) reusing the Phase 2 `posted_unconfirmed` "Mark posted" UX. No platform-enum or `platform-map.util` migration — both already cover 4 platforms.
- **Ranking v2 = new `RankingEngineV2Service`, v1 frozen.** Keep `RankingEngineService`/`RankingFactorsService`/`ranking.constants.ts` untouched; add `FACTOR_WEIGHTS_V2` (sum 1.0), **append** tiktok/line_oa to `RANKED_PLATFORMS` (never reorder), select via `RANKING_ENGINE` flag (default v1), persist `engineVersion=v2`. v2 changes: revenue-blend the engagement factor + add the override factor.
- **Override feedback = a new explainable factor** over `Post.wasOverride/recommendedPlatform/selectedPlatform`; put raw counts in the `reasoning.input` jsonb (down-weight repeatedly-overridden pillar→platform, neutral below a min-sample threshold). Must render in the UI.
- **Export = CSV first (must-have, no dep), PDF second (`pdfkit`, should-have).** Three reports: revenue drill-down, override log, comment summary (**aggregate-only, zero raw author/text**). Audit every export, no PII in audit meta; System Analyst signs off PII handling at the 5.0 gate.
- **Sequence = 5.0 gate → 5A backend (freeze contract) → 5B frontend → QC/QA gate → 5C flagged tail.** Watch the top risks: v2 regression (R1 — golden test + flag), export PII (R3 — gate + byte-level test). Phase 5 is the final planned phase: its close-out records the Ads/Paid B-lite revisit decision and the loop TERMINATE/CONTINUE verdict.
```

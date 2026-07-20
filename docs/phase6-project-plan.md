# Phase 6 — Commerce / Affiliate · Project Plan

- **Author**: Senior Project Manager (Loop Engineering entry point, position #1)
- **Date**: 2026-07-20
- **Iteration input**: Phase 5 close-out (`docs/phase5-bugfix-feedback.md`, verdict CONTINUE) + Phase 5D consolidation (BUG-P5-02 fixed, audit trail persisted, first visual QA pass, `RANKING_ENGINE=v2` enabled 2026-07-20). Baseline on `main`: **406 backend + 92 frontend tests**, 9 migrations, 4/4 containers healthy.
- **Depends on**: Phase 2 (adapters/registry, step-up + CSRF + AdminGuard, `was_override` recompute, active-publish partial-unique index), Phase 3 (append-only `Metric`, Dashboard read-model), Phase 4 (PDPA controls, redaction), Phase 5 (manual-external-record path, CSV export, `PublishMethod` enum), Phase 5D (durable `audit_logs`, engine-scoped score reads).
- **Downstream handoff**: App Designer (catalog UX, anchor picker, commerce dashboard **separation** design, conversion entry) → System Analyst (PDPA/no-buyer-data gate, commerce/payout separation sign-off) → App Developer.
- **Status doc alignment**: implements the new `bussiness_rule.md` §"Commerce / Affiliate" (decided 2026-07-20). This is the first phase **beyond** the originally committed Phase 1–5 program; `makedown.md` §9.5 lists Phase 6 as an uncommitted "Optimization Backlog" row — this plan supersedes that row's contents for Phase 6.
- **Note — posture**: this phase is delivered under **zero API access** (no Shopee KAM, no TikTok Shop Creator Affiliate). The delivered path is **mock adapter + manual record**, exactly as Phase 5 delivered TikTok/LINE. That is not a compromise position taken reluctantly; it is the same posture that has produced every shipped, QA-signed integration in this program.

---

## 1. Project Charter

### 1.1 Objective

Add a **commerce/affiliate capability** to Content Hub — Shopee video placement, affiliate product catalog + links, product-anchor ("ปักตะกร้า") tracking on TikTok and Shopee, and commission/conversion recording — **as a structurally separate stream from the existing platform-payout revenue model**, without touching the revenue definition, without making the ranking engine commerce-aware, and without adding a fifth value to the platform enums.

### 1.2 Success statement

> Admin can maintain a product catalog with affiliate links, record which products were anchored to which post (TikTok) or Shopee video placement, and enter commission/conversion figures from platform payout statements — and see all of it in a **visibly separate** dashboard section and a **separate** CSV export, where a commerce total and a payout total are never added together anywhere in the system. Ranking v2 recommendations are **byte-identical** before and after commerce data exists. No buyer personal data ever enters the database.

### 1.3 Constraints fixed by the admin decision of 2026-07-20 (do NOT re-litigate)

| # | Constraint | Consequence for this plan |
|---|-----------|---------------------------|
| **C-A** | **Revenue model is not amended.** `Revenue = platform monetization payout only, NOT affiliate` stands exactly as written in `bussiness_rule.md`. | Commerce data must live outside the `Metric` stream entirely. No `metric.revenue` semantics change, no discriminator column on `metrics`. See Decision 1. |
| **C-B** | **Dashboard shows them as separate sections; totals must never be summed.** | Separation must be enforced *structurally* (schema + query boundary + regression test), not by convention or by a comment. See Decision 1. |
| **C-C** | **The ranking engine does NOT consume commerce signal.** v1/v2 keep payout + engagement + override feedback only. | `RANKED_PLATFORMS_V2`, `FACTOR_WEIGHTS_V2`, `RankingFactorsV2Service`, and `ranking-v2.constants.ts` are **frozen for this phase**. Zero commerce reads from the ranking module. Exit criterion #6 is a byte-level proof of this. |
| **C-D** | **No API access exists today** — not a Shopee managed seller (no KAM), not a TikTok Shop Creator Affiliate. | Mock adapter + manual record is the **delivered** path. Live paths are specified but **not built** this phase (see Decision 5 / §4 on 6D and the Bug Fixer's standing recommendation against unverifiable live code). |
| **C-E** | Publish is never automatic; admin confirms every action; copyright gate applies to manually-recorded posts. | Every commerce write path carries AdminGuard + CSRF + audit; the Shopee placement path carries **step-up + copyright gate**, exactly as `POST /api/posts/manual-external` does. |
| **C-F** | Enum migrations are **additive-only and irreversible** (schema header rule, System Analyst decision #9). | Any enum value added this phase can never be removed. This is the single strongest argument in Decision 2 against putting `shopee` into `Platform`/`AssetPlatform`. |
| **C-G** | Shopee video must be **10–60 seconds** (known platform constraint). | Duration is a new dimension the system does not currently model — uploads validate magic bytes + size only. See Decision 3. |

---

## 2. Explicit decisions (the real unknowns, resolved)

### Decision 1 — Domain model → **four new tables in a new `commerce` namespace; commission records in their own append-only table, NOT a discriminator on `metrics`**

#### 1.1 What exists today, and what does not

The schema has **no product, SKU, commission, affiliate-link, or conversion concept anywhere**. `Content.contentPillar` (`product|drama|comedy`) is a *content category* used by the pillar-ratio policy and the ranking `pillar_alignment` factor — it is not a catalog and must not be repurposed as one. Confirmed by reading `backend/prisma/schema.prisma` end to end.

#### 1.2 Recommended entities

| Entity | Grain | Relationship to existing model |
|--------|-------|-------------------------------|
| **`CommerceProduct`** | One row per sellable product the admin promotes | **No FK to `Content`.** A product is promoted across many contents; a content promotes many products. Linking them directly would be wrong at both ends. |
| **`AffiliateLink`** | One row per (product × channel × tracking code) | FK → `CommerceProduct`. Separate table, not a column on the product, because one product accumulates several tracking links over time and a conversion record must attribute to the *link that earned it*. |
| **`ProductAnchor`** | One row per (post-or-placement × product) — "this product was ปักตะกร้า on this video" | FK → `Post` **or** `CommercePlacement` (exactly one, enforced by a CHECK), plus FK → `CommerceProduct` and optional FK → `AffiliateLink`. |
| **`CommercePlacement`** | One row per Shopee video placement | FK → `Content`. **A parallel to `Post`, not a `Post` row.** See Decision 2. |
| **`CommerceConversion`** | One row per commission/conversion figure entered, per period | Optional FKs → `Post` / `CommercePlacement` / `CommerceProduct` / `AffiliateLink`, all nullable. **Append-only.** |

`ProductAnchor` anchors to **`Post`**, not to `Content` — deliberately. The same content posted to TikTok and to Shopee may pin different products, and `Post` is already the grain that `Metric` and `Comment` hang off. Anchoring at the `Content` level would lose which video actually carried which product, which is the entire point of the feature.

#### 1.3 The load-bearing decision: **separate table, not a discriminator on `metrics`**

Recommendation: **`commerce_conversions` is its own table.** Do **not** add `metric.stream = payout | commerce` or `metric.revenueType`.

Reasoning, in order of weight:

1. **A discriminator makes correctness opt-in across every existing reader; a separate table makes visibility opt-in.** `metrics` is read today by `DashboardService` (`/overview`, `/revenue`, `/revenue/:contentId`), `ReportExportService` (revenue CSV), `MetricIngestionService`, and — decisively — **`RankingFactorsV2Service`, whose `engagement_history` factor blends `metric.revenue` into the score**. Every one of those was written when `metrics` had exactly one meaning. Adding a discriminator means all of them are *silently wrong* from the moment the first commerce row lands, and stay wrong until someone remembers to add a `WHERE stream = 'payout'`. Six call sites that must each be individually fixed to preserve an invariant is not an invariant — it is six chances to breach C-A, C-B, and C-C at once.
2. **C-C would be violated invisibly.** Ranking v2 was enabled two days ago and already flipped a live recommendation (comedy: Facebook → TikTok). If commission rows enter `metrics`, ranking becomes commerce-aware *by accident* — no code change, no review, no test failure. The locked decision says making ranking commerce-aware is "a separate future decision"; a discriminator would make it an unreviewed present accident.
3. **The grains genuinely differ.** `Metric` is a point-in-time snapshot per post (`reach`/`engagement`/`revenue` at `collectedAt`). A commission record is a **period accrual** (`periodStart`..`periodEnd`) that arrives weeks after the sale, can be **reversed** (refunds, cancelled orders → negative amounts), and often has **no attributable post at all** (a Shopee Affiliate statement line that just says "commission, week 29"). Forcing both into one row shape means nullable columns on both sides and a table where half the columns are meaningless for half the rows.
4. **Rollback.** The admin's own stated rationale for keeping the streams apart is that "blending them is hard to roll back." Dropping a new table is clean. Unwinding discriminator rows out of an **append-only** table that ranking has already consumed and persisted scores from is not — you would have to re-rank everything and could not tell which historical scores were contaminated.

**Structural guards that ship with this** (these are the deliverable, not commentary):
- `commerce_conversions` has **no FK to `Metric`** and the commerce module has **no import of `MetricsModule`**.
- A **boundary test**: a static assertion that no file under `modules/metrics/`, `modules/dashboard/`, `modules/reports/` (payout paths), or `modules/ranking/` references any commerce table or the `CommerceModule`.
- A **behavioural test**: seed commerce conversions, then assert `GET /api/dashboard/overview`, `/revenue`, `/revenue/:contentId`, the revenue CSV bytes, and every persisted `ranking_scores.score` are **byte-identical** to the same fixture with zero commerce rows. This is exit criterion #6 and the single most important test in the phase.

#### 1.4 Field-level: manual-entry vs API-sourced

Every table carries `source: manual | api` (mirroring `MetricSource`, an established, QA-signed pattern) so that when access is eventually granted, API-sourced rows are distinguishable from hand-entered ones without a migration.

**`CommerceProduct`**
| Field | v1 source | Notes |
|-------|-----------|-------|
| `channel` (`CommerceChannel`) | manual | `shopee` \| `tiktok_shop` |
| `externalProductId` | manual | Shopee `item_id` / TikTok Shop product id, as typed by the admin |
| `name`, `sku` | manual | API-sourced later via Shopee Affiliate Open API / TikTok Affiliate Creator API |
| `productUrl` | manual | |
| `listPrice`, `currency` | manual | `Decimal(12,2)`; nullable — price drifts, and a stale price is worse than no price |
| `commissionRatePct` | manual | `Decimal(5,2)`; **indicative only**, never used to *compute* earnings — actual commission is always the entered `CommerceConversion.commissionAmount` from the statement |
| `isActive` | manual | soft-retire; never hard-delete (audit) |
| `source` | `manual` | |

**`AffiliateLink`**: `productId`, `channel`, `url`, `trackingCode`/`subId`, `isActive`, `source` — all manual in v1.

**`ProductAnchor`**: `postId?` / `placementId?` (exactly one), `productId`, `affiliateLinkId?`, `anchorPosition?` (Int, nullable — ordering in the basket UI), `anchoredAt`, `recordedBy`, `source`. Unique on `(postId, productId)` and `(placementId, productId)`.

**`CommerceConversion`** (append-only)
| Field | v1 source | Notes |
|-------|-----------|-------|
| `channel` | manual | |
| `periodStart`, `periodEnd` | manual | Date range the statement covers |
| `ordersCount`, `itemsSold` | manual | Int; **aggregate counts only** |
| `grossSalesAmount` | manual | `Decimal(12,2)`, nullable |
| `commissionAmount` | manual | `Decimal(12,2)`. **May be negative** — refunds/reversals are new rows, not edits (append-only) |
| `currency` | manual | default `THB` |
| `postId?`, `placementId?`, `productId?`, `affiliateLinkId?` | manual | all nullable — unattributed statement lines are a normal, expected case |
| `statementRef?` | manual | free-text payout-statement reference for human reconciliation |
| `source`, `recordedBy`, `createdAt` | server | |

**PDPA hard rule, enforced at schema-design time:** there is **no column anywhere** for buyer name, buyer id, order id, address, phone, email, or any per-transaction identifier. Commerce data in this system is **aggregate counts and amounts only**. This is not a policy to be remembered — it is the absence of a place to put the data. Reviewed and signed off by the System Analyst at the 6.0 gate.

---

### Decision 2 — Shopee as a platform → **NOT a fifth enum value. A separate `CommerceChannel` enum + a parallel `CommercePlacement` record + a parallel `CommerceAdapterRegistry`**

#### 2.1 The two sub-cases are not the same problem

- **Product anchor on TikTok** is **not a new platform at all.** Anchoring products to a TikTok video means the post already exists as `Post{platform: tiktok}`. The feature is purely additive: `ProductAnchor` rows pointing at an existing `Post`. **Zero enum change, zero registry change, zero ranking impact.**
- **Shopee video upload** *is* a new destination with its own external media id — this is the case that needs a decision.

#### 2.2 Options weighed for Shopee

**(A) Add `shopee` to both `Platform` and `AssetPlatform`.** Rejected. `AssetPlatform` is not merely a labelling enum — it is the **ranking domain**. `PLATFORM_TIE_BREAK_ORDER: readonly AssetPlatform[]` and `RANKED_PLATFORMS_V2 = PLATFORM_TIE_BREAK_ORDER`, so adding a value here **immediately enrols Shopee into the v2 scoring set** — directly violating C-C, and doing it in the engine that was enabled two days ago. It would additionally demand: a `platform_cadence_targets` row (a cadence number nobody has decided), a `pillar_ratio_policies` position, a fifth scheduler cadence card, a `platform-map.util` counterpart, entries in every label map, and a decision about comment sync. Per C-F this is **irreversible**.

**(B) Add `shopee` to `Platform` only.** Rejected on a concrete type-safety ground: `POST_TO_ASSET_PLATFORM` is typed `Record<Platform, AssetPlatform>` and is *total*. Adding a `Platform` value with no `AssetPlatform` counterpart forces that map to become partial or to fabricate a mapping. `platform-map.util` already produced a real bug in Phase 5 (the cast→map fix); weakening its totality guarantee to save one enum value is a bad trade.

**(C) A separate `CommerceChannel` enum + a parallel `CommercePlacement` table. — RECOMMENDED.**

```prisma
enum CommerceChannel {
  shopee
  tiktok_shop
}
```

This is not a novel pattern in this codebase — it is **the pattern this codebase already chose once and documented**. `AssetPlatform` exists as a deliberate parallel to `Platform` precisely so "the two concerns don't get conflated" (schema comment, Phase 1.5). `CommerceChannel` is the same move for the same reason: commerce destinations are a different concern from social feeds, and merging them is the irreversible direction.

**What `CommercePlacement` is:** a Shopee video placement record with the same *shape* as `Post` (contentId, external media id, external url, status, `publishMethod: adapter | manual_external`, recordedBy, timestamps, version) but in **its own table**. Consequence: it never enters `/posts` listings, cadence counts, the ranking scoring set, or the payout dashboard — because none of those queries touch that table.

**Registry:** introduce a **`CommerceAdapterRegistry`**, parallel to `PlatformAdapterRegistry`, with its own interface:

```
CommerceAdapter {
  uploadVideo(args)      // Shopee MediaSpace: initiate → upload-by-part → complete
  getUploadStatus(args)  // transcoding status
  fetchProducts(args)    // catalog/commission discovery
  fetchConversions(args) // affiliate conversion reporting
}
```

Do **not** extend `PlatformAdapter`. Its four methods are `publish` / `fetchMetrics` / `fetchComments` / `replyComment`; Shopee has no comment inbox to reply into and produces no monetization payout metric. Forcing commerce through that interface means **two of four methods throw `NotImplemented` on every commerce adapter** — the kind of shape that later gets "fixed" by someone relaxing the contract spec.

Gating mirrors publish exactly: `COMMERCE_IMPL_SHOPEE` / `COMMERCE_IMPL_TIKTOK_SHOP` (`mock` default), boot refusal if a live impl is set outside `NODE_ENV=production`, documented in `.env.docker.example` + compose (closing the recurring discoverability papercut in the same pass).

#### 2.3 The honest cost of (C)

Two registries and some duplicated dispatch/gating code. That duplication is the price of not corrupting ranking, and it is cheap relative to an irreversible enum. **If commerce should ever become a ranked platform, that must be a deliberate, planned migration with its own decision record — not something that happens because an enum was convenient.**

---

### Decision 3 — The 10–60s constraint → **capture duration at upload (best-effort, never blocking), enforce fail-closed at the Shopee placement boundary only**

#### 3.1 Current state

`UploadValidationService` sniffs magic bytes (JPEG/PNG/MP4) and checks size. **It has no concept of duration**, and duration is not derivable from magic bytes — it requires parsing the MP4 container.

#### 3.2 Interaction with `content_assets`

`content_assets` models `(content_id, platform: AssetPlatform, aspect_ratio, media_url)`. It cannot represent a Shopee asset **without adding `shopee` to `AssetPlatform`**, which Decision 2 refuses. It also has no duration column. Therefore:

- Add **`durationSeconds Int?`** to `content_assets` (additive, nullable — every legacy row stays valid). Duration is a genuinely useful property of any video asset, not a Shopee-specific hack.
- `CommercePlacement` carries its **own** `mediaUrl` + `durationSeconds` (defaulted from a linked `ContentAsset` when the admin picks one, via a nullable `sourceAssetId`). The Shopee asset is thus representable without touching `AssetPlatform`.

#### 3.3 Three-layer enforcement

1. **Capture at upload — best-effort, never blocking.** Parse `durationSeconds` from the MP4 `mvhd` atom (timescale + duration) with a small pure-TypeScript reader — same spirit and same file as the existing magic-byte sniffer, **no `ffprobe`/`ffmpeg` binary**. That is the identical reasoning that chose `pdfkit` over headless Chromium in Phase 5: no binary in the container, smaller ops and attack surface. If the parse fails → `null`, **not an error**. Uploads for Facebook/YouTube/TikTok/LINE must not start failing because of a Shopee rule; that would be a regression on four working platforms to serve one that has no API access.
2. **Enforce at the Shopee placement boundary — fail closed.** `CommercePlacementService` rejects with **422** when `channel = shopee` and `durationSeconds` is `null` **or** outside `[10, 60]`. **Null is a rejection, not a pass** — matching `CopyrightGateService` and the `contentPillar = null` treatment, where "we don't know" is never allowed to widen what's permitted. The admin can supply the duration by hand to unblock, which is entirely consistent with this phase's manual posture.
3. **Warn in the browser before upload — courtesy only.** A client-side `HTMLVideoElement.duration` check gives immediate feedback, and is **never** the authority. Client-supplied values are re-derived or re-validated server-side, for the same reason `wasOverride` is always recomputed server-side.

The gate applies to **Shopee only**. TikTok anchoring attaches products to an already-published video, so no duration gate applies there.

---

### Decision 4 — Manual-record flow → **extend the existing `manual-external` pattern; one new sibling endpoint for placements, one for anchors, one for conversions. Do not invent a parallel publish mechanism.**

The existing `POST /api/posts/manual-external` already enforces: step-up re-auth, CSRF, AdminGuard, server-side `was_override`, active-duplicate 409, and the copyright gate. Its DTO comment explicitly documents *why* the body is kept minimal (recording a post must not become a back door for writing override facts the ranking engine later learns from). That constraint is respected below.

#### Flow A — TikTok video with products anchored (ปักตะกร้า)

1. Admin creates content and clears copyright in Content Hub (unchanged).
2. Admin adds the products to the catalog: `POST /api/commerce/products` (one-time per product — name, `externalProductId`, product URL, affiliate link, indicative commission rate).
3. Admin posts natively on TikTok, pinning products via the Showcase basket.
4. Admin records the post via the **existing, unchanged** `POST /api/posts/manual-external`.
5. Admin records the anchors: **`POST /api/posts/:id/product-anchors`** `{ productIds[], affiliateLinkIds?[] }`.

**Why step 5 is a separate endpoint, not extra fields on `RecordManualExternalDto`:** anchoring is not a publish act. It writes no override fact, pushes nothing live, and needs no step-up. Bolting an optional `productIds[]` onto the publish DTO makes the publish path carry commerce concerns and puts pressure on a body that is deliberately minimal. **Separate at the API seam, unified in the UX** — the frontend modal calls both in sequence so the admin experiences a single action (see 6B.2).

#### Flow B — Shopee video placement

1. Admin uploads the video to Shopee natively (Seller Centre) and pins products there.
2. **`POST /api/commerce/placements/manual-external`** — `{ contentId, channel: shopee, externalMediaId, externalUrl?, durationSeconds, password, note? }`.

   This mirrors `POST /api/posts/manual-external` **1:1**: AdminGuard + CSRF + **step-up** + **copyright gate** + **active-duplicate 409** (one active placement per content × channel, via a partial unique index on the same pattern as `posts_content_platform_active_key`) + audit.

   The copyright gate is mandatory here for exactly the reason `bussiness_rule.md` gives for the Phase 5 manual-external path: without it, "post natively, record later" becomes the universal copyright-gate bypass. The gate cannot block an already-live video; its value is the audit trail — which, since Phase 5D, is now genuinely durable in `audit_logs`.
3. Anchors: `POST /api/commerce/placements/:id/product-anchors`.

#### Flow C — Commission entry (the recurring path; this is where the money is recorded)

**`POST /api/commerce/conversions`** — append-only, mirroring `POST /api/posts/:id/metrics` in every respect: **no PATCH, no DELETE**. Corrections and refunds are **new rows** (negative `commissionAmount` permitted — an explicit, documented divergence from `Metric`, which has no reversal concept). Admin does this weekly or monthly from the Shopee Affiliate / TikTok Shop payout statement, entering aggregate figures per period, optionally attributed to a post/placement/product.

#### What is reused vs extended vs new

| | Items |
|---|---|
| **Reused unchanged** | `StepUpAuthService`, `AdminGuard`, CSRF guard, `CopyrightGateService`, `AuditLogService` + durable `audit_logs`, `redactSensitive`, the append-only no-PATCH/DELETE discipline, the active-row partial-unique-index idempotency pattern, the `PUBLISHER_IMPL_*` mock/live gating shape, the CSV export/streaming pattern |
| **Extended** | `AuditAction` union (new actions, §5 WBS 6.0.4); `content_assets` (+`durationSeconds`); `UploadValidationService` (best-effort duration capture); `.env.docker.example` + compose (new flags); nav + label maps |
| **New** | `CommerceModule` (catalog, links, anchors, placements, conversions), `CommerceAdapterRegistry` + mock Shopee/TikTok-Shop adapters, commerce dashboard read model, commerce CSV export, commerce frontend pages |

---

### Decision 5 — Live paths → **specified, NOT built this phase**

The Phase 5 close-out recommended explicitly against building 5C live adapters without credentials: *"without credentials the code cannot be verified, so building it produces unverifiable code that reads as capability."* That reasoning applies with full force here — and Phase 5's 5C was, correctly, never built.

**Recommendation:** 6D contains the **written integration specification** (Shopee MediaSpace `initiate_video_upload` → upload-by-part → `complete_video_upload` → query-status; TikTok Affiliate Creator API collaboration/showcase/conversion endpoints; `partner_id`/`partner_key` handling) and the **adapter interface stubs that reject cleanly when enabled without credentials** — but **no live HTTP implementation**. The interface stubs are required anyway so the registry has something to register; the spec is required so that the day access is granted, the work is a bounded implementation task rather than a research task. Building the request/response plumbing against an API nobody can call is where the line falls.

---

## 3. Scope

### 3.1 In scope

1. **Commerce domain model** — `CommerceProduct`, `AffiliateLink`, `ProductAnchor`, `CommercePlacement`, `CommerceConversion` (+ `CommerceChannel` enum, `content_assets.durationSeconds`), all additive.
2. **Product catalog + affiliate links** — admin CRUD, soft-retire, audited.
3. **Product anchors** — record which products were ปักตะกร้า on which TikTok post / Shopee placement.
4. **Shopee placement** — manual-external record path with step-up + copyright gate + duration gate + duplicate 409; mock `CommerceAdapter` behind `COMMERCE_IMPL_SHOPEE`.
5. **Commission/conversion recording** — append-only manual entry, reversals as negative rows.
6. **Commerce dashboard section + commerce CSV export** — visibly and structurally separate from payout; never summed with it.
7. **Separation guarantees** — boundary test + byte-identical payout/ranking regression test (the phase's defining deliverable).
8. Frontend for all of the above.

### 3.2 Out of scope — explicit "not this phase"

- **Any live Shopee or TikTok Shop API call** (C-D, Decision 5). Specification + rejecting stubs only.
- **Amending the revenue model** (C-A). `Revenue = payout` is untouched.
- **Making ranking commerce-aware** (C-C). Ranking module is frozen this phase.
- **Order management, inventory, fulfilment, shipping, payment processing, buyer CRM.** Content Hub is a content distribution system that *records* commerce outcomes. It is not a seller back-office, and the moment it holds order-level data it inherits a PDPA burden this project has spent four phases avoiding.
- **Any buyer-level or order-level data** (PDPA hard rule, Decision 1.4).
- **Automated commission reconciliation / statement file import** — manual entry only in v1; revisit when API access exists.
- **Commerce-driven scheduling or cadence targets** — no commerce cadence card, no commerce pillar ratio.
- **5C live social adapters + PDF export** — remain deferred (carry-forward, §7.1).
- **Ads/Paid** — still deferred; its evidence window (~8 weeks of real operation from 2026-07-20) has not elapsed.

### 3.3 Exit criteria (Phase 6 DONE when all true)

1. Migration applies clean on real Postgres; **additive-only**; `Platform` and `AssetPlatform` are **unchanged** (verified by diffing the enum blocks).
2. Admin can create/edit/retire products and affiliate links; all writes audited.
3. Admin can record product anchors against an existing TikTok `Post` and against a Shopee `CommercePlacement`; anchors are visible on the post/placement detail view.
4. Admin can record a Shopee placement via manual-external with step-up + copyright gate enforced, duplicate 409 on a second active placement for the same content × channel, and **422 when duration is null or outside 10–60s**.
5. Admin can append commission/conversion rows (including negative reversals); no PATCH/DELETE route exists; history is visible.
6. **The separation proof** — with commerce data seeded: `GET /api/dashboard/overview`, `/revenue`, `/revenue/:contentId`, the revenue CSV **bytes**, and every persisted `ranking_scores.score` are **byte-identical** to the zero-commerce fixture. Plus the static boundary test: no payout/ranking module imports or references any commerce table.
7. Commerce dashboard section renders **visually separated** with explicit copy stating it is **not** included in payout revenue; commerce CSV is a **separate file** with no payout column.
8. **Zero buyer-PII columns** exist in the commerce schema — System Analyst signs off the PDPA/no-buyer-data design at the 6.0 gate and re-verifies against the shipped migration.
9. Backend suite green (target +60–85 over the 406 baseline), lint zero-warning, typecheck clean; frontend jest green + `next build` passes.
10. **Visual QA pass with browser tools is a first-class deliverable** (6C) — every new page and modal, all three widths, console clean. Phase 5D established this; it is not substitutable by API-contract testing.
11. Access-gate status recorded: Shopee KAM and TikTok Creator Affiliate remain **admin action items**, explicitly listed as blocking any live work.

---

## 4. Recommended sub-phase split

Following the established cadence (1.5 gate → 2A/2B → 3A/3B → 4.0/4A/4B → 5.0/5A/5B/5C):

| Sub-phase | Name | Blocking? | Entry criteria | Exit criteria |
|-----------|------|-----------|----------------|---------------|
| **6.0** | Schema & Separation Gate | **Yes — blocks 6A** | Phase 5D closed, v2 enabled and stable; this plan accepted | Migration verified on real Postgres; `Platform`/`AssetPlatform` diff empty; separation-test *design* agreed; **System Analyst signs off PDPA no-buyer-data + commerce/payout separation**; audit actions + env flags defined |
| **6A** | Backend | after 6.0 sign-off | 6.0 exit met | Catalog/links/anchors/placements/conversions endpoints live with full guard parity; mock commerce adapters registered; commerce read model + CSV; **exit criteria #2–#6 green**; API contract frozen |
| **6B** | Frontend | after 6A contract freeze | 6A contract frozen | Catalog UI, anchor picker (unified UX over the two API calls), placement record modal, conversion entry, **separated** commerce dashboard section + export; jest green, `next build` passes |
| **6C** | QC / QA / Visual gate | **Yes — blocks exit** | 6A + 6B merged | QC APPROVED; QA signed off zero Critical/High; **visual QA pass performed with browser tools** (exit #10); System Analyst re-verifies #8 against shipped code |
| **6D** | Live integration spec + rejecting stubs (flagged tail) | non-blocking | — | Written spec in `docs/`; stubs reject cleanly when enabled without credentials; **no live HTTP client built** (Decision 5) |

App Designer receives 6.0 + 6A/6B scope together, and must produce the **commerce/payout dashboard separation design** before code starts — that is the highest-risk UX surface in the phase (R1).

---

## 5. Work Breakdown Structure (WBS)

Effort in T-shirt sizes (S/M/L), dependency-ordered — no calendar dates until UAT, per `bussiness_rule.md`.

### Phase 6.0 — Schema & Separation Gate  [gate]

| ID | Work package | Size | Acceptance criteria |
|----|--------------|------|---------------------|
| 6.0.1 | `CommerceChannel` enum (`shopee`, `tiktok_shop`). **No change to `Platform` / `AssetPlatform`** — documented in the migration note with the Decision 2 rationale. | S | Enum diff on the two existing platform enums is empty; migration comment cites the irreversibility rule. |
| 6.0.2 | Tables: `commerce_products`, `affiliate_links`, `product_anchors`, `commerce_placements`, `commerce_conversions`. All additive. `product_anchors` CHECK: exactly one of `post_id` / `placement_id`. Partial unique index on active placements per (content, channel), mirroring `posts_content_platform_active_key`. | L | Migration applies clean on real Postgres; constraints verified with negative inserts. |
| 6.0.3 | `content_assets.duration_seconds Int?` (additive, nullable). | S | Legacy rows valid; no backfill needed. |
| 6.0.4 | Extend `AuditAction`: `commerce_product_created/updated/retired`, `affiliate_link_created/retired`, `product_anchor_recorded/removed`, `commerce_placement_recorded`, `commerce_conversion_added`, `commerce_report_exported`. | S | Typed union compiles; every mutating commerce path has an action. |
| 6.0.5 | Env flags `COMMERCE_IMPL_SHOPEE` / `COMMERCE_IMPL_TIKTOK_SHOP` (`mock` default, Joi-validated, production-only live guard). Documented in `.env.docker.example` + `docker-compose.yml`. | S | Boot refuses live outside `NODE_ENV=production`; flags discoverable (closes the recurring `.env` papercut for these flags). |
| 6.0.6 | **PDPA + separation policy doc**, locked with System Analyst: no-buyer-data column ban, commerce/payout non-summation rule, commerce export redaction posture, audit-meta-no-PII. | M | Signed policy in `docs/`; feeds 6A.7 and the 6C gate. |
| 6.0.7 | **Separation test design** agreed and written as failing tests first: static boundary assertion + byte-identical payout/ranking fixture. | M | Tests exist and fail meaningfully before 6A code lands. |

**6.0 exit**: migration verified on real Postgres; platform-enum diff empty; System Analyst signs off PDPA + separation; separation tests scaffolded.

### Phase 6A — Backend

| ID | Work package | Size | Acceptance criteria |
|----|--------------|------|---------------------|
| 6A.1 | `CommerceModule` skeleton + `CommerceAdapter` interface + `CommerceAdapterRegistry` (parallel to `PlatformAdapterRegistry`, **not** an extension of it). Mock Shopee + TikTok Shop adapters; live impls are rejecting stubs. | M | Registry resolves both channels; mock deterministic; enabling live without credentials fails cleanly and is audited. |
| 6A.2 | Product catalog CRUD — `GET/POST/PATCH /api/commerce/products`, soft-retire (`isActive=false`, never hard-delete). AdminGuard + CSRF + audit. | M | CRUD works; retire is soft; audit rows written. |
| 6A.3 | Affiliate links — `GET/POST /api/commerce/products/:id/links`, retire. | S | Links resolve to products; retire is soft. |
| 6A.4 | Product anchors — `POST/DELETE /api/posts/:id/product-anchors` and `.../placements/:id/product-anchors`. Validates the target post/placement exists and the product is active. **No step-up** (records no override fact, pushes nothing live). | M | Anchors attach to both targets; duplicate anchor is idempotent or 409; audited. |
| 6A.5 | `POST /api/commerce/placements/manual-external` — AdminGuard + CSRF + **step-up** + **copyright gate** + active-duplicate **409** + **duration gate 422** (10–60s, null rejected). | L | All five guards individually test-proven; mirrors `posts/manual-external` behaviour 1:1. |
| 6A.6 | Duration capture — pure-TS MP4 `mvhd` parser in `UploadValidationService`; **best-effort, returns null on failure, never blocks an upload**. | M | Existing upload tests all still pass unchanged; duration populated for well-formed MP4; malformed input → null, not throw. |
| 6A.7 | Conversions — `POST /api/commerce/conversions` (append-only, negative amounts permitted), `GET` history. **No PATCH/DELETE route exists.** | M | Append-only proven by route-absence test; reversal rows accepted; audited. |
| 6A.8 | Commerce read model — `GET /api/commerce/summary` (by channel / product / period) + `GET /api/commerce/summary/:contentId`. **Reads only commerce tables.** | M | Totals correct; zero `metrics` reads (proven by the boundary test). |
| 6A.9 | Commerce CSV export — `GET /api/reports/commerce.csv` as a **separate report**, never a column on the revenue report. Audited (`commerce_report_exported`), no PII. | M | Separate file; no payout column; byte-level test confirms no buyer-identifying values. |
| 6A.10 | **Make the 6.0.7 separation tests pass** — boundary assertion + byte-identical payout/ranking fixture. | M | Exit criterion #6 green. This is the phase's definition of done. |

### Phase 6B — Frontend

| ID | Work package | Size | Acceptance criteria |
|----|--------------|------|---------------------|
| 6B.1 | `/commerce/products` — catalog list, filter by channel/active, create/edit/retire forms, affiliate-link management. | L | CRUD round-trips; retire reflected; empty/loading states. |
| 6B.2 | **Anchor picker** — product multi-select surfaced in the manual-external record modal and on post/placement detail. Calls record-then-anchor **in sequence** so the admin experiences one action; partial-failure is surfaced honestly (post recorded, anchors failed → explicit retry, never a silent success). | L | Unified UX over two API calls; partial failure states tested. |
| 6B.3 | `/commerce/placements` — Shopee placement list + record modal (step-up, duration field with client-side warning, copyright-gate messaging, 409/422 handling). | L | All error codes render distinct, actionable messages. |
| 6B.4 | Conversion entry modal + history view (append-only; reversals entered as negative, shown as such). | M | Append-only visible in UI; no edit affordance anywhere. |
| 6B.5 | **Commerce dashboard section** — a distinct, visually separated block on `/dashboard` with explicit copy: *"Commerce/affiliate — tracked separately, not included in platform payout revenue."* Separate export button. **No combined total anywhere on the page.** | L | Design-reviewed for separation clarity; a UI test asserts no element renders payout+commerce summed. |
| 6B.6 | Nav + labels (`CommerceChannel` label map, THB formatting reuse) + client-logic unit tests. | S | jest green; `next build` passes. |

### Phase 6C — QC / QA / Visual gate  [gate]

| ID | Work package | Size | Acceptance criteria |
|----|--------------|------|---------------------|
| 6C.1 | QC review — coding standards, tree hygiene, and a **specific check that no commerce import crossed into payout/ranking modules**. | M | QC APPROVED. |
| 6C.2 | QA — adversarial pass on the guards (step-up bypass, duplicate race, duration boundary values 9/10/60/61/null, negative-amount handling, anchor on a non-existent post), plus the separation fixture. | L | Zero Critical/High. |
| 6C.3 | **Visual QA with browser tools** — every new page and modal at mobile/tablet/desktop; console clean; the dashboard separation verified *by eye*, not by reading the JSX. | M | Exit #10. If browser tools are unavailable, the criterion is reported **BLOCKED**, never "met by other means" (Phase 5 lesson). |
| 6C.4 | System Analyst re-verifies exit #8 against the shipped migration, not the plan. | S | Signed. |

### Phase 6D — Live integration spec + rejecting stubs (flagged tail, non-blocking)

| ID | Work package | Size | Acceptance criteria |
|----|--------------|------|---------------------|
| 6D.1 | Written spec: Shopee MediaSpace upload sequence, `partner_id`/`partner_key` handling, TikTok Affiliate Creator API surface, auth/authorisation prerequisites. | M | Spec in `docs/`; sufficient that implementation-day work is bounded. |
| 6D.2 | Live stubs reject cleanly + audited when enabled without credentials. **No live HTTP client.** | S | Enabling live fails with an actionable message; mock stays default. |

---

## 6. Dependency order (critical path)

```
6.0 (schema + PDPA/separation gate + failing separation tests)  ──▶  6A  ──▶  6B  ──▶  6C (gate)
      │  (System Analyst sign-off)                                    │
      │                                                               ├─ 6A.1 registry + mock adapters
      │                                                               ├─ 6A.2/3 catalog + links
      │                                                               ├─ 6A.4 anchors (needs 6A.2)
      │                                                               ├─ 6A.5 placements (needs 6.0.2 + 6A.6 duration)
      │                                                               ├─ 6A.6 duration capture (independent, start early)
      │                                                               ├─ 6A.7 conversions (needs 6.0.2)
      │                                                               ├─ 6A.8/9 read model + CSV (needs 6A.7)
      ▼                                                               └─ 6A.10 SEPARATION PROOF ◀── gates everything
  PDPA + separation sign-off ─────────────────────────────────────────────────▶ Phase 6 exit
                                                        6D (spec + stubs, non-blocking, no live client)
```

- **Hard blocker**: 6.0 before any 6A code. The separation tests must exist and *fail* first — that is what makes exit #6 a proof rather than an assertion.
- **API contract freeze**: 6A.2/6A.4/6A.5/6A.7/6A.8 shapes frozen before 6B, as Phase 2 froze the Post contract for Pass C and Phase 5 froze it for 5B.
- **6A.6 (duration capture) is independent** and touches an existing, well-tested service — start it early and prove the "existing upload tests unchanged" property before it can pressure the schedule.
- **6A.10 is the gate on the phase**, not a final checkbox. If it cannot be made green, the design is wrong and must be revisited before 6B.

---

## 7. Risk Register

Probability (P) × Impact (I), 1–5. Score = P×I. Owner in parentheses.

| ID | Risk | P | I | Score | Mitigation | Owner |
|----|------|---|---|-------|-----------|-------|
| **R1** | **Commerce revenue summed into payout** — a dashboard card, an API total, or a CSV column adds the two streams, breaching C-A/C-B. This is the risk the whole design exists to prevent. | 3 | 5 | **15** | Separate table (Decision 1.3) so no existing query can see commerce; static boundary test; byte-identical payout/ranking fixture (6A.10, exit #6); UI test asserting no summed element; App Designer produces an explicit separation design before code. | App Developer / QA |
| **R2** | **PDPA — buyer data ingress.** A well-meaning "add order id so we can reconcile" turns Content Hub into a processor of consumer personal data, with no DPA and no retention policy for it. | 3 | 5 | **15** | No column exists to hold it (Decision 1.4) — the schema is the control; System Analyst sign-off at 6.0 **and** re-verification against the shipped migration (6C.4); order-level data named in §3.2 out-of-scope; commerce CSV byte-tested for buyer-identifying values. | System Analyst / QA |
| **R3** | **Ranking contaminated by commerce**, breaching C-C — silently, since v2 already blends `metric.revenue`. | 2 | 5 | **10** | Ranking module frozen this phase; commerce lives in tables ranking does not query; boundary test names `modules/ranking/` explicitly; ranking-score byte-identity is part of exit #6. | App Developer |
| **R4** | **`AssetPlatform` gets a `shopee` value** by a future well-meaning change — irreversible (C-F), and it enrols Shopee into `RANKED_PLATFORMS_V2` on the spot. | 2 | 5 | **10** | Decision 2 recorded in the migration note *and* as a comment on the enum block itself, with the ranking consequence spelled out; QC checklist item. | Quality Control |
| **R5** | **Shopee access gate** — Open API requires managed-seller status with an assigned KAM. **Hard dependency on admin action**, outside the team's control. | 5 | 2 | **10** | Explicitly out of the delivered path (C-D); mock + manual record is what ships; recorded as an admin action item with an owner, not a project task; no exit criterion depends on it. | **Admin** (PM tracks) |
| **R6** | **TikTok Shop Creator Affiliate gate** — account must have Showcase enabled and authorise the partner. Same shape as R5. | 5 | 2 | **10** | Same as R5. Anchoring is *recorded* manually regardless of API status, so the feature delivers value without the gate. | **Admin** (PM tracks) |
| **R7** | **Duration gate regresses existing uploads** — the MP4 parser throws or rejects on files that four working platforms accept today. | 3 | 3 | 9 | Capture is best-effort and returns null on any failure; gate applies only at the Shopee placement boundary; explicit test that the entire existing upload-validation suite passes unchanged (6A.6). | App Developer |
| **R8** | **Conversion double-counting** — overlapping `periodStart`..`periodEnd` ranges entered twice, inflating commerce totals. | 3 | 3 | 9 | Append-only with visible history and `statementRef` for human reconciliation; UI warns on an overlapping period for the same channel; corrections are negative rows, so the audit trail shows the fix rather than hiding it. Not a hard block — refusing a legitimate overlap is worse than warning. | App Developer |
| **R9** | **Stale manual catalog** — prices/commission rates drift from reality, and someone treats `commissionRatePct × sales` as earned income. | 4 | 2 | 8 | `commissionRatePct` is documented and labelled **indicative only**; actual earnings are always the entered `CommerceConversion.commissionAmount` from the statement; no code multiplies rate by sales anywhere. | App Developer / PM |
| **R10** | **Scope creep into seller back-office** — orders, inventory, fulfilment, buyer CRM. Each looks like "one more table". | 3 | 4 | 12 | Named explicitly in §3.2 and in the Handoff scope traps; the PDPA argument (R2) is the standing rebuttal — the moment order data lands, the compliance posture of four phases changes. | PM |
| **R11** | **Unverifiable live code** built for APIs nobody can call, reading as capability. | 3 | 3 | 9 | Decision 5: spec + rejecting stubs only, no live HTTP client. Directly honours the Phase 5 close-out recommendation; 5C's non-construction is the precedent. | PM |
| **R12** | **Anchor/record partial failure** — post recorded, anchors fail, admin believes both succeeded. | 3 | 3 | 9 | 6B.2 surfaces partial failure explicitly with a retry; never an optimistic success toast; the two calls are deliberately separate so the failure is *visible* rather than swallowed in one transaction that half-applied. | App Developer |
| **R13** | **Visual QA skipped again.** Phase 5 proved substitution does not work — the first browser look found a 3-phase-old bug. | 2 | 4 | 8 | Exit #10 is a first-class criterion; if tooling is unavailable the criterion is reported **BLOCKED**, never "met by other means". | QA Tester |

### 7.1 Carry-forward register (inherited, non-blocking)

| Item | Source | Disposition in Phase 6 |
|------|--------|------------------------|
| **5C never built** (live TikTok/LINE adapters + PDF export) | Phase 5 plan §5C; Bug Fixer recommended against | **Stays unbuilt.** Same reasoning now extends to commerce live paths (Decision 5). Revisit only when credentials exist. |
| **Cron auto-sync** (metrics + comments) still manual | Phase 3.5 defer | Stays deferred. Note: commerce conversions are manual **by design** in this phase, so no new cron need is created. |
| **QC-4B 3 UX-minors** (template select reset, erase last-page edge, explicit pageSize) | Phase 4B QC | Fold into 6B polish only where the same components are touched; else carry forward again. |
| **Ads/Paid revisit** — evidence window ~8 weeks of *real operation* | Phase 5 close-out §6 | Clock started 2026-07-20. **Not due this phase.** Trigger is real usage, not a build milestone — that was the flaw in the original condition. Start the ads usage log if there is any chance of revisiting. |
| **QA5B-OBS-1** — manual-external modal reachable only from `/scheduler`, not `/posts` | Phase 5B QA | Product-intent call still owed by the admin. Phase 6 adds a *third* record surface (placements), so answer it now rather than triple the inconsistency. |
| **Audit retention PII** — `auth.login.failure` stores email in `actor` | Phase 5D | System Analyst decision still open. No commerce audit action introduces PII, so this phase does not worsen it. |
| **Meta App Review submission** | Phase 1.5 | Admin action; Dev Mode still sufficient for own-Page. Unrelated to commerce. |
| **Single `.env` source of truth** | P4-OBS-1, three phases running | 6.0.5 documents the two new flags properly as the minimum; the underlying consolidation remains a DevOps tech-debt task. |
| **401-as-ERROR log noise** | Phase 2 | Downgrade to WARN when monitoring exists. Unchanged. |
| **Docs sync** — `TargetAgeSegment` enum vs `bussiness_rule.md`; DB UNIQUE on pillar/cadence tables | QA-OBS-1/2 | Fold the DB UNIQUE work in opportunistically if 6.0 touches those tables — it does not, so likely carry forward. |
| **Pillar ratio / cadence targets still provisional for confirmation** | Phase 1.5 | Unchanged; commerce does not add cadence targets (deliberately, §3.2). |

---

## 8. Resource / agent allocation

| Deliverable | Primary agent | Support |
|-------------|--------------|---------|
| Commerce/payout **separation design**, catalog UX, anchor picker, conversion entry, placement modal | App Designer | PM (scope constraints, C-A/C-B) |
| PDPA no-buyer-data + separation sign-off (6.0.6, 6C.4) | System Analyst | PM (risk register) |
| 6.0 schema, 6A backend, 6B frontend, 6D spec/stubs | App Developer | — |
| Coding standards + **cross-module import check** (R4, R3) | Quality Control | — |
| Guard/adversarial tests, separation fixture, **visual QA** (exit #10) | QA Tester | — |
| New env flags in compose/example; log rotation still outstanding | DevOps | — |
| Access-gate tracking (Shopee KAM, TikTok Creator Affiliate) | **Admin** | PM (tracks, does not own) |
| Loop close-out + next-iteration verdict | Bug Fixer → PM | — |

---

## 9. Open decisions for downstream agents

1. **Anchor target grain** (App Designer/Developer): confirmed as `Post` / `CommercePlacement`, not `Content` (Decision 1.2). Flag immediately if the UX makes per-content anchoring feel more natural — but the data loss argument stands.
2. **Overlapping conversion periods** (System Analyst + admin): warn-only, or hard-block? Recommend **warn** — refusing a legitimate overlapping statement is worse than a warning plus a visible append-only history (R8).
3. **Anchor step-up** (System Analyst): recommended **not** required, since anchoring writes no override fact and pushes nothing live. Confirm at the 6.0 gate.
4. **Currency handling** (admin): default THB assumed throughout. If Shopee statements arrive in another currency, decide store-as-received vs convert-on-entry **before** 6.0.2 — retrofitting currency is expensive.
5. **Catalog size expectation** (admin): tens of products, or thousands? Affects whether 6B.1 needs server-side pagination in v1. Assumed **tens**; say so if wrong.
6. **QA5B-OBS-1 product-intent answer** (admin): which surfaces should offer record-external — `/scheduler`, `/posts`, `/commerce/placements`? Due now (§7.1).

---

## 10. Consistency check against existing docs

- Implements `bussiness_rule.md` §"Commerce / Affiliate" (2026-07-20) in full, including both locked decisions: revenue model unamended, ranking not commerce-aware, mock+manual posture, and the recorded access gates.
- Honours every standing business rule: no auto-publish (every commerce write is admin-initiated and confirmed), copyright gate enforced on the manual placement path for the same audit-trail reason `bussiness_rule.md` gives for Phase 5, revenue definition untouched, organic-only ranking preserved.
- Reuses every established pattern: manual-external-record shape, `source: manual|api` provenance (mirroring `MetricSource`), append-only with no PATCH/DELETE, active-row partial-unique-index idempotency, AdminGuard + CSRF + step-up, typed `AuditAction` union with durable `audit_logs`, `PUBLISHER_IMPL_*`-style mock/live gating with production-only live guard, CSV export + audit, the gate → backend → frontend → QC/QA cadence.
- Extends the **`AssetPlatform`-parallel-to-`Platform`** precedent (documented in the schema since Phase 1.5) with `CommerceChannel` — the same solution to the same class of problem, rather than a new idea.
- **Additive-only** schema; `Platform` and `AssetPlatform` unchanged; ranking module frozen.
- Honours the Phase 5 close-out's two standing recommendations: do not build unverifiable live code, and treat visual QA as a first-class deliverable rather than a substitutable one.

---

## Handoff summary (for App Designer / Developer building next)

- **Commerce is a separate stream, enforced structurally — not by convention.** Five new tables (`commerce_products`, `affiliate_links`, `product_anchors`, `commerce_placements`, `commerce_conversions`) in a new `CommerceModule`. Commission records go in **their own append-only table**, never as a discriminator on `metrics` — because `metrics` is read by the dashboard, the revenue CSV, **and the v2 ranking engine's revenue blend**, so a discriminator would make ranking commerce-aware by accident and breach a locked decision invisibly. The phase's definition of done is exit criterion #6: with commerce data seeded, every payout endpoint, the revenue CSV bytes, and every persisted ranking score are **byte-identical** to the zero-commerce fixture.
- **Shopee is NOT a fifth platform.** Add a new `CommerceChannel` enum (`shopee`, `tiktok_shop`) and a `CommercePlacement` table parallel to `Post` — plus a **`CommerceAdapterRegistry` parallel to `PlatformAdapterRegistry`**, with its own interface (`uploadVideo`/`getUploadStatus`/`fetchProducts`/`fetchConversions`). `AssetPlatform` is the *ranking domain* (`RANKED_PLATFORMS_V2 = PLATFORM_TIE_BREAK_ORDER`), so adding `shopee` there enrols it into v2 scoring on the spot — and enum additions are irreversible. **TikTok product anchoring needs no enum change at all**: those posts already exist as `Post{platform: tiktok}`.
- **10–60s: capture loosely, enforce tightly, in that order.** Parse `durationSeconds` from the MP4 `mvhd` atom with a small pure-TS reader (no `ffprobe` binary — same reasoning that chose `pdfkit` over headless Chromium); it is **best-effort and must never block an upload**, or four working platforms regress for one that has no API. Enforce `[10,60]` fail-closed at the Shopee placement boundary only, where **null is a rejection, not a pass**. Add `duration_seconds` to `content_assets` (nullable, additive); placements carry their own media reference so `AssetPlatform` stays untouched.
- **Manual flow extends `POST /api/posts/manual-external`, it does not duplicate it.** TikTok: record the post through the existing unchanged endpoint, then anchor products via a **separate** `POST /api/posts/:id/product-anchors` (anchoring is not a publish act — no step-up, and the publish DTO stays minimal for the documented reason). Shopee: `POST /api/commerce/placements/manual-external`, mirroring the posts endpoint 1:1 — AdminGuard + CSRF + step-up + copyright gate + duplicate 409 + duration 422. Commissions: `POST /api/commerce/conversions`, append-only, negative rows for reversals. Separate at the API seam, **unified in the UX** — one modal, two calls, with partial failure surfaced honestly.
- **Sequence: 6.0 gate (write the separation tests first, and let them fail) → 6A backend → freeze contract → 6B frontend → 6C QC/QA + visual gate → 6D spec-only tail.** Top risks: commerce summed into payout (R1) and buyer-PII ingress (R2), both scored 15.

### Scope traps — things that must explicitly NOT be done

1. **Do NOT add `shopee` or `tiktok_shop` to `Platform` or `AssetPlatform`.** Irreversible, and it silently enrols commerce into `RANKED_PLATFORMS_V2`.
2. **Do NOT put commerce revenue in the `metrics` table**, with or without a discriminator column.
3. **Do NOT let anything under `modules/ranking/` read a commerce table.** Ranking stays payout + engagement + override feedback. Making it commerce-aware is a separate future decision, not a Phase 6 improvement.
4. **Do NOT sum commerce and payout anywhere** — no combined KPI card, no combined API total, no shared CSV column, no "total revenue" that includes both. Two sections, two exports, two totals.
5. **Do NOT store any buyer or order-level data** — no buyer name, order id, address, phone, or email. Aggregate counts and amounts only. There must be no column capable of holding it.
6. **Do NOT build order management, inventory, fulfilment, shipping, payment, or buyer CRM.** Content Hub records commerce outcomes; it is not a seller back-office.
7. **Do NOT build live Shopee/TikTok Shop HTTP clients** without credentials. Spec + rejecting stubs only — the Phase 5 close-out argued this and 5C was correctly never built.
8. **Do NOT add commerce cadence targets, pillar ratios, or scheduler cards.** Commerce has no posting cadence in this system.
9. **Do NOT extend `PlatformAdapter`** with commerce methods — two of its four methods are meaningless for Shopee, and a contract full of `NotImplemented` gets relaxed later.
10. **Do NOT amend the revenue rule in `bussiness_rule.md`.** It stays exactly as written.

---

**Prepared by:** Senior Project Manager, Loop Engineering Position #1
**Date:** 2026-07-20
**Baseline:** 406 backend + 92 frontend tests, 9 migrations, `RANKING_ENGINE=v2`
**Next agent:** App Designer — the commerce/payout **separation design** is the first and highest-risk deliverable.

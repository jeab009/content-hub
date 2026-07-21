# Phase 6D — Live Integration Specification (Shopee MediaSpace + TikTok Shop Affiliate Creator API)

- **Author**: Senior App Developer (Loop Engineering position #4)
- **Date**: 2026-07-21
- **Status**: Specification only. **No live HTTP client is built against this spec** (locked scope
  decision — see below). This document exists so that the day real credentials are granted, turning
  it into working code is a bounded implementation task, not a research task.
- **Input**: `docs/phase6-project-plan.md` Decision 5 (~line 218) and §3.2/Scope-traps item 7
  (~line 460); `docs/phase6-architecture-design.md` §3.5 (`CommerceAdapterRegistry`, ~line 872) and
  §3.6 (duration layers, ~line 962); `backend/src/modules/commerce/adapters/commerce-adapter.interface.ts`;
  `backend/src/modules/commerce/commerce-placement.service.ts`; `backend/prisma/schema.prisma`
  (`CommercePlacement`, `CommerceConversion`, `ProductAnchor`, `CommerceProduct` models).
- **Why this phase stops at spec + rejecting stubs**: this system has no Shopee managed-seller
  status, no assigned Shopee KAM, and no TikTok Shop Creator Affiliate access (Phase 6 project plan
  R5/R6, tracked as admin action items, not project tasks). Writing an HTTP client against an API
  nobody can call, with no way to exercise a single request/response cycle against the real service,
  produces code that reads as capability but has never run — the same reasoning that correctly kept
  Phase 5C (live TikTok/LINE adapters) unbuilt. **This is a settled scope boundary carried forward
  from the Phase 5 close-out, not something reopened by this document.**

---

## 0. What already exists vs. what this document adds

The registry, the `CommerceAdapter` interface, the mock adapters, and the **rejecting live stubs**
(`ShopeeAdapter`, `TikTokShopAdapter`) were built in Phase 6A.1 (commit `9b6b0f4`) — the project plan
anticipated this explicitly: *"The interface stubs are required anyway so the registry has something
to register."* Those stubs already throw `CommerceIntegrationUnavailableError` on every method and
are audited (`backend/src/modules/commerce/adapters/shopee.adapter.ts`,
`.../tiktok-shop.adapter.ts`). WBS 6D.2 in this phase only extends those rejection messages to point
here, and adds a test asserting the message does so.

**What this document adds that did not exist before:** the concrete request/response shapes, auth
scheme, polling sequence, and field-mapping detail an implementer will need on credential day. None
of that existed anywhere in the codebase — it is genuinely new specification, not a restatement.

---

## 1. Shopee — MediaSpace API upload sequence

Shopee's Open Platform (Affiliate / MediaSpace) upload flow is a four-call sequence: initiate →
upload-by-part → complete → poll status. This mirrors the shape of a resumable/chunked upload API
(the same family as YouTube's resumable upload, which `youtube.adapter.ts` already talks to for a
different platform) and maps directly onto the two `CommerceAdapter` methods `uploadVideo` and
`getUploadStatus`.

### 1.1 Sequence

```
1. initiate_video_upload   ──▶  returns upload_id + part boundaries
2. upload-by-part (×N)     ──▶  PUT/POST each chunk to the returned part URLs
3. complete_video_upload   ──▶  finalizes the upload_id into a video_id
4. query-status (poll)     ──▶  GET until state is terminal (success | failed)
```

#### Step 1 — `initiate_video_upload`

Request (conceptually — Shopee's Open Platform request envelope always carries the signed
`partner_id`/`timestamp`/`sign` triplet described in §1.3, in addition to endpoint-specific params):

```
POST /api/v2/mcn/video/init_video_upload
{
  "partner_id": <int>,
  "timestamp": <unix_seconds>,
  "sign": <hex>,
  "file_md5": "<md5 of the full file, hex>",
  "file_size": <bytes>,
  "video_name": "<content title, ASCII-safe>"
}
```

Expected response:

```
{
  "video_upload_id": "<opaque string>",   // becomes uploadJobId
  "part_size": <bytes>,                    // chunk size the caller must use for step 2
  "part_count": <int>
}
```

Maps onto `CommerceAdapter.uploadVideo(args: UploadVideoArgs): Promise<UploadVideoResult>`
(`commerce-adapter.interface.ts:14-22`): `UploadVideoArgs.placementDraft.mediaUrl` is the source
file the implementer streams from; `UploadVideoResult.uploadJobId` is `video_upload_id` from this
response. `UploadVideoResult.externalMediaId` is **not** available yet at this step — it only
exists after step 3, so the live implementation of `uploadVideo` must internally drive steps 1–3
to completion (or return a provisional job id and let the caller poll via `getUploadStatus`; see the
open question in §1.4).

#### Step 2 — upload-by-part

For each part `i` in `0..part_count-1`, `PUT` (or Shopee's documented verb — confirm against the
current Open Platform docs on credential day, this detail drifts between API versions)
the byte range `[i * part_size, min((i+1) * part_size, file_size))` to the part endpoint Shopee
returns, tagged with `video_upload_id` and `part_seq`. Each part response returns an `etag`-like
token that must be collected and replayed in step 3 (this is the same pattern S3 multipart upload
and Shopee's own image-upload API use).

#### Step 3 — `complete_video_upload`

```
POST /api/v2/mcn/video/complete_video_upload
{
  "partner_id": <int>, "timestamp": <unix_seconds>, "sign": <hex>,
  "video_upload_id": "<from step 1>",
  "part_seq_list": [{"part_seq": 0, "part_md5": "<hex>"}, ...]
}
```

Response is the terminal `video_id` **once processing finishes** — but Shopee's video pipeline is
asynchronous, so `complete_video_upload` typically returns an accepted/processing acknowledgement,
not the final id inline. That is what step 4 is for.

#### Step 4 — query-status polling

```
GET /api/v2/mcn/video/query_video_upload_status?video_upload_id=<id>
```

Response:

```
{
  "status": "PROCESSING" | "SUCCESS" | "FAILED",
  "video_id": "<final external media id, present only on SUCCESS>",
  "fail_reason": "<string, present only on FAILED>"
}
```

Maps onto `CommerceAdapter.getUploadStatus(args: GetUploadStatusArgs): Promise<GetUploadStatusResult>`
(`commerce-adapter.interface.ts:24-32`):

| Shopee `status` | `GetUploadStatusResult.state` (`UploadState`) | Notes |
|---|---|---|
| `PROCESSING` (queued, not yet started) | `'pending'` | |
| `PROCESSING` (actively transcoding) | `'transcoding'` | Shopee's API does not always distinguish queued vs. transcoding in one field — an implementer may need to collapse both into `'pending'` if the distinction isn't exposed, rather than inventing a signal that doesn't exist. |
| `SUCCESS` | `'ready'` | `GetUploadStatusResult.externalMediaId` = Shopee's `video_id`. |
| `FAILED` | `'failed'` | `externalMediaId` stays `null`; `fail_reason` should be logged (not silently dropped) but is **not** persisted to any commerce table — it is transport-layer diagnostic, not a business fact. |

**Recommended polling cadence**: exponential backoff starting at 2s, capped at 30s, timeout at 10
minutes — mirroring the kind of bound already used for `publish.processor.ts`'s BullMQ retry/backoff
so the two async-job patterns in this codebase stay consistent rather than inventing a second
polling idiom.

### 1.2 Rate limits

**No rate limit figures exist anywhere in this codebase's comments, docs, or prior commits for
Shopee** — a repo-wide search of `backend/src` and `docs/` for `rate limit`/`shopee` alongside
numeric throttle values returned nothing beyond the *unrelated* `COMMERCE_STEP_UP_TTL_MS`/
`COMMERCE_STEP_UP_LIMIT` constants in `commerce.constants.ts:200-201`, which throttle this system's
own step-up-auth endpoint, not calls to Shopee. **This must be sourced from Shopee's current Open
Platform partner documentation on credential day** — Shopee's Open Platform rate limits are
partner-tier-dependent and have changed across API versions, so a number written here today would
likely be stale by the time credentials exist. Action item for the implementer: confirm the
tier-specific quota (calls/second and calls/day) at onboarding and wire it into the same
`RedisThrottlerStorageService` + `ThrottlerModule` pattern `CommerceModule` already registers for
its own step-up endpoint (`commerce.module.ts:44-53`), rather than introducing a second throttling
mechanism.

### 1.3 Auth — partner_id/partner_key HMAC-SHA256 signing

Shopee Open Platform's documented signing convention (Partner API, stable across the MediaSpace
surface):

```
base_string = partner_id + api_path + timestamp [+ access_token] [+ shop_id]
sign        = HEX(HMAC-SHA256(base_string, partner_key))
```

- `partner_id` (int) and `partner_key` (secret, HMAC key) are issued once per Shopee Open Platform
  application, at KAM-managed onboarding — this is the credential this system does not have.
- `timestamp` is Unix seconds, must be within Shopee's accepted clock-skew window (typically ±5
  minutes — reconfirm at onboarding).
- `access_token` (per-shop, OAuth-issued, refreshable) is appended to the base string for
  shop-scoped endpoints; MediaSpace calls are partner-scoped for some endpoints and shop-scoped for
  others — **which is which must be confirmed against the live docs at onboarding**, since this
  changes the base-string shape per endpoint.
- Every request carries `partner_id`, `timestamp`, and `sign` as query or body parameters (per
  endpoint); the server recomputes the same HMAC and rejects on mismatch or stale timestamp.

This is structurally the same family of signed-request scheme as HMAC-based webhook verification
patterns already used for platform integrations in this codebase's `PlatformAdapter` implementations
(see `base-platform.adapter.ts` for the existing signing/verification idiom this should follow, so
Shopee's signer does not invent a third convention).

### 1.4 Open questions for the implementer (credential day)

1. Whether `uploadVideo()` should synchronously drive steps 1–3 to a terminal state (blocking, with
   its own internal poll loop) or return immediately after step 1 and let the caller drive
   `getUploadStatus()` — the interface supports either, but the two have very different timeout and
   retry semantics. **Recommendation**: return immediately after step 3 is accepted (not polled to
   completion) so `uploadVideo()`'s promise resolves in bounded time, and let the existing
   placement-detail UI poll `getUploadStatus()` the way `PublishOrchestratorService` already polls
   dispatch state for other platforms.
2. Whether MediaSpace access requires the general Shopee Affiliate Open API scope or a separate
   Content/MCN scope — this determines which KAM conversation unlocks it.

### 1.5 Mapping onto `CommercePlacement` / `CommerceConversion`

| Shopee field | Prisma target | Model:line |
|---|---|---|
| `video_id` (from query-status `SUCCESS`) | `CommercePlacement.externalMediaId` | `schema.prisma:770` |
| Shopee's public share URL for the video, if the API exposes one | `CommercePlacement.externalUrl` | `schema.prisma:771` |
| Source file duration, already captured client-side by `mp4-duration.ts` before upload | `CommercePlacement.durationSeconds` | `schema.prisma:782`; gated `[10,60]` by `commerce-duration.ts` regardless of what Shopee reports |
| Shopee `item_id` (product catalog) | `CommerceProduct.externalProductId` | `schema.prisma:665` |
| Shopee catalog `commission_rate` | `CommerceProduct.commissionRatePct` | `schema.prisma:674` — **stays indicative-only**; never multiplied by sales anywhere (R9, unchanged by live access) |
| Shopee Affiliate conversion-report row (aggregate, per product/period) | `CommerceConversion` (`ordersCount`, `itemsSold`, `grossSalesAmount`, `commissionAmount`) | `schema.prisma:830-837` |
| Shopee's per-conversion buyer/order identifiers, if the report includes them | **Nowhere. Not mapped. Not stored.** | The `ConversionSnapshot` adapter return type (`commerce-adapter.interface.ts:62-72`) has no field to carry them — see §3 below. |

---

## 2. TikTok Shop — Affiliate Creator API

TikTok Shop's Creator/Affiliate surface (distinct from TikTok's main Content Posting API, which
`tiktok.adapter.ts` already talks to for organic posts) covers three concerns relevant here:
collaboration requests, showcase/product pinning, and conversion/commission reporting.

### 2.1 Collaboration requests

TikTok Shop's affiliate model requires a **seller-initiated Target Collaboration invitation** or a
**creator-initiated Open Collaboration application** before a creator account can promote a seller's
products. There is no Content Hub write path for this today, deliberately: collaboration state is a
seller/creator relationship fact, not a content-distribution fact, and this system's manual-anchor
model (§2.3 below) sidesteps needing it — the admin anchors products manually regardless of whether
API-level collaboration exists.

```
GET  /affiliate/302/collaborations             — list active/pending collaborations
POST /affiliate/302/collaborations/{id}/accept  — creator accepts a seller invitation
```

(Endpoint paths are illustrative of TikTok Shop's versioned-path convention, e.g. `/affiliate/302/...`
— **the exact path and version segment must be reconfirmed against TikTok's current Partner Center
docs at onboarding**, since TikTok Shop API versions this way and has moved paths across releases.)

Nothing in this system needs to call this endpoint family: collaboration is a prerequisite state the
admin manages in TikTok's own Seller/Creator UI, exactly like Shopee's native video upload in Flow B
of the architecture design (§2, Flow B, step 1). No `CommerceAdapter` method exists for it and none
is proposed — adding one would be exactly the scope creep the "out of scope" list warns against
(order/relationship management, not content-distribution recording).

### 2.2 Showcase / product pinning

```
GET  /affiliate/302/showcase/products                       — list a creator's pinned products
POST /affiliate/302/showcase/products                       — pin a product to the creator's showcase
DELETE /affiliate/302/showcase/products/{product_id}         — unpin
```

Request body for pinning (conceptual):

```
{
  "product_id": "<TikTok Shop product id>",
  "shop_id": "<seller shop id>"
}
```

**This maps onto `CommerceAdapter.fetchProducts` for the read direction** — a live adapter would call
the showcase-list endpoint and translate each entry into a `ProductSnapshot`
(`commerce-adapter.interface.ts:40-48`):

| TikTok field | `ProductSnapshot` field |
|---|---|
| `product_id` | `externalProductId` |
| `title` | `name` |
| `seller_sku` | `sku` |
| `product_detail_page_url` | `productUrl` |
| `price.original_price` | `listPrice` |
| `price.currency` | `currency` |
| `commission_rate` | `commissionRatePct` |

**There is deliberately no write direction** (`pinProduct`) in the `CommerceAdapter` interface. Pin
state on TikTok's side is managed natively by the creator in the TikTok Shop app — this system
*records* which products were anchored to a given post after the fact
(`POST /api/posts/:id/product-anchors`, `commerce-anchor.service.ts`), it does not push pin state
to TikTok. This mirrors the architecture design's Flow A exactly (§2, Flow A: "Admin pins products
natively in the TikTok app... Admin records the anchors" — architecture design line 190) and the
locked reasoning that anchoring is a record, not a publish act.

### 2.3 Conversion / commission reporting

```
GET /affiliate/302/orders/conversions?start_time=<unix>&end_time=<unix>&cursor=<opaque>
```

Response (conceptual — TikTok Shop's affiliate reporting is order-line-grained by default, which is
exactly the shape this system must **not** ingest raw):

```
{
  "conversions": [
    {
      "order_id": "<TikTok order id>",
      "product_id": "<TikTok Shop product id>",
      "buyer_id": "<TikTok buyer identifier>",       // ⚠ SEE §3 — MUST NOT be ingested
      "gmv": <decimal>,
      "commission_amount": <decimal>,
      "currency": "<ISO 4217>",
      "order_time": <unix>
    }
  ],
  "next_cursor": "<opaque or null>"
}
```

**This is the single most important implementation note in this document.** TikTok Shop's native
conversion report is order-grained and carries `order_id`/`buyer_id`-shaped fields. A live
`fetchConversions()` implementation **must aggregate before returning**, not pass raw order rows
through: sum `gmv`/`commission_amount` and count orders/items **per product per reporting period**,
and discard every per-order and per-buyer identifier before constructing the `ConversionSnapshot[]`
this system's `CommerceAdapter.fetchConversions` return type allows
(`commerce-adapter.interface.ts:50-72`). See §3 for why the interface itself makes the alternative
(passing raw rows through) a compile error, not a code-review risk.

| TikTok field (aggregated by the adapter, not passed through raw) | `ConversionSnapshot` field |
|---|---|
| `product_id` (grouping key) | `externalProductId` |
| reporting window queried | `periodStart` / `periodEnd` |
| `COUNT(order_id)` per product/period | `ordersCount` |
| `SUM(item_count)` per product/period | `itemsSold` |
| `SUM(gmv)` per product/period | `grossSalesAmount` |
| `SUM(commission_amount)` per product/period | `commissionAmount` |
| `currency` (must be uniform per group; reject/flag mixed-currency groups rather than sum across currencies) | `currency` |
| a business reference the admin can reconcile against the TikTok payout statement, e.g. a generated `"TTS-<period>"` tag — **not** any `order_id` | `statementRef`, format-constrained by `COMMERCE_STATEMENT_REF_PATTERN` (`commerce.constants.ts:183`) |

`order_id` and `buyer_id` have **no destination field anywhere in this mapping** and must be dropped
by the adapter before its return value leaves the adapter boundary.

---

## 3. Why aggregation-at-the-adapter-boundary is a structural PDPA control, not a policy note

This is the load-bearing design decision for both channels, already reflected in
`ConversionSnapshot`'s doc comment (`commerce-adapter.interface.ts:56-61`):

> AGGREGATE ONLY. This shape is a PDPA control in its own right: there is no field for buyer name,
> order id, address, phone or email, so a future live adapter physically cannot hand order-level
> data to the ingestion path without changing this interface — which is a reviewed change, not a
> drift.

Both Shopee's and TikTok's native reporting APIs are, at the wire level, order/buyer-grained (this is
normal for e-commerce affiliate reporting — the platform needs order-level data for its own
reconciliation; this system does not). A live adapter implementation must do the aggregation
**inside the adapter**, before constructing a `ConversionSnapshot`, precisely because that struct has
no field to carry a buyer or order identifier through. An implementer who tries to "just pass the
API response through" hits a type error at the `ConversionSnapshot[]` return, not a review comment —
which is the whole point of locking the shape now rather than trusting future discipline (Phase 6
project plan R2, the PDPA buyer-ingress risk scored 15/25, the joint-highest risk in the register).

**Corollary for `fetchProducts`**: `ProductSnapshot` (`commerce-adapter.interface.ts:40-48`) has the
same property — no buyer field exists to smuggle data through, so the catalog-sync direction carries
no PDPA risk by construction either.

---

## 4. Credential handling — reuse the existing encrypted-token pattern, invent nothing new

**Do not build a new secrets table or a new encryption scheme.** This system already has exactly the
pattern a live commerce adapter needs: OAuth-style tokens encrypted at rest, decrypted only at the
point of use, for exactly the same kind of external-platform-credential problem.

### 4.1 The existing pattern (Google/YouTube OAuth, and every other connected platform)

- **Table**: `ConnectedAccount` (`backend/prisma/schema.prisma:226-251`) — `platform`,
  `platformAccountId`, `platformAccountName`, `accessTokenEncrypted String? @db.Text`,
  `refreshTokenEncrypted String? @db.Text`, `tokenExpiresAt`, `scopes String[]`, `status`.
- **Encryption**: `TokenEncryptionService`
  (`backend/src/modules/connected-accounts/services/token-encryption.service.ts:1-70`) —
  AES-256-GCM, a single 32-byte master key read from `APP_ENCRYPTION_KEY` (base64, env-only, never
  committed), ciphertext format `base64(iv || authTag || ciphertext)`. This is documented as **the
  only place in the codebase that touches the master key or performs raw encrypt/decrypt** — every
  other module goes through it, never around it.
- **Access discipline**: `ConnectedAccountsService.getValidToken()` is "the only sanctioned way other
  modules ever see a decrypted token" (service docblock, line 18-20). Nothing calls
  `TokenEncryptionService.decrypt()` directly outside that service.
- **Runbook**: key-compromise procedure is in `docs/security-decisions.md` (already exists; a future
  commerce credential incident should follow the same runbook, not a new one).

### 4.2 How Shopee/TikTok Shop credentials fit the same shape

Two additive options, in order of preference:

**Option A (recommended): extend `ConnectedAccount`'s pattern with a parallel table, not a shared
one.** Exactly the same reasoning that gave commerce its own `CommerceChannel` enum instead of adding
values to `Platform` (Decision 2, irreversible-enum argument) applies here: `ConnectedAccount.platform`
is typed `Platform`, and `Platform` is explicitly frozen this phase and every phase before it. A new
`CommerceConnectedAccount` table — same column shape (`channel CommerceChannel`,
`accessTokenEncrypted`, `refreshTokenEncrypted` or, for Shopee, `partnerId`/`partnerKeyEncrypted` since
Shopee's partner_key is a static HMAC secret rather than a refreshable OAuth token), reusing
`TokenEncryptionService` for the encrypted columns exactly as `ConnectedAccountsService` does — is
additive, keeps `Platform` untouched, and keeps the commerce/payout table-separation property
(§2.1 of the architecture design) intact: no relation from `ConnectedAccount`/`Platform`-typed tables
into commerce, and vice versa.

**Option B (rejected): reuse `ConnectedAccount` directly by loosening its `platform` column.** Rejected
for the same reason `AssetPlatform` was not extended with `shopee` — `platform Platform` would need
loosening to accept a `CommerceChannel` value too, which either widens `Platform` (irreversible,
locked against) or requires a second nullable-alternative column (the same "denormalized, can drift"
problem the architecture design already rejected for `AffiliateLink.channel`, §1.3 of that document).

Either way: **`partner_key` and any OAuth `access_token`/`refresh_token` are encrypted at rest via
`TokenEncryptionService`, decrypted only inside a `CommerceCredentialsService` analogous to
`ConnectedAccountsService.getValidToken()`, and never logged** — the existing
`redactSensitive`/audit-meta conventions already used elsewhere in this codebase apply unchanged;
`CommerceCredentials` (`commerce-adapter.interface.ts:9-12`) must never appear in an
`AuditLogService.record()` call's `meta`, exactly as passwords and access tokens never do today.

---

## 5. Adapter registry integration — how a live adapter registers itself

No new registration mechanism is needed; the plumbing already exists and was built for this exact
moment.

### 5.1 What already exists (`commerce-adapter.registry.ts`, `commerce.module.ts`)

`CommerceAdapterRegistry` (`backend/src/modules/commerce/adapters/commerce-adapter.registry.ts:26-66`)
builds a `ReadonlyMap<CommerceChannel, CommerceAdapter>` in its constructor, choosing between the mock
and the live class **per channel**, based on `AppConfig.commerce.shopeeImpl` /
`AppConfig.commerce.tiktokShopImpl` (sourced from `COMMERCE_IMPL_SHOPEE` / `COMMERCE_IMPL_TIKTOK_SHOP`,
Joi-validated in `env.validation.ts:76-77`, default `'mock'`). Both the mock adapters
(`MockShopeeAdapter`, `MockTikTokShopAdapter`) and the live stubs (`ShopeeAdapter`, `TikTokShopAdapter`)
are already registered as Nest providers in `CommerceModule` (`commerce.module.ts:64-76`) and injected
into the registry's constructor — **the registry always holds all four instances**; the env flag only
selects which one the map points a channel at.

### 5.2 What changes on credential day

1. Give `ShopeeAdapter`/`TikTokShopAdapter` real constructor dependencies (an HTTP client, a
   `CommerceCredentialsService` per §4) instead of only `AuditLogService`, and replace each `reject()`
   call with real request logic implementing §1/§2 above. **The class names, the injection tokens, the
   `CommerceModule` provider list, and the `CommerceAdapterRegistry` constructor signature do not need
   to change** — only the method bodies do. This is precisely the "bounded implementation task" this
   spec exists to produce.
2. No change to `CommerceAdapterRegistry` itself: it already resolves to the live class whenever the
   env flag is non-mock; it has done so since Phase 6A.1.
3. No change to the env-flag boot guard: `assertAdapterFlagsAreSafe()`
   (`backend/src/config/assert-adapter-flags-safe.ts:23-52`) already refuses to boot with a non-mock
   `COMMERCE_IMPL_*` value outside `NODE_ENV=production`, mirroring the existing `PUBLISHER_IMPL_*`
   guard exactly (one function, not two that can drift — System Analyst condition SA-7).
4. Add credential presence validation at adapter construction or first call (fail fast with a clear
   config error if `COMMERCE_IMPL_SHOPEE=shopee` but no encrypted partner_key exists in the new
   credentials table) rather than surfacing a downstream HTTP 401 as the first symptom.

### 5.3 What must NOT change

- `CommerceAdapter` the interface (`commerce-adapter.interface.ts:89-95`) should not need new methods
  for the scope this document covers — collaboration requests (§2.1) and showcase-pin writes are
  explicitly not represented in the interface (§2.2), and that omission is deliberate, not an
  oversight to fix later.
- The mock adapters remain the default in every non-production environment, unchanged (§6).

---

## 6. Explicitly deferred / out of scope — restated so a future implementer does not scope-creep

Per `docs/phase6-project-plan.md` §3.2 and the "Scope traps" list (~line 452), all of the following
remain **out of scope even after live credentials exist**, unless a separate, explicit product
decision reopens them:

1. **Order management, inventory, fulfilment, shipping, payment processing, buyer CRM.** Content Hub
   *records* commerce outcomes; it is not a seller back-office. Live credentials do not change this —
   they only make the existing recording surfaces (placements, anchors, conversions) capable of being
   pre-filled from a real API instead of typed by hand.
2. **Any buyer-level or order-level data.** §3 of this document is the structural reason a live
   adapter cannot introduce it even by accident: `ConversionSnapshot` and `ProductSnapshot` have no
   field to carry it.
3. **Automated commission reconciliation / statement-file import as the primary path.** A live
   `fetchConversions()` may exist, but manual entry (`POST /api/commerce/conversions`) remains a
   first-class, always-available path — the live path augments it, it does not replace the
   append-only manual ledger's role as the system of record.
4. **Commerce-driven scheduling, cadence targets, or pillar ratios.** Unchanged by live access.
5. **Amending the revenue model.** `Revenue = payout` stays untouched; a live commerce integration
   does not add a second definition of revenue or a combined total anywhere (Phase 6's R1, the
   highest-scored risk in the register).
6. **Making `modules/ranking/` commerce-aware.** Ranking stays payout + engagement + override
   feedback only, live credentials or not.
7. **TikTok Shop collaboration/relationship management** (§2.1) — no write path, ever, from this
   system; that is TikTok's own Seller/Creator Center's job.

---

## 7. Summary checklist for the credential-day implementer

- [ ] Confirm current Shopee Open Platform MediaSpace endpoint paths, request/response shapes, and
      rate limits against live docs (§1.1, §1.2) — this document's shapes are best-effort from public
      Open Platform conventions and **must be reconfirmed**, not assumed current.
- [ ] Confirm current TikTok Shop Affiliate Creator API endpoint paths and reporting granularity
      (§2.2, §2.3) against live Partner Center docs.
- [ ] Stand up `CommerceConnectedAccount` (or equivalent) reusing `TokenEncryptionService` (§4.2) —
      do not invent a new encryption scheme.
- [ ] Implement `ShopeeAdapter`/`TikTokShopAdapter` method bodies only; leave the registry, module
      providers, and env-flag mechanism untouched (§5.2/§5.3).
- [ ] Implement conversion aggregation **inside** each adapter so `ConversionSnapshot[]` never carries
      an order or buyer identifier (§3) — this is enforced by the interface shape, not just this
      instruction.
- [ ] Re-run the full separation test suite (`backend/src/testing/separation/*`) unchanged — a live
      adapter must not require touching payout or ranking modules to function.
- [ ] Re-verify PDPA sign-off (System Analyst) against the *shipped* live-adapter code, the same way
      6C.4 re-verified the schema against shipped migration rather than the plan.

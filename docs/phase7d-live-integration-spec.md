# Phase 7D — Live Integration Specification (Meta Marketing/Insights API)

- **Author**: Senior App Developer (Loop Engineering position #4)
- **Date**: 2026-08-01
- **Status**: Specification only. **No live HTTP client is built against this spec** (locked scope
  decision — see below). This document exists so that the day `ads_read` is actually granted,
  turning it into working code is a bounded implementation task, not a research task.
- **Input**: `docs/phase7-project-plan.md` §"Phase 7D" (sub-phase table + WBS 7D.1/7D.2) and
  Decision 2 (~line 74); `docs/phase7-architecture-design.md` §3.1 (~line 327, the explicit
  "no `adapters/` directory... no `PaidAdapterRegistry`... no adapter interface is speculated
  here" statement this document exists to resolve); `docs/meta-app-review-status.md`;
  `docs/phase6d-live-integration-spec.md` (structural template — same rigor, similar section
  shape; the content differs because the source platform, API family, and credential story all
  differ); `backend/prisma/schema.prisma` (`AdCampaign`, `AdPerformanceEntry`, `AdChannel`,
  `AdCampaignStatus`, `AdSource` models/enums — the actual shipped shape, not the design draft);
  `backend/src/modules/paid/paid.constants.ts`; `backend/src/modules/paid/dto/*` (the shipped
  validation constraints this mapping must respect); `backend/src/modules/connected-accounts/
  services/token-encryption.service.ts`; `backend/prisma/schema.prisma` (`ConnectedAccount` model).
- **Why this phase stops at spec + a rejecting stub**: this system has no `ads_read` OAuth scope
  granted on its Meta App — the app is in Dev Mode, scoped to Login and the admin's own-Page
  publishing only (`docs/meta-app-review-status.md`). `ads_read` is a **different** permission on a
  **different** Meta product surface (the Marketing API, not the Login/Pages API this app already
  uses), and requesting it reopens the Meta App Review question that Dev Mode currently avoids.
  Writing an HTTP client against a scope nobody has requested, let alone been granted, with no way
  to exercise a single request/response cycle against the real service, produces code that reads as
  capability but has never run — the same reasoning that correctly kept Phase 5C (live TikTok/LINE
  adapters) and Phase 6D (live Shopee/TikTok Shop adapters) as spec-plus-rejecting-stub only. **This
  is a settled scope boundary carried forward from those close-outs, not something reopened by this
  document.**

---

## 0. What this document is NOT: restating Decision 2

`docs/phase7-project-plan.md` Decision 2 is explicit and binding: **Content Hub does not integrate
with the Meta Ads MCP at the code level, at all, this phase or any future phase without a fresh
decision superseding that one.** The MCP (`https://mcp.facebook.com/ads`) stays exactly what
`SETUP-CHECKLIST.md` §6.4 already says it is — a tool the admin uses directly, outside Content Hub,
for campaign creation/management, with its own OAuth session, independent of anything this program
ships.

**The 7D live-sync path described below is unrelated to the MCP.** It is the **standard Meta
Marketing API / Insights API** — the same REST API family every third-party ads-reporting tool
(Supermetrics, Triple Whale, etc.) uses to pull campaign performance numbers — reached with a
conventional OAuth access token carrying the `ads_read` permission, over plain HTTPS `GET` requests
to `graph.facebook.com`. It has no relationship to the MCP server, uses a different permission
scope than the MCP's own OAuth flow, and reopening it does not touch, revisit, or weaken Decision 2
in any way. Anyone reading only this document, out of context, should still come away knowing the
MCP is off the table — restated here rather than assumed.

**Grep guard**: `backend/src/testing/separation/paid-no-live-http-client.spec.ts` asserts no file
under `backend/src` names `mcp.facebook.com`, system-wide (WBS 7A.6's guard, extended). Nothing this
document proposes should ever make that test fail.

---

## 1. What already exists vs. what this document adds

Unlike Commerce's 6D (`ShopeeAdapter`/`TikTokShopAdapter` already existed from 6A.1 — 6D only updated
error messages), **Paid had no adapter architecture at all before this WBS item** — confirmed by
`docs/phase7-architecture-design.md` §3.1's own words: *"No `adapters/` directory, deliberately...
There is no `PaidAdapterRegistry` to design... this design's `AdSource` enum is the only
forward-compatibility surface it needs from schema, and no adapter interface is speculated here."*

This WBS 7D deliverable is therefore two things, built from scratch this phase, not an update to
something that shipped in 7A:

1. **This document** — the concrete request/response shapes, auth scheme, rate-limit posture, and
   field-mapping detail an implementer will need on credential day. None of that existed anywhere in
   the codebase before now.
2. **The rejecting stub** (WBS 7D.2) — `backend/src/modules/paid/adapters/`:
   - `paid-adapter.interface.ts` — the `PaidAdapter` contract (one method:
     `fetchCampaignPerformance`), scoped to exactly what Paid needs (a read-only performance pull),
     not Commerce's four-method upload/status/products/conversions surface.
   - `paid.errors.ts` — `PaidAdapterError` (abstract base), `PaidCredentialsError`,
     `PaidIntegrationUnavailableError`, mirroring `commerce.errors.ts` exactly in shape.
   - `paid-live.adapter.ts` — `PaidLiveAdapter implements PaidAdapter`. Its one method always
     rejects with `PaidIntegrationUnavailableError`, audited as `paid_adapter_unavailable`
     (`backend/src/common/audit/audit-log.service.ts`), and performs zero network I/O.
   - Gated by a new `PAID_IMPL_META` env flag (`disabled` default / `meta` live — see §5.3 for why
     this is not named `mock`/`live`), validated in `backend/src/config/env.validation.ts` and
     covered by the `assertAdapterFlagsAreSafe()` boot-refusal guard
     (`backend/src/config/assert-adapter-flags-safe.ts`) exactly like every other `*_IMPL_*` flag.

**Not wired into `PaidModule`'s provider list.** There is no "sync now" button anywhere in the
shipped UI and no consumer that would call `fetchCampaignPerformance` today, so registering it as a
Nest provider would be scaffolding for a caller that does not exist. The class is unit-testable by
direct construction (`paid-live.adapter.spec.ts`), which is what WBS 7D.2 actually asks for.

---

## 2. Meta Marketing API / Insights API — the relevant read endpoints

A live pull needs **two** API surfaces, not one, because campaign metadata (name, objective,
lifecycle status, budget) and campaign performance (spend, reach, impressions, clicks, results) live
on two different edges of the Graph API. This split matters for the field mapping in §3 — it is the
reason a single Insights call cannot populate `AdCampaign` on its own.

### 2.1 Campaign metadata — `GET /{ad-account-id}/campaigns`

```
GET /v{version}/act_{ad_account_id}/campaigns
    ?fields=id,name,objective,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time
    &access_token=<token with ads_read>
```

Conceptual response shape (Graph API's standard paginated envelope):

```json
{
  "data": [
    {
      "id": "23851234567890",
      "name": "Summer Skincare Reach — Traffic",
      "objective": "OUTCOME_TRAFFIC",
      "status": "ACTIVE",
      "effective_status": "ACTIVE",
      "daily_budget": "50000",
      "start_time": "2026-07-01T00:00:00+0700"
    }
  ],
  "paging": {
    "cursors": { "before": "<opaque>", "after": "<opaque>" },
    "next": "https://graph.facebook.com/v.../act_.../campaigns?after=<opaque>&..."
  }
}
```

Notes, held to the level of confidence this document can actually support:

- `objective` uses Meta's ODAX (Outcome-Driven Ad Experiences) taxonomy since the 2023
  consolidation (`OUTCOME_TRAFFIC`, `OUTCOME_ENGAGEMENT`, `OUTCOME_LEADS`, etc.) — this is exactly
  why `AdCampaign.objective` is free text rather than an enum (schema.prisma docblock, design §1.1):
  Meta's own taxonomy has changed shape before and is not this program's to model. A live adapter
  writes whatever string Meta returns.
- `daily_budget`/`lifetime_budget` are returned as **strings**, in the ad account's currency **minor
  unit** for some currencies and major unit for others depending on the currency's Graph API
  convention — **this must be reconfirmed against current Marketing API docs at onboarding**, it is
  exactly the kind of decimal-placement detail that is easy to get wrong silently and this document
  will not guess at the current behavior for THB specifically.
- `effective_status` (not `status`) is the field that reflects real-world delivery state (e.g. an
  `ACTIVE` campaign can be `effective_status: CAMPAIGN_PAUSED` if the ad set or ad beneath it is
  paused) — §3.2 addresses which one maps onto `AdCampaignStatus`.

### 2.2 Campaign performance — `GET /{ad-account-id}/insights`

```
GET /v{version}/act_{ad_account_id}/insights
    ?level=campaign
    &fields=campaign_id,campaign_name,spend,reach,impressions,clicks,actions
    &time_range={"since":"2026-07-01","until":"2026-07-07"}
    &time_increment=1
    &access_token=<token with ads_read>
```

Conceptual response shape:

```json
{
  "data": [
    {
      "campaign_id": "23851234567890",
      "campaign_name": "Summer Skincare Reach — Traffic",
      "spend": "3200.00",
      "reach": "48210",
      "impressions": "61042",
      "clicks": "1104",
      "actions": [
        { "action_type": "link_click", "value": "980" },
        { "action_type": "landing_page_view", "value": "742" },
        { "action_type": "purchase", "value": "12" }
      ],
      "date_start": "2026-07-01",
      "date_stop": "2026-07-01"
    }
  ],
  "paging": { "cursors": { "before": "<opaque>", "after": "<opaque>" } }
}
```

- `level=campaign` rolls ad-set/ad-level data up to the campaign, which is the only grain
  `AdPerformanceEntry` needs (schema §1.2 — no ad-set or ad-level table exists, deliberately).
- `time_range` + `time_increment=1` returns one row per day within the range; omitting
  `time_increment` returns one aggregated row for the whole range. **Genuine open question for the
  implementer**: whether a live sync should pull daily rows (finer-grained, matches how
  `periodStart`/`periodEnd` could be set to a single day each) or pull one aggregated row per the
  admin-chosen reporting period (matches the manual-entry UX exactly, where the admin logs "spend
  for this week"). Recommend the latter — set `time_range` to the admin's chosen period with no
  `time_increment` — so a live-sourced row and a manually-entered row are shaped identically and
  `AdPerformanceEntry.periodStart`/`periodEnd` never needs to represent 90 single-day rows for one
  admin-visible reporting period. Not decided here because it is a UX call, not just an API detail.
- **`actions` is an array of `{action_type, value}` pairs, not a single result figure.** This is the
  single most important mapping tension in this document — see §3.3.

### 2.3 Rate limiting

Meta's Marketing API throttles at the **Business Use Case** level and reports current usage via a
response header:

```
X-Business-Use-Case-Usage: {"<business-id>":[{"type":"ads_management","call_count":12,
  "total_cputime":8,"total_time":6,"estimated_time_to_regain_access":0}]}
```

A well-behaved client reads this header after every call and backs off before hitting the
account-level throttle, rather than waiting for a `429`/error response — this is Meta's documented
recommendation and the header's entire purpose. **The exact percentage thresholds, the reset window,
and whether `X-Ad-Account-Usage` (a second, ad-account-scoped header some Marketing API endpoints
also return) applies to the Insights edge specifically must be reconfirmed against current Marketing
API docs at onboarding** — this document will not fabricate current numeric limits it cannot verify
from the same session context that would let a credential-day engineer actually test them.

**Batch requests**: the Graph API's batch endpoint (`POST /` with a `batch=[{method, relative_url},
...]` JSON array body, up to 50 sub-requests per call) is the documented way to fetch multiple
campaigns' Insights in one HTTP round trip rather than one request per campaign — relevant once the
admin has logged more than a handful of campaigns, to stay well under the per-call overhead the rate
limit above is actually protecting against. Recommended for the credential-day implementation;
exact batch size/format should be reconfirmed against current docs.

### 2.4 Auth — OAuth access token carrying `ads_read`

Unlike Shopee's HMAC-signed partner_id/partner_key scheme (`docs/phase6d-live-integration-spec.md`
§1.3), the Marketing API uses the **same OAuth Bearer-token convention** this codebase's Facebook
Login flow already uses for `pages_show_list`/`pages_read_engagement`/`pages_manage_posts`
(`backend/src/config/env.validation.ts` `FACEBOOK_OAUTH_SCOPES`) — just with a different scope
(`ads_read` instead of the Pages scopes) and a token that must be associated with a role
(Admin/Advertiser/Analyst) on the specific ad account being queried, not just a role on the app. Two
practical implications:

1. **This can, in principle, reuse the exact same OAuth app/flow this system already has** — no new
   Meta App, no new client id/secret — by adding `ads_read` to the scopes requested at connect time.
   This is precisely why requesting it is the trigger for revisiting `docs/meta-app-review-status.md`
   (§3 below), not a reason to think it is free: the existing app's Dev-Mode-sufficient status is
   scoped to the **current** permission set, and adding any new scope is itself a change Meta's
   review process cares about, independent of whether a second Page/account is ever connected.
2. A long-lived **System User access token** (created in Meta Business Manager, not tied to an
   individual admin's personal login session expiring) is the credential shape most third-party
   reporting integrations actually use for unattended/scheduled pulls, as opposed to a short-lived
   User access token from an interactive OAuth redirect. Which of the two this system should use is
   a credential-day decision informed by how the sync is actually triggered (see §5's open question
   on whether 7D→future ships a manual "Sync now" button or a scheduled job) — not fixed here.

---

## 3. Field mapping — Marketing API response fields onto the shipped `AdCampaign`/`AdPerformanceEntry` schema

Grounded in the **actual shipped migration** (`backend/prisma/schema.prisma`, `AdCampaign` model
~line 957 and `AdPerformanceEntry` model ~line 1017), not the architecture design draft — the two
differ in one place worth flagging: the design draft's quoted `sourceRef` regex was defective and
the shipped `PAID_SOURCE_REF_PATTERN` (`backend/src/modules/paid/paid.constants.ts`) is the corrected
version; this document uses the shipped constant throughout.

### 3.1 `AdCampaign` (from §2.1's `/campaigns` call — a one-time or periodic metadata sync)

| Marketing API field | `AdCampaign` field | Mapping notes |
|---|---|---|
| `id` | `externalCampaignId` | Meta's numeric campaign id, as a string. |
| `name` | `externalCampaignName` | Direct copy. |
| `objective` | `objective` | Direct copy — free text by design (§2.1), no taxonomy translation needed. |
| — | `channel` | Always `AdChannel.meta` — the only value this or any future Meta-sourced row can carry. |
| `effective_status` | `status` | **Needs a translation table, not a direct copy** — see §3.2. |
| `daily_budget` or `lifetime_budget` | `plannedBudget` | **INDICATIVE ONLY** (schema docblock, SA-P5) — never reconciled against `AdPerformanceEntry.spend` by this mapping or any code that consumes it. Currency/minor-unit handling per §2.1 must be reconfirmed. |
| `start_time` | `startDate` | Truncate to date (`AdCampaign.startDate` is `@db.Date`, not a timestamp). |
| `stop_time` (if present) | `endDate` | `NULL` when Meta returns no `stop_time` — matches the schema's existing "still running" semantics exactly, no adapter-side invention needed. |
| — | `contentId` | **Cannot be populated from the Marketing API at all.** This is an admin-only attribution judgment (design §1.2's boxed discussion: "the admin links the single piece that matters most... or leaves it unlinked") — a live sync must leave this field untouched on rows it did not create, and must never overwrite an admin-set `contentId` on a row it updates. |
| — | `currency` | From a separate `GET /act_{id}?fields=currency` call (the ad account's currency) — **not** carried on the Insights or Campaign edges themselves. v1's `PAID_SUPPORTED_CURRENCIES = ['THB']` service-level restriction (`paid.constants.ts`) still applies: a live adapter pulling a non-THB ad account should be rejected the same way a manual THB-only entry is, not silently written past the service guard. |
| — | `source` | `AdSource.api` — the entire reason this enum exists (schema docblock: "so API-sourced rows are distinguishable from hand-entered ones without a migration"). |
| — | `createdBy` | **Open question, not resolved here** — see §5.4. `createdBy` is a `NOT NULL` FK to `users(id)`; there is no synthetic "system" user row in this schema (unlike the audit trail's string `actor` field, which freely accepts `'system:paid-adapter'`). |

### 3.2 `status` translation — `effective_status` → `AdCampaignStatus`

Meta's `effective_status` enum (as of the API's current documented values — **reconfirm the full
list at onboarding**, Meta has added values before) is materially richer than the schema's three-
value `AdCampaignStatus`:

| Meta `effective_status` (representative, not exhaustive) | `AdCampaignStatus` |
|---|---|
| `ACTIVE` | `active` |
| `PAUSED`, `CAMPAIGN_PAUSED`, `ADSET_PAUSED` | `paused` |
| `ARCHIVED`, `DELETED`, `COMPLETED` | `ended` |
| anything else Meta returns that isn't listed above | **implementer's call at onboarding** — recommend defaulting to whichever of the three is least surprising to the admin reading the campaign list, logged loudly rather than silently coerced, since this is exactly the kind of taxonomy drift `objective` being free text was designed to shrug off but `status` (an enum, per Decision 4/§1.1) cannot. |

### 3.3 `AdPerformanceEntry` (from §2.2's `/insights` call — one row per admin-chosen reporting period)

| Marketing API field | `AdPerformanceEntry` field | Mapping notes |
|---|---|---|
| `campaign_id` | `campaignId` | **Requires a lookup**, not a direct copy — `AdPerformanceEntry.campaignId` is a UUID FK to the local `AdCampaign.id`, not Meta's campaign id. Resolve via `AdCampaign.externalCampaignId` (unique per `(channel, externalCampaignId)`, schema `@@unique`). A live sync that receives Insights for a campaign with no matching local `AdCampaign` row (the admin hasn't logged that campaign in Content Hub yet) must skip it, not auto-create one — campaign creation stays an admin-confirmed action (Decision 1/`AdCampaignService.create`), never implicit. |
| `spend` | `spend` | Cast the string to a `Decimal`, matching `AdCampaign.plannedBudget`'s existing `Decimal(12,2)` handling in `paid-campaign.service.ts`. **CHECK (spend >= 0)** at the DB level already guards this — Meta's Insights `spend` is never negative in practice, so this should never fire for a live-sourced row, but the constraint is not relaxed for `source=api` rows either. |
| `reach` | `reach` | Cast string → int. |
| `impressions` | `impressions` | Cast string → int. |
| `clicks` | `clicks` | Cast string → int. |
| `actions` (array) | `resultType` + `resultCount` | **The real mapping tension** — see below. |
| `date_start` | `periodStart` | Already date-shaped (`YYYY-MM-DD`) — no truncation needed, unlike `startDate` above. |
| `date_stop` | `periodEnd` | Same. |
| — | `currency` | Same ad-account currency lookup as §3.1; independent column, per schema's own documented reasoning (never reconciled against the campaign's `currency`). |
| — | `sourceRef` | An auto-generated, non-identifying tag, e.g. `"meta-insights-<campaign_id>-<date_start>"` — must satisfy `PAID_SOURCE_REF_PATTERN` (`^[A-Za-z0-9][A-Za-z0-9._\-\/]{0,63}$`, no spaces) and stay under `PAID_SOURCE_REF_MAX_LENGTH` (64 chars). This is a system-generated reference, not admin-typed, so it can be validated at construction time rather than relying on the DTO/service double-check the manual path needs — but it must still pass the same pattern, since nothing downstream (export, erasure) distinguishes a live-sourced row's `sourceRef` from a manual one's. |
| — | `correctsEntryId` | `NULL` for a fresh pull. A live sync re-pulling a period it already pulled (e.g. Meta's own numbers for a recent day are still being finalized and change on a later pull) is a **genuine open question**: whether that should insert a new row with `correctsEntryId` pointing at the earlier one (consistent with the append-only "corrections are new rows" design) or be suppressed as a no-op duplicate. Not decided here — recommend the former, since it is the existing, already-reviewed mechanic, but flagging it as a decision an implementer must make explicit, not infer. |
| — | `source` | `AdSource.api`. |
| — | `recordedBy` | Same open question as `AdCampaign.createdBy` above — §5.4. |

**Why `actions` → `resultType`/`resultCount` is the real mapping tension, not a mechanical detail**:
Meta's Insights `actions` field returns an **array** of every action type that occurred in the period
(`link_click`, `landing_page_view`, `purchase`, `lead`, `video_view`, ...), while the shipped schema
has exactly one `resultType` (free text) + one `resultCount` (int) pair per row — deliberately, per
the design's own resolution of the PM's OQ-3 ("free-text `resultType` label + numeric count rather
than a rigid enum"). A live adapter must **pick one action type to surface as "the result"** for a
given campaign, not average or sum across types (a link click and a purchase are not the same unit).
The natural choice is the action type matching the campaign's own `objective` (e.g. an
`OUTCOME_TRAFFIC` campaign's "result" is `link_click`; an `OUTCOME_SALES` campaign's is `purchase`),
mirroring how Meta's own Ads Manager UI already picks a primary "Results" column per campaign based
on its objective — but the exact `objective` → `action_type` mapping table is itself Meta-taxonomy-
dependent and must be built and verified against current campaign data at onboarding, not guessed at
here. **This is the single most implementation-bounding-but-not-implementation-blocking finding in
this document**: it does not require new schema (the shape already supports it), but it is real
design work an implementer must do with live data in hand, not a mechanical field copy.

---

## 4. Credential storage — reuse the existing encrypted-token pattern, invent nothing new

Identical posture to `docs/phase6d-live-integration-spec.md` §4, and the same underlying pattern:
**do not build a new secrets table or a new encryption scheme.**

### 4.1 The existing pattern (already used for the Facebook Login/publish connection and Google/YouTube)

- **Table**: `ConnectedAccount` (`backend/prisma/schema.prisma:233-256`) — `platform Platform`,
  `platformAccountId`, `platformAccountName`, `accessTokenEncrypted String? @db.Text`,
  `refreshTokenEncrypted String? @db.Text`, `tokenExpiresAt`, `scopes String[]`, `status`.
- **Encryption**: `TokenEncryptionService`
  (`backend/src/modules/connected-accounts/services/token-encryption.service.ts`) — AES-256-GCM, a
  single 32-byte master key from `APP_ENCRYPTION_KEY` (base64, env-only, never committed), ciphertext
  format `base64(iv || authTag || ciphertext)`. Documented as the **only** place in the codebase that
  touches the master key or performs raw encrypt/decrypt.
- **Access discipline**: `ConnectedAccountsService.getValidToken()` is the only sanctioned way other
  modules ever see a decrypted token; nothing outside `ConnectedAccountsService` should call
  `TokenEncryptionService.decrypt()` directly.
- **Runbook**: key-compromise procedure is in `docs/security-decisions.md` — unchanged by this
  document; a future paid-credential incident follows the same runbook.

### 4.2 How Meta `ads_read` credentials fit the same shape

Two additive options, in order of preference — the identical structure Phase 6D weighed for Shopee/
TikTok Shop, applied to Meta:

**Option A (recommended): extend `ConnectedAccount` directly, not a parallel table.** Unlike
Commerce's Shopee/TikTok Shop case (which needed a new `CommerceChannel`-typed table because
`ConnectedAccount.platform` is typed `Platform` and Shopee/TikTok Shop are not `Platform` values at
all), **Meta already is a `Platform` value** — the existing Facebook Login/publish `ConnectedAccount`
row for the admin's Page is exactly this shape, just with a narrower `scopes` array
(`pages_show_list,pages_read_engagement,pages_manage_posts`). The most direct option is: the **same**
`ConnectedAccount` row, re-authorized with `ads_read` added to `scopes` at connect time. This needs
no new table and no new Prisma model — only a scopes-array check at the point `PaidLiveAdapter` (or
whatever it becomes) looks up a token, confirming `ads_read` is present before attempting a call, and
a clear, actionable error if it is not (mirroring `PaidIntegrationUnavailableError`'s existing shape,
just re-triggered from a "scope missing" condition instead of "flag disabled").

**Option B (fallback, only if Option A proves wrong at onboarding): a parallel
`PaidConnectedAccount`-style table**, mirroring Commerce's `CommerceConnectedAccount` proposal
(`docs/phase6d-live-integration-spec.md` §4.2 Option A) — same column shape, reusing
`TokenEncryptionService` for the encrypted columns. This would only be the right call if Meta's ads
API in practice requires a **separate** token from the Page-publish token (e.g. a System User token
scoped only to the ad account, never tied to the Page connection at all) rather than an additively-
scoped version of the same token — which Option A assumes but this document cannot fully confirm
without live testing against a real ad account. **Flagged as the one credential-storage decision
that needs verifying at onboarding, not assumed either way here.**

Either way: the ad account's access token is **encrypted at rest via `TokenEncryptionService`,
decrypted only inside a `ConnectedAccountsService`-analogous access point, and never logged** — the
existing `redactSensitive`/audit-meta conventions apply unchanged. `PaidCredentials`
(`paid-adapter.interface.ts`) must never appear in an `AuditLogService.record()` call's `meta`,
exactly as passwords and access tokens never do today (and exactly as `paid-live.adapter.ts`'s
existing audit call already only logs `{channel, method}` — never credentials).

---

## 5. What changes on credential day

### 5.1 The trigger condition — restated explicitly, per the project plan's own instruction

`docs/phase7-project-plan.md` §3.2 names this precisely: *"Reopening Meta App Review / requesting
`ads_read` scope on the existing Meta App this phase (P-D)... That is the trigger condition for 7D,
not a task inside 7.0–7C."* Restated here so a future implementer does not scope-creep the trigger:

- **The trigger is "the admin has decided to request the `ads_read` scope and the App Review
  question this reopens has been resolved (or Dev Mode has been confirmed sufficient for this
  scope too, if Meta's rules allow that for Marketing API permissions — verify at onboarding, since
  Dev Mode's self-use exemption may not extend to ads permissions the same way it does to Pages
  permissions)."**
- It is **not** simply "the 8-week Ads/Paid real-usage evidence window (`docs/phase7-project-plan.md`
  §0/§7.1, clock started 2026-07-20) has elapsed." Per the plan's own admin-confirmed answer to its
  open question 6 (§9): closing that window only reopens the *decision* to consider live sync — it
  does not by itself grant the scope or clear App Review. Both conditions are required, not either
  one.
- Update `docs/meta-app-review-status.md`'s scope table (currently `pages_show_list`,
  `pages_read_engagement`, `pages_manage_posts` only) to add an `ads_read` row and re-run its
  Dev-Mode-sufficiency IF/ELSE rule against the ads-specific case — the existing rule was written for
  Page-connection scopes and may not translate directly (ad account access can involve Business
  Manager roles that are a different concept from "who has a role on this Meta App").

### 5.2 Code changes — bounded, because the stub's shape does not change

1. Give `PaidLiveAdapter` a real constructor dependency (an HTTP client — this codebase already uses
   the global `fetch` elsewhere, no new HTTP library needed — plus a credentials-lookup dependency
   per §4) instead of only `AuditLogService`, and replace the single `reject()` call with real
   request logic implementing §2/§3 above. **The class name, the file location, and the
   `PaidAdapter` interface do not need to change** — only the method body does. This is precisely the
   "bounded implementation task" this spec exists to produce, mirroring Phase 6D's own framing.
2. Register `PaidLiveAdapter` as a provider in `PaidModule` (it currently is not — §1) and wire
   whatever consumes it: either a new "Sync now" endpoint on `PaidController` guarded the same way
   every other mutating paid route is (`SessionAuthGuard` + `AdminGuard` + `CsrfGuard`, per design
   §3.3 — a sync pull is itself a write to `ad_performance_entries`, so it should carry the same
   guard stack a manual entry does, likely **with** step-up given it is now capable of writing many
   rows unattended in a way manual entry never was — a fresh call for the System Analyst at that
   time, not decided here), or a scheduled job if the admin prefers unattended sync (mirroring the
   existing `metrics_sync_run`/`comment_sync_run` cron pattern, deferred exactly as Phase 3.5 deferred
   auto-sync for metrics/comments — "Cron auto-sync... still manual" per the Phase 7 plan's own
   carry-forward register). **Neither is decided here** — this is a product/UX call for whoever picks
   up this WBS item with real credentials in hand, not an API-shape question.
3. Add `PAID_IMPL_META=meta` handling wherever the sync path is triggered from — check the flag
   before attempting the pull, and continue refusing cleanly (the existing
   `PaidIntegrationUnavailableError` message, updated to reflect "not yet synced" rather than "no
   scope") if somehow reached with `disabled` still set. `assertAdapterFlagsAreSafe()` already
   refuses to boot with `PAID_IMPL_META=meta` outside `NODE_ENV=production` — no change needed there
   beyond what already shipped in 7D.2 (§6 confirms this).
4. Add credential/scope presence validation at adapter construction or first call (fail fast with a
   clear config error if `PAID_IMPL_META=meta` but no `ConnectedAccount` carries `ads_read` in its
   `scopes` array) rather than surfacing a downstream HTTP 401 as the first symptom — mirroring
   Phase 6D §5.2 item 4's identical recommendation for Shopee/TikTok Shop.

### 5.3 Why the env flag is named `PAID_IMPL_META`, and why its values are `disabled`/`meta` not `mock`/`live`

`COMMERCE_IMPL_SHOPEE`/`COMMERCE_IMPL_TIKTOK_SHOP` use `mock`/`<channel>` because Commerce ships a
**real mock adapter** (`MockShopeeAdapter`, `MockTikTokShopAdapter`) that performs deterministic,
zero-I/O rehearsal writes — `mock` is a genuine, exercised code path today. **Paid has no equivalent.**
Paid is manual-entry-only this phase (Decision 1); there is no data-pull to rehearse, mocked or
otherwise, until credentials exist. Naming the default value `mock` would imply a rehearsal path this
codebase does not have and cannot exercise, which is exactly the kind of "reads as capability but
never ran" problem this whole document exists to avoid. `disabled` (the safe default, matching every
other flag's mandatory-default posture — System Analyst SA-7's rule extends here unchanged) and
`meta` (the live, credential-day value — named after the channel, mirroring `COMMERCE_IMPL_SHOPEE`'s
own channel-named live value rather than a generic word like `live`) say what is actually true: there
is no third "rehearsal" state, only "off" and "the real thing."

### 5.4 Open question this document does not resolve — `createdBy`/`recordedBy` for an automated write

Both `AdCampaign.createdBy` and `AdPerformanceEntry.recordedBy` are `NOT NULL` foreign keys to
`users(id)` (schema.prisma) — there is no synthetic "system" user row anywhere in this schema, unlike
the audit trail's `actor` field, which is a free string and already accepts synthetic values like
`'system:paid-adapter'` (the very actor `PaidLiveAdapter`'s rejection audit row uses today, since a
failure-to-call has no request-scoped user). An automated live pull that successfully writes a row,
by contrast, **must** name a real `users.id`. Two options, genuinely undecided here since it is a
product/ownership call, not an API-shape one:

1. **Attribute every live-sourced row to the connected admin's own user id** — the same admin whose
   `ConnectedAccount` supplied the token, or whichever admin triggered/owns the sync. Consistent with
   `bussiness_rule.md` §Ownership's existing single-admin model (no new role this phase, per the
   plan's admin-confirmed answer to OQ-5) and needs **no schema change** — recommended as the default
   unless a future decision introduces a genuine service-account concept.
2. **Make `createdBy`/`recordedBy` nullable for `source=api` rows** — a schema change, and therefore
   out of this non-blocking document's remit entirely (any schema change is a new migration requiring
   the same gate discipline 7.0 went through, not a 7D-tail decision).

Recommend option 1 at credential day unless something about the live sync's actual trigger mechanism
(§5.2 item 2) makes attributing to a specific admin genuinely wrong.

---

## 6. Confirming 7D.2 doesn't drift from this document — cross-references

- `backend/src/modules/paid/adapters/paid-adapter.interface.ts` — the `PaidAdapter` contract this
  document's §2/§3 mapping targets.
- `backend/src/modules/paid/adapters/paid.errors.ts` — `PaidIntegrationUnavailableError`, thrown by
  the stub today for "no scope," and reusable unchanged on credential day for any other unavailable-
  precondition case (e.g. "scope present but token expired and refresh failed").
- `backend/src/modules/paid/adapters/paid-live.adapter.ts` — the rejecting stub itself; its
  docblock cross-references this document by path.
- `backend/src/config/env.validation.ts` (`PAID_IMPL_META`), `backend/src/config/configuration.ts`
  (`AppConfig.paid.metaImpl`), `backend/src/config/assert-adapter-flags-safe.ts` (boot-refusal
  guard, extended to cover `PAID_IMPL_META` the same way it already covers every `PUBLISHER_IMPL_*`/
  `COMMERCE_IMPL_*` flag) — the flag mechanics §5.3 describes are already shipped, not proposed.
- `backend/src/common/audit/audit-log.service.ts` (`'paid_adapter_unavailable'` — the `AuditAction`
  union member the stub's rejection audits against) — already shipped, mirrors
  `'commerce_adapter_unavailable'` exactly.
- `backend/src/testing/separation/paid-no-live-http-client.spec.ts` — the structural proof that no
  live HTTP client code exists under `src/modules/paid/` today, and that no file in `backend/src`
  names the Meta Ads MCP domain (§0's grep guard).

---

## 7. Explicitly deferred / out of scope — restated so a future implementer does not scope-creep

Per `docs/phase7-project-plan.md` §3.2 and its "Scope traps" list, all of the following remain
**out of scope even after `ads_read` is granted and a live adapter is built**, unless a separate,
explicit product decision reopens them:

1. **Campaign creation, editing, budget, targeting, or audience-management from Content Hub.**
   `PaidAdapter` (§1) has exactly one method, `fetchCampaignPerformance` — no `createCampaign`, no
   `updateBudget`, nothing write-shaped toward Meta. This is not an oversight to fix later; Option B/C
   were rejected outright in the project plan (Decision 1), and live credentials existing does not
   revisit that rejection. The admin continues to manage campaigns in Meta Ads Manager or, at their
   own discretion, via their own direct use of the Meta Ads MCP — which this codebase still never
   calls (§0).
2. **Any code-level integration with the Meta Ads MCP**, for any reason, ever, without a fresh
   decision explicitly superseding `SETUP-CHECKLIST.md` §6.4 and Decision 2. Granting `ads_read` on
   the standard Marketing API changes nothing about this — they are different products.
3. **Google Ads, TikTok Ads, or any non-Meta paid channel** (Decision 3). `AdChannel` stays
   Meta-only; a second channel is an honest additive migration if and when evidence for it exists, not
   something this document pre-builds an abstraction for.
4. **Any audience-targeting, custom-audience/lookalike, or individual click/impression/recipient-
   level data** (Decision 5, PDPA hard rule). §3's field mapping is deliberately campaign-level
   aggregate only — `actions` array entries are aggregate counts per action type, not per-recipient
   events, and nothing in this mapping introduces a buyer/recipient-shaped field the way
   `ConversionSnapshot`'s design (`docs/phase6d-live-integration-spec.md` §3) already guards against
   for Commerce.
5. **Making paid data ranking-aware** (Decision 6). A live sync writing more `AdPerformanceEntry`
   rows, faster, changes nothing about `modules/ranking/` never reading them.
6. **Amending the revenue model.** `Revenue = platform monetization payout only` stays untouched; a
   live paid integration does not add a second definition of revenue or a combined total anywhere
   (Phase 7's R1, the joint-highest risk in that plan's register).
7. **Automated reconciliation replacing manual entry as the primary path.** Even once a live
   `fetchCampaignPerformance()` exists, `POST /api/paid/campaigns/:id/performance-entries` (manual
   entry) remains a first-class, always-available path — the live path augments it, mirroring
   Commerce's own §6 item 3 (`docs/phase6d-live-integration-spec.md`) verbatim in spirit.

---

## 8. Summary checklist for the credential-day implementer

- [ ] Confirm `ads_read` has actually been granted (not merely requested) and re-verify
      `docs/meta-app-review-status.md`'s Dev-Mode-sufficiency rule against the ads-specific case
      (§5.1) — do not start on the assumption that requesting implies granted.
- [ ] Confirm current Marketing API endpoint paths, field names, and the `daily_budget`/
      `lifetime_budget` currency/minor-unit convention (§2.1) against live docs — this document's
      shapes are best-effort from public Marketing API conventions and **must be reconfirmed**.
- [ ] Confirm current `X-Business-Use-Case-Usage`/`X-Ad-Account-Usage` rate-limit semantics and
      thresholds (§2.3) against live docs and, ideally, a real low-volume test account.
- [ ] Decide the `time_increment` question (§2.2) — daily rows vs. one row per admin-chosen period —
      before writing the ingestion loop, since it changes the shape of every `AdPerformanceEntry` a
      live sync produces.
- [ ] Build and verify the `objective` → primary `action_type` mapping table (§3.3) against real
      campaign data — this is design work, not a mechanical field copy, and is the single largest
      remaining unknown in this document.
- [ ] Resolve the `effective_status` → `AdCampaignStatus` fallback case (§3.2) for any Meta status
      value not already covered by the representative table.
- [ ] Confirm whether Meta requires a token separate from the existing Page-publish
      `ConnectedAccount` token, or whether `ads_read` can be added to the same token's `scopes`
      (§4.2, Option A vs. B) — verify against a real ad account before committing to a schema shape.
- [ ] Decide the `createdBy`/`recordedBy` attribution question (§5.4) — recommended: the connected
      admin's own user id, no schema change.
- [ ] Decide the re-pull/`correctsEntryId` question (§3.3) — recommended: a new row pointing at the
      earlier one via `correctsEntryId`, consistent with the existing append-only mechanic.
- [ ] Implement `PaidLiveAdapter.fetchCampaignPerformance` only; leave the interface, error types,
      env-flag mechanism, and audit-action wiring untouched (§5.2/§6) unless live testing reveals one
      of them is actually wrong, not merely incomplete.
- [ ] Re-run the full separation test suite (`backend/src/testing/separation/*`) unchanged — a live
      adapter must not require touching payout, ranking, or commerce modules to function, and must not
      cause `paid-no-live-http-client.spec.ts` to start failing for any file outside the adapter itself
      changing its network behavior (that one file's exemption from a "no fetch" scan, if any is ever
      needed, is a reviewed test change, not a silent pass).
- [ ] Re-verify PDPA sign-off (System Analyst) against the *shipped* live-adapter code once built, the
      same way Phase 6C/7C re-verified schema/design against shipped code rather than the plan.

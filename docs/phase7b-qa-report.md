# Phase 7B — Paid/Ads Visibility Frontend · QA Test Report

- **Tester**: Senior QA Test Engineer (Loop Engineering position #6)
- **Date**: 2026-08-01
- **Commit under test**: `2ad424a` (Phase 7B frontend), running against backend `6205572` (BUG-7A-01 fix)
- **Input**: `docs/phase7b-qc-review.md` (QC APPROVED, zero Critical/Major, one immaterial Minor), Phase 7 architecture/design/system-analyst docs, live Docker stack (backend :4000, frontend :3000, Postgres, Redis, all healthy)

---

## Tooling disclosure — read this first

**No browser automation tools were available in this session.** My tool list contained only `Read`/`Write`/`Edit`/`Bash` — no `mcp__claude-in-chrome__*` tools and no `ToolSearch` were exposed, despite the task instructions describing how to load them. I did not fabricate any "I clicked X" / "I saw Y rendered" claims.

Per the task's explicit fallback instruction, I substituted:
1. **Adversarial HTTP testing directly against the backend** (`curl`, with real login, real CSRF tokens, real session cookies) — driving the exact same endpoints the UI calls, with the exact payload shapes the UI's form-submit handlers construct (verified by reading the handlers).
2. **Source-code verification** for anything that is a rendering/DOM claim (e.g. "the field is genuinely absent from the edit form," "the dropdown only lists same-campaign entries") — I quote the relevant source lines rather than asserting I saw them in a browser.
3. **The project's own automated test suite** (`npx jest`) and **ESLint**, run for real, with real output pasted below.
4. I explicitly did **not** perform: real-browser console/network capture, real click-through screenshots, or true cross-browser/viewport rendering checks. The orchestrator's brief states those visual facts (375/768/1280px, styling, stacking, no horizontal scroll, clean console) were independently already confirmed by the orchestrator in a real browser, and I did not re-attempt or re-claim them.

This report's verdict is based on what I could genuinely execute: full interactive workflow testing via the real HTTP contract, the real unit test suite, and real static analysis — not on visual confirmation, which I do not have and do not claim to have.

---

## Environment

- Login: `admin@example.com` via `POST /api/auth/login` → `200`, session cookie set.
- CSRF: `GET /api/auth/csrf` → token used on every mutating request (`x-csrf-token` header), exactly as `api-client.ts`'s `request()` does.
- All requests sent with `Origin: http://localhost:3000` to match the CORS-restricted origin the app actually runs behind.
- Frontend pages (`/paid`, `/dashboard`, `/commerce`, `/posts`, `/content`, `/login`) all returned `HTTP 200` with the expected Next.js client-app shell (no error-boundary payload triggered — `"error":"$undefined"` in the RSC payload is Next's normal placeholder, not an actual error).

---

## Test Execution Summary

| Category                          | Total | Passed | Failed | Notes |
|-----------------------------------|-------|--------|--------|-------|
| Campaign CRUD round trip (API)    | 6     | 6      | 0      | create/edit/immutability/retire/filter |
| Date-order validation (client+server)| 4  | 4      | 0      | campaign + boundary; performance-entry client gate verified by code |
| Performance-entry adversarial pass| 7     | 6      | 1      | 1 bug found (period-range 500) |
| Correction workflow               | 3     | 3      | 0      | cross-campaign 400, 404, valid same-campaign 201 |
| Dashboard / CSV export distinctness| 3    | 3      | 0      | via source read + live curl of all 3 CSV endpoints |
| Content page chip                 | 2     | 2      | 0      | source verification |
| Regression — unit tests           | 169   | 169    | 0      | `npx jest` full suite |
| Regression — ESLint 3-way zone    | 2     | 2      | 0      | zero errors on touched files; adversarial violation genuinely fires |
| **Total**                         | **196**| **195**| **1**  | |

---

## 1. Campaign create/edit/retire full round trip

Driven exactly as the UI's `handleSubmit`/`handleRetire` construct their requests (`frontend/src/app/paid/page.tsx`).

**Create** — `POST /api/paid/campaigns`, body matching `CampaignFormModal`'s non-editing submit shape:
```
201 {"id":"da0b3146-...","channel":"meta","externalCampaignName":"QA7B Round Trip Campaign","externalCampaignId":"qa7b-ext-001", ...}
```

**Edit — immutability of `channel`/`externalCampaignId`, genuinely, not just grayed out.** Two things were checked:
- *Source*: in `CampaignFormModal`, when `editing` is set, the "Campaign ID" field renders as read-only text (`<span>`), never an `<input>`, and `channel` is never even state in edit mode — a badge only. The `updatePaidCampaign` call in edit mode never includes `channel` or `externalCampaignId` in its payload (lines 354–367 of `paid/page.tsx`).
- *Server*: I additionally sent a PATCH that **explicitly tried** to smuggle both fields in, to confirm the server itself would reject them even if a compromised/modified client attempted it:
```
PATCH /api/paid/campaigns/da0b3146.../ {"channel":"tiktok","externalCampaignId":"HACKED-ID",...}
→ 400 {"message":["property channel should not exist","property externalCampaignId should not exist"]}
```
  followed by a GET confirming the record was untouched (`channel: "meta"`, `externalCampaignId: "qa7b-ext-001"` unchanged). This is a real whitelist-validation guard (`UpdatePaidCampaignDto` with `forbidNonWhitelisted`), not merely a client-side affordance — defense in depth confirmed.

**Valid edit** (name/objective/budget/status, the actual UI submit shape) → `200`, fields updated correctly.

**Retire** — `POST /api/paid/campaigns/:id/retire` for both test campaigns → `201`, `isActive: false`, `retiredAt` set.
- Confirmed via `GET /api/paid/campaigns?isActive=false` → both appear.
- Confirmed via `GET /api/paid/campaigns?isActive=true` → neither appears.
- Confirmed via `GET /api/paid/campaigns` (no filter, the "all" case) → both appear. This matches the "all"/"retired" filter requirement exactly (`StatusFilter` maps `'all'` to `isActive: undefined`, `'retired'` to `isActive: false` in `paid/page.tsx`).
- **Minor observation (not filed as a bug)**: retiring an already-retired campaign returns `201` again (idempotent, just re-stamps `retiredAt`) rather than a `409`/no-op-with-message. Low impact — the UI only shows the Retire button when `campaign.isActive` is true, so this path isn't normally reachable from the UI, but it's a soft idempotency gap worth a note for Bug Fixer's backlog, not blocking.

## 2. Client-side date-order validation

- **Campaign form**: `isValidCampaignDateRange` (`paid-logic.ts` line 56) — read the exact implementation: blank `startDate` invalid, blank `endDate` always valid ("still running"), otherwise `endDate >= startDate` string comparison. This directly gates `canSubmit`, which disables the submit button (`disabled={!canSubmit || isSubmitting}`) — so the inline error appears and submission is blocked *before* any API call, not after a failed one.
- **Server confirmation of the same boundary rule** (since the client can't be exercised via a real browser here, I verified the two edges against the live API, which is the ground truth the client claims to mirror):
  - `endDate < startDate` → clean `400`: `"endDate (2026-08-01) must not be before startDate (2026-08-10)."`
  - `endDate === startDate` → `201` (accepted) — confirms `>=` not `>`.
- Client and server agree exactly at both edges. **Pass.**

## 3. Performance-entry modal — adversarial pass

All via `POST /api/paid/campaigns/:id/performance-entries`, matching the exact body shape `PerformanceEntryModal.handleSubmit` constructs.

- **Valid entry** → `201`, then confirmed present via `GET .../performance-entries` (append-only history, appears immediately — matches "Records are append-only" UI copy).
- **`sourceRef` with a space** (`"bad ref with space"`) → server `400`: `"sourceRef accepts letters, digits and . _ - / only (no spaces) — never audience, buyer, or individual-recipient detail."` This exact string is what `describePaidEntryError` would relay unmodified for non-409/400-correction/404 cases — clear and specific. **Client-side**: `isValidSourceRef` uses the identical regex (`/^[A-Za-z0-9][A-Za-z0-9._\-/]{0,63}$/`), and `canSubmitPerformanceEntry` calls it as part of the submit gate, so in the real UI this would also be caught pre-submit (disabled button + red help text), consistent with the server. **Pass.**
- **Resubmit the exact same payload immediately** → server `409`: `"An identical performance entry was already recorded 60s ago (id b4b2f6be-..., ...). If this is a genuinely new line, wait a moment and resubmit."` `describePaidEntryError` relays 409 messages **as-is** (by design, per its own doc comment, since the backend message is already specific) — this message names the conflicting id and gives an actionable next step, not a generic "error occurred." **Pass.**
- **sourceRef length boundary** (65 chars, one over the 64 limit) → `400` with both the pattern message and `"sourceRef must be shorter than or equal to 64 characters"` — clean, specific. **Pass.**
- **Negative spend** → `400`: `"spend must not be less than 0"` — clean. **Pass.**
- **Invalid channel on campaign create** (`"tiktok"`, not `"meta"`) → `400`: `"channel must be one of the following values: meta"` — clean, and matches the UI never even offering a channel selector (hardcoded `channel: 'meta'` in the create payload). **Pass.**
- **`periodEnd` before `periodStart` on a performance entry → BUG FOUND.** See Bug list, BUG-7B-01 (High). This is the one behavioral failure in this pass.

## 4. Correction workflow

- **UI structurally prevents ever picking a cross-campaign correction target.** Verified by source: the "Corrects" `<select>` in `PerformanceEntryModal` is populated only from `entries`, which is loaded via `apiClient.listPerformanceEntries(campaign.id)` — i.e. scoped to the *current* campaign only (`paid/page.tsx` lines 599–612, 819–832). There is no code path in the UI that can populate this dropdown with another campaign's entry id. **This is a good guard**, worth recording positively rather than as a gap.
- Since the UI cannot construct a cross-campaign correction, I tested the **backend guard directly** (defense in depth, and the only way to actually exercise this path):
  - `correctsEntryId` pointing at a real entry that belongs to a *different* campaign → `400`: `"correctsEntryId b4b2f6be-... belongs to campaign da0b3146-..., not 91ba4f55-... — a correction must reference an entry on the same campaign."` `describePaidEntryError` appends: `"Pick a "Corrects" entry that belongs to this same campaign, or leave it unset."` — specific and actionable. **Pass.**
  - `correctsEntryId` pointing at a non-existent id → `404`: `"The performance entry this row corrects was not found"`, with the frontend appending `"...may have been logged under a different campaign — check and try again."` — specific. **Pass.**
  - **Valid same-campaign correction** → `201`, `correctsEntryId` set correctly. Verified `isCorrection()` logic (`entry.correctsEntryId !== null`) and the rendering code in `paid/page.tsx` (lines 909–914): renders a `badge bg-warning text-dark` labeled **"Correction"** (never "Reversal") plus `corrects entry <id prefix>` — matches the requirement exactly by source read. **Pass.**

## 5. Dashboard interaction

- **"Manage in Paid →"** is a `next/link` `<Link href="/paid">` (`PaidDashboardSection.tsx` line 78) — a real anchor-backed client-side route, not a JS handler that could silently fail; Next's router guarantees navigation on click. Confirmed by source; not click-tested in a live browser (no tool access), but this is about as low-risk a claim as source review supports (it's a plain `<Link>`, no conditional logic gating it).
- **CSV export distinctness** — confirmed live, not just by source:
```
GET /api/reports/paid.csv     → Content-Disposition: attachment; filename="paid-report.csv"
GET /api/reports/commerce.csv → Content-Disposition: attachment; filename="commerce-report.csv"
GET /api/reports/revenue.csv  → Content-Disposition: attachment; filename="revenue-report.csv"
```
  Three genuinely distinct URLs and filenames, all `200`, all correctly content-typed as `text/csv`. `PaidExportCsvButton` renders `<a href={apiClient.reportCsvUrl('paid', ...)}>`, `CommerceExportCsvButton` and dashboard's `ExportCsvButton` use the same helper parameterized by different `report` names — no shared toolbar, no ambiguity possible. **Pass.**

## 6. Content page chip

- Source review of `frontend/src/app/content/page.tsx` (lines 229–242): a "Paid" column renders `badge bg-primary` with text `"Ad campaign (n)"` when `paidCampaignCounts.get(content.id) > 0`, else `<span className="text-muted">—</span>` — a neutral em-dash, not a `0` badge. `paidCampaignCounts` is built from `apiClient.listPaidCampaigns()` called with **no `isActive` filter**, which I confirmed server-side returns *all* campaigns regardless of lifecycle state (both active and retired appeared in my earlier unfiltered `GET` calls) — matching the code's own comment that a retired campaign still counts ("a historical fact that stays true after retirement"). **Pass** by source + confirmed backend default-query behavior.

## 7. Regression + console/network

- **Unit tests**: `cd frontend && npx jest` → **169/169 passed**, including `paid-logic.test.ts` (part of the 40 paid-specific tests) and, critically, `CommerceDashboardSection.test.tsx` — confirming the one-line `CommerceDashboardSection.tsx` edit did not break its own test suite.
- **ESLint on all touched/new files** (`src/app/paid/**`, `src/components/paid/**`, `src/lib/paid-logic.ts`, `src/app/dashboard/page.tsx`, `src/app/content/page.tsx`, `src/components/commerce/CommerceDashboardSection.tsx`, `src/components/AppHeader.tsx`) → **zero errors, zero warnings**.
- **Adversarially verified the new 3-way ESLint separation zone actually fires** (not just present in config): temporarily added `import { CommerceExportCsvButton } from '@/components/commerce/CommerceExportCsvButton';` to `frontend/src/app/paid/page.tsx`, ran ESLint → real error: `'@/components/commerce/CommerceExportCsvButton' import is restricted... Paid/ads components must never import a commerce module... no-restricted-imports`. Reverted the file and confirmed byte-identical via `diff` against the pre-edit backup before re-running ESLint clean. The rule is real, not decorative.
- **Page availability regression**: `/paid`, `/dashboard`, `/commerce`, `/posts`, `/content` all return `200` with a normal Next.js client shell (~5KB bootstrap HTML each, standard for this client-rendered app pattern) — no server-side crash from the new routes/nav link/dynamic import.
- **Console/network**: not capturable without real browser tools (disclosed above). Backend logs (`docker logs content-hub-backend-1`) were reviewed directly for the duration of testing instead, which surfaced BUG-7B-01 (below) via a real `PrismaClientUnknownRequestError` stack trace — this is a legitimate substitute for "check network for unexpected 4xx," since it shows an *unexpected 5xx* that a normal-looking API call can trigger.

---

## Bug List

### BUG-7B-01 — Performance-entry `periodEnd < periodStart` crashes with a raw 500, not a clean 400 (same defect class as BUG-7A-01, not fixed on this sibling path)

**Severity: High**

**Where**: `backend/src/modules/paid/paid-performance.service.ts`, `addEntry()`.

**Root cause**: `paid-campaign.service.ts` was fixed for BUG-7A-01 by adding an explicit `assertValidDateRange()` guard before the Prisma write (verified in source, lines 49–51 and 173–180: `if (endDate !== null && endDate < startDate) throw new BadRequestException(...)`). **No equivalent guard exists in `paid-performance.service.ts` for `periodStart`/`periodEnd`.** The DB has a `CHECK ("period_end" >= "period_start")` constraint (`ad_performance_entries_period_chk`, confirmed in `backend/prisma/migrations/20260721091512_phase7_paid_visibility/migration.sql` line 217), so an out-of-order period is still *rejected*, but as an **uncaught Postgres constraint violation (`23514`)** that propagates as a `500 Internal Server Error` instead of a clean, actionable `400`.

**Repro** (reproducible right now against the live stack):
```bash
curl -s -X POST http://localhost:4000/api/paid/campaigns/<id>/performance-entries \
  -H "Content-Type: application/json" -H "Origin: http://localhost:3000" -H "x-csrf-token: $CSRF" \
  -b cookies.txt \
  -d '{"periodStart":"2026-10-10","periodEnd":"2026-10-01","spend":50}'

→ HTTP 500
{"success":false,"statusCode":500,"message":"Internal server error","path":"/api/paid/campaigns/<id>/performance-entries","timestamp":"..."}
```
Backend log (redacted client-side by `RedactingExceptionFilter`, but logged server-side in full):
```
PrismaClientUnknownRequestError: Invalid `this.prisma.adPerformanceEntry.create()` invocation ...
PostgresError { code: "23514", message: "new row for relation \"ad_performance_entries\" violates check constraint \"ad_performance_entries_period_chk\"" ...}
```

**Client-side impact**: The real UI's `canSubmitPerformanceEntry()` (`paid-logic.ts` line 86) *does* gate on `periodEnd < periodStart` and disables the submit button, so a user clicking through the modal in the ordinary way cannot trigger this. However:
- This is exactly the same "client-only guard, no server-side backstop" pattern that caused BUG-7A-01 in the first place, reintroduced one file over — the fix was applied to campaigns but not extended to the structurally identical performance-entry period fields, despite the code's own comments elsewhere explicitly citing BUG-7A-01 as the reference defect to never repeat.
- The endpoint is a normal authenticated write endpoint, reachable by any admin session directly (curl/Postman/a future frontend bug that weakens the client gate) — not a theoretical-only path.
- If it *is* reached, the frontend's own `describePaidEntryError()` has no case for `500`; it falls through to the generic branch and displays the backend's bare `"Internal server error"` string verbatim — directly contradicting the function's own doc comment ("Every status gets a DISTINCT, actionable message... All other statuses relay the backend's own (already specific) message") for the one status where the backend's message is *not* specific.
- No data corruption risk (the CHECK constraint means the malformed row is never persisted — verified via `GET .../performance-entries` immediately after the 500, confirming only the prior valid entry exists) and no stack-trace leak to the client (`RedactingExceptionFilter` correctly logs the full Prisma error server-side only, returns just `"Internal server error"` to the client) — so this is not a security/data-integrity issue, purely a robustness/UX regression of an already-fixed bug class.

**Fix suggestion**: Add the same `assertValidDateRange`-style guard (or a shared helper) in `paid-performance.service.ts` before the `create()` call, mapping to a `BadRequestException` with a message naming both dates, mirroring `paid-campaign.service.ts` exactly. Add a unit test for it alongside the existing `paid-performance.service.spec.ts` boundary tests, and add a `describePaidEntryError` case (or confirm the generic 500 fallback text is acceptable) — but the primary fix is the missing server-side guard.

**Severity justification**: High, not Critical — no data corruption, no security exposure, requires either bypassing the (functioning) client-side gate or a direct API call to trigger. High, not Medium — it is a reproducible unhandled-exception path on a production write endpoint that is the *exact* defect class this same commit's own author explicitly fixed once already in a sibling service, missed on a structurally identical field pair, and it defeats the stated design goal of the error-mapping layer (`describePaidEntryError`) for the one status class it doesn't special-case.

---

## Deployment Readiness

**REJECTED — route to Bug Fixer.**

One High-severity bug (BUG-7B-01) is open. Per this team's quality standard ("zero critical or high-severity bugs remain open"), this blocks sign-off for DevOps. Everything else tested — campaign CRUD round trip (including genuine, server-enforced immutability of `channel`/`externalCampaignId`), client/server date-order boundary parity, sourceRef validation parity, 409 idempotency messaging, cross-campaign correction guards (both the UI's structural prevention and the backend's explicit 400/404 checks), correction rendering/labeling, CSV export distinctness, content-page chip logic, and the full regression suite (169/169 unit tests, ESLint including a live-fired adversarial check of the new 3-way import zone) — passed cleanly.

Recommend: fix BUG-7B-01 in `paid-performance.service.ts` (small, scoped, same pattern as the existing BUG-7A-01 fix one file over), add a regression unit test for it, then re-run this same adversarial pass on the corrected build before re-submitting to QA.

---

## Test data created and cleanup status

All test data was created via direct API calls (documented above) rather than through a live browser session, since no browser tool access was available. Cleanup performed:

| Item | Action taken |
|---|---|
| Campaign `da0b3146-554f-4ebf-8462-6087ad7ca5a1` ("QA7B Round Trip Campaign (edited)") | Retired via `POST .../retire`. Confirmed `isActive: false` in final state check. No delete endpoint exists for campaigns (soft-retire only, by design) — this is expected, not a gap. |
| Campaign `91ba4f55-4f95-4358-8d0b-8efa1be76788` ("QA7B Same Day Campaign") | Retired via `POST .../retire`. Confirmed `isActive: false` in final state check. |
| Performance entries created on the above (valid entry, correction, base entry) | **No delete/edit path exists — by design** (append-only ledger, explicitly documented in the UI copy and architecture). These remain in the database permanently, attached to now-retired test campaigns. This is the expected, documented behavior of an append-only audit log, not an oversight; flagging per the task's instruction to note anything with no delete path. |
| The failed `periodEnd < periodStart` submission (BUG-7B-01 repro) | Did not persist — the DB CHECK constraint rejected the write before any row was created. Confirmed via immediate follow-up `GET` showing only the one prior valid entry. |
| ESLint adversarial-violation test edit to `frontend/src/app/paid/page.tsx` | Reverted; confirmed byte-identical to pre-edit state via `diff`, and confirmed ESLint clean again afterward. |
| Pre-existing campaigns found in the environment at test start (e.g. "Verify Good", "QA Test Campaign 3", "Summer Skincare Reach") | Not created by me, not touched, left as found — appear to be leftovers from a prior QA/dev session against this shared environment. |

No commits were made. `docs/phase7b-qc-review.md` (QC's own deliverable) was read for context only, never modified.

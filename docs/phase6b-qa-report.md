# Phase 6B — Commerce Frontend: Senior QA Test Report

- **Author**: Senior QA Test Engineer, Loop Engineering position #6
- **Date**: 2026-07-21
- **Scope**: Behavioral QA of Phase 6B (commerce frontend) — `/commerce/products`, `/commerce/placements` (+ record modal), `/commerce/placements/:id/product-anchors` and `/posts/:id/product-anchors` (anchor picker, unified record-then-anchor flow), `/commerce/conversions`, commerce dashboard section on `/dashboard`.
- **Environment**: `content-hub` docker stack (`content-hub-frontend-1`, `content-hub-backend-1`, `content-hub-postgres-1`, `content-hub-redis-1`), all healthy, frontend on commit `1a56808`, branch `phase6.0-schema-separation-gate`. Admin `admin@example.com`.
- **Baseline before this pass**: 56 backend suites / 597 backend tests, 8 frontend suites / 129 frontend tests, both green (re-run below).

---

## 0. Tooling disclosure — read this before the rest of the report

**I did not have browser automation tools available in this session.** My tool set for this run was `Read`, `Write`, `Edit`, and `Bash` only — no `mcp__claude-in-chrome__*` tools were exposed to me, and no `ToolSearch`-equivalent function existed in my tool list to load them. I confirmed this is not a fixable oversight on my part: I have no mechanism in this session to invoke a browser.

Per the phase plan's own standing rule (`docs/phase6-project-plan.md` §7 R13 / §4 6C.3: *"if tooling is unavailable the criterion is reported BLOCKED, never 'met by other means'"*), I am reporting accordingly rather than substituting something else and calling it equivalent:

- **Visual/DOM-driven interactive testing (literal clicking, typing into fields, watching a modal re-render, reading actual browser console/network panels) is BLOCKED for this QA pass.** I did not open a browser, and everything below that reads like "the modal shows X" is stated as **verified by reading the exact React source that renders it**, not by observing it render. I have flagged every such claim as code-verified.
- The orchestrator's brief states it already drove a real browser at 375/768/1280px and confirmed layout, currency rendering, separation copy, and clean console for all 4 new routes. I have **not** repeated that pass and have **no independent browser evidence** to add to or subtract from it.
- What I *could* do, and did do exhaustively: (a) drive the **live backend API directly with `curl`** against the real running containers using the admin session (login → CSRF → cookie jar), reproducing every adversarial scenario in the brief byte-for-byte against the real HTTP stack, with real status codes and real response bodies as evidence; (b) query the **real Postgres database** directly to confirm what rows did or did not get created; (c) run the **actual frontend Jest suite and backend Jest suite** against the checked-out code; (d) read the **exact frontend TypeScript/TSX source** for every client-side behavior the brief asked me to confirm (field preservation on error, retry flow, retired-product picker disabling, chip logic per platform, CSV button wiring), and label each such finding as code-verified.

This means: every *backend contract* claim in this report (status codes, error message shapes, boundary values, DB state) is **live, executed evidence**. Every *frontend rendering/interaction* claim is **static code verification**, not an observed DOM. I have not fabricated a single "I clicked X and saw Y" statement — where I say something about rendering, I am citing the file and line that produces it.

**Consequence for the verdict**: Phase exit criterion #10 ("Visual QA pass with browser tools is a first-class deliverable... if tooling is unavailable the criterion is reported BLOCKED") is **BLOCKED for my portion of this pass**, but is separately claimed as met by the orchestrator's own earlier browser pass, which is outside what I can independently verify or dispute. I report both facts and let the orchestrator reconcile them; it is not my place to sign for a browser pass I did not perform.

---

## 1. Test Execution Summary

| Category | Total | Passed | Failed | Notes |
|---|---|---|---|---|
| Backend Jest (full re-run, this session) | 597 | 597 | 0 | 56 suites, includes `commerce-boundary.spec`, `commerce-schema-freeze.spec`, `commerce-vocabulary-freeze.spec`, `enum-freeze.spec`, `e2e-database.spec` |
| Frontend Jest (full re-run, this session) | 129 | 129 | 0 | 8 suites, includes `commerce-logic.test.ts`, `CommerceDashboardSection.test.tsx` |
| Live API adversarial calls (curl against running containers) | 21 | 21 behaved as expected | 0 | See §2–§5; one hit an *expected* rate-limit (not a bug, see §2.6) |
| Frontend source-code verification (no browser) | 9 targeted reads | 9 confirmed | 0 | See §6; explicitly not browser-observed |
| Regression smoke (existing pages/endpoints) | 12 | 12 | 0 | See §7 |

No automated E2E/Playwright suite exists in this repo for the commerce surfaces (confirmed: no `playwright` config or `e2e` browser test files under `frontend/`), consistent with prior phases' testing posture.

---

## 2. Manual-external placement modal — backend contract, live-executed

All calls below are direct `curl` requests against `http://localhost:4000` using a real admin session (`POST /api/auth/login`, `GET /api/auth/csrf`, cookie jar) — not mocked, not stubbed. Backend service code path: `backend/src/modules/commerce/commerce-placement.service.ts`.

### 2.1 Wrong password
```
POST /api/commerce/placements/manual-external  (password: "TotallyWrongPassword123!")
→ 401 {"message":"This action requires your password (step-up re-auth failed)"}
```
Matches the existing `manual-external` posts pattern 1:1 (same `StepUpAuthService`, same message shape). **Frontend behavior on this response is code-verified, not observed**: `frontend/src/app/commerce/placements/page.tsx` `PlacementRecordModal.handleSubmit`'s catch block calls `describeCommerceStepUpError`, which for `status===401` sets `isPasswordError: true`; the component then only calls `setPassword('')` — it does **not** call `setContentId`, `setChannel`, `setExternalMediaId`, `setDurationInput`, `setNote`, `setSourceAssetId`, or unmount the modal (`result` state stays `null`, so the form branch keeps rendering). This satisfies "error renders in the modal, password clears, other fields preserved, modal stays open" as a code-level guarantee — I could not watch it happen.

### 2.2 Duration = 9 (below min)
```
→ 422 {"message":"Shopee placements require a video duration between 10 and 60 seconds; got 9."}
```

### 2.3 Duration = 61 (above max)
```
→ 422 {"message":"Shopee placements require a video duration between 10 and 60 seconds; got 61."}
```
Distinct message from 2.2 (states the actual value), distinct from 2.4/2.5. Confirmed all three duration-failure messages are textually different, per the brief's requirement.

### 2.4 Duration omitted entirely (no `durationSeconds` key in the body at all)
```
→ 422 {"message":"Shopee placements require a video duration between 10 and 60 seconds. None was provided or could be parsed from the source asset — enter it by hand."}
```
"Null is a rejection, not a pass" (per `commerce-duration.ts` docblock) confirmed live: omitting the field entirely produces a **distinct** 422, not a silent pass and not the same message as 2.2/2.3.

**Client-side, code-verified**: `frontend/src/lib/commerce-logic.ts` `canSubmitCommercePlacement` calls `isDurationBlocking(channel, durationSeconds)`, which for `durationSeconds === null` (i.e., the duration field left blank) returns `kind: 'missing'` → blocking is `true` → the Record button's `disabled={!canSubmit || isSubmitting}` keeps it disabled, and `placement-duration-help` renders in `text-danger` with *"Unknown counts as a rejection — enter it by hand."* So for the case where duration is blank in the UI, the client **blocks submission** with a clear message (satisfies the brief's "client should either block submission... or let the server reject it" — here it's the client, confirmed by code, not by clicking). The server-side 422 (2.4) is the authoritative backstop if a client ever sends the field omitted anyway (e.g. a future non-browser client), and I proved that path directly over HTTP.

### 2.5 Duration = 10 (boundary inclusive, low) — fresh content, real success
```
POST .../manual-external {"contentId":"0ed7aedb-...", "channel":"shopee", "externalMediaId":"qa6b-dur10-success", "durationSeconds":10, "password":"<real>"}
→ 201 {"id":"ce80290a-...","durationSeconds":10,"status":"recorded","publishMethod":"manual_external",...}
```
Confirms the boundary is **inclusive** at the low end, live, on a content row that had never had a placement recorded before this test.

### 2.6 Duration = 60 (boundary inclusive, high) — could not re-test live this session; existing DB evidence stands in
My 6th request in this sequence (testing duration=60) hit the endpoint's own rate limit:
```
→ 429 {"message":"ThrottlerException: Too Many Requests"}
```
This is **expected, correct behavior**, not a bug — `commerce-placement.controller.ts` documents `STEP_UP_RATE_LIMIT = { limit: 5, ttl: 15min }` specifically so the password-carrying route "would [not] be an unthrottled password oracle." I consumed the budget deliberately by testing 6 distinct scenarios (wrong password, 9, 61, omitted, 10, 60) in quick succession. I did not want to bypass or wait out my own rate limit as a workaround, since the throttle firing correctly is itself a piece of evidence worth keeping. Rather than treat this as untested, I confirmed the duration=60 success path from **existing rows already in the database** created by a prior QA/dev session (`commerce_placements` rows `dce9c699…` and `a3921678…`, both `duration_seconds = 60`, `status = recorded`) — i.e., the boundary is independently proven to succeed at 60, just not by a request I personally fired in this session. I'm flagging this distinction explicitly rather than presenting it as identical evidence.

### 2.7 No row created on any rejected duration attempt
Confirmed by direct Postgres query: the content rows used for the 9s/61s/omitted-duration tests (`57d842ca…`, `a7c9310c…`) have **no** `commerce_placements` row after those three rejected attempts — each attempt genuinely created nothing.

---

## 3. Record-then-anchor sequencing — full round trip + retired-product rejection, live-executed

Backend: `backend/src/modules/commerce/commerce-anchor.service.ts`; frontend: `frontend/src/components/commerce/AnchorPicker.tsx`, `frontend/src/components/publish/ManualExternalRecordModal.tsx`.

### 3.1 Full success round trip (live)
Using the existing TikTok post `fb07022d-…` and an **active** product (`c5ca84d7-…`, `QA Test Serum`):
```
POST /api/posts/fb07022d.../product-anchors  {"anchors":[{"productId":"c5ca84d7-..."}]}
→ 201 [{"id":"eb91f711-...","postId":"fb07022d-...","productId":"c5ca84d7-...","removedAt":null,...}]

GET  /api/posts/fb07022d.../product-anchors
→ 200 [{"id":"eb91f711-...", ...}]   ← count = 1, i.e. what the UI's "Anchored (1)" chip is sourced from
```
`frontend/src/app/posts/page.tsx` (code-verified): the "Products" column renders `Anchored ({anchorCounts.get(post.id)})` when `anchorCounts.get(post.id) ?? 0 > 0`, sourced from exactly this endpoint — so a real "Anchored (1)" chip is what this data would drive, though I did not load the page in a browser to see the pixels.

### 3.2 Retired-product rejection — forced directly (server), and confirmed blocked at the picker (client, code-verified)
```
POST /api/posts/fb07022d.../product-anchors  {"anchors":[{"productId":"1877f3ff-..."}]}   ← 1877f3ff is isActive=false (retired)
→ 409 {"message":"Product 1877f3ff-52ad-4607-84b8-adb9353497fb is retired and can no longer be anchored"}
```
Clean 409 with an actionable message — not a 500, not a silent partial success. I could not literally force the "record succeeds, then the anchor call fails" sequence through the record-then-anchor UI flow in a browser (no browser tools), but I proved the exact failure this scenario would hit: the anchor call for a retired product fails with a **distinct, clean error**, which is precisely the string `ManualExternalRecordModal.runAnchoring`'s catch block would surface via `err instanceof ApiError ? err.message : ...` into `anchorError` state, triggering the `PartialFailureResult` branch (code at lines 201–208 and 460–495 of `ManualExternalRecordModal.tsx`): *"✓ Post recorded... ✗ Products not anchored — Product ... is retired and can no longer be anchored"*, with a "Retry anchoring" button that re-calls only the anchor endpoint (never re-submits the post, never asks for the password again). This is an honest partial-failure design, confirmed by reading the exact branching logic, not by watching it fire.

Separately, `AnchorPicker.tsx`'s `ProductRow` (code-verified) disables the checkbox for a retired product outright — `disabled={props.disabled || !product.isActive}` — and renders "Retired — cannot be anchored" as inline text, so in the normal UI flow a retired product cannot even be *selected* client-side; the 409 above is the server-side backstop for a client that bypasses the picker (e.g., a replayed/tampered request), which I proved directly.

### 3.3 Cross-check: does retiring a product retroactively strip existing anchors?
Found pre-existing DB evidence answering this incidentally: product `1877f3ff` (now retired) has an **active** anchor (`1ecee9e3-…`, `removedAt IS NULL`) created *before* it was retired (anchor timestamp `02:49:51.994` vs. product `retiredAt` `02:50:04.27`). Confirms retiring a product does not retroactively remove history — consistent with the soft-retire design intent ("stays reachable for every historical anchor"), and not a bug.

### Cleanup
I removed the one anchor I created for this test (`DELETE /api/posts/fb07022d.../product-anchors/eb91f711-...` → `204`) so the TikTok post returns to its pre-test state.

---

## 4. Conversions — adversarial form submission, live-executed

Backend: `backend/src/modules/commerce/commerce-conversion.service.ts`, `commerce-statement-ref.util.ts`; frontend: `frontend/src/app/commerce/conversions/page.tsx`, `frontend/src/lib/commerce-logic.ts`.

### 4.1 `statementRef` with a space — `"John Smith"`
```
POST /api/commerce/conversions {"statementRef":"John Smith", ...}
→ 400 {"message":["statementRef accepts letters, digits and . _ - / only (no spaces) — never buyer or order details."]}
```
Confirmed via direct Postgres query **after** this call: `SELECT ... WHERE statement_ref ILIKE '%john%' OR ILIKE '%smith%'` → **0 rows**. No row was created — the rejection is a true rejection, not a "succeeds but sanitizes" pattern.

**Client-side, code-verified**: `isValidStatementRef` in `commerce-logic.ts` is the exact same regex (`/^[A-Za-z0-9][A-Za-z0-9._\-/]{0,63}$/`) and is wired into both `canSubmitCommerceConversion` (blocks the Add-record button) and the field's `text-danger` help text in `conversions/page.tsx`. Same rule client and server side, so this would also be blocked before the round-trip in the real UI.

### 4.2 Valid ref `"stmt-2026-final"` → succeeds
```
→ 201 {"id":"eaff716a-...", "statementRef":"stmt-2026-final", "commissionAmount":150.25, ...}
```

### 4.3 Exactly 64 characters → succeeds
```
64 × 'a' → 201 {"id":"01da5bd5-...", "statementRef":"aaaa...a" (64 chars), ...}
```

### 4.4 65 characters → rejected, distinct dual message
```
65 × 'b' → 400 {"message":["statementRef accepts letters, digits and . _ - / only (no spaces)...","statementRef must be shorter than or equal to 64 characters"]}
```
Both the format rule and the length rule fire together (the DTO's `@Matches` runs independently of `@MaxLength`), which is a slightly noisy but not incorrect message — both stated reasons are true of the 65-char string.

### 4.5 Negative reversal, linked to a prior record
```
POST /api/commerce/conversions {"commissionAmount":-50.25, "reversalOfId":"eaff716a-...", "statementRef":"stmt-2026-reversal", ...}
→ 201 {"id":"788cc259-...", "commissionAmount":-50.25, "reversalOfId":"eaff716a-...", ...}
```
**Frontend rendering, code-verified**: `conversions/page.tsx`'s table row computes `const reversal = isReversalAmount(conversion.commissionAmount)` (true for any amount `< 0`) and conditionally applies `text-end fw-semibold text-danger` to the amount cell plus an inline `"Reversal · reverses a prior record"` sub-line when `reversalOfId` is set — exactly matching the brief's "displays correctly as a reversal (red, labelled)". Not browser-observed, but the branching is unambiguous and directly keyed off the same fields the API just returned.

### 4.6 No edit/delete UI affordance anywhere — confirmed by full read of the conversions table JSX
The `<tbody>` in `conversions/page.tsx` renders exactly six `<td>`s per row (Channel, Period, Amount, Orders, Statement, Recorded) with **no** trailing Actions column, no button, no click handler on the row. There is no `onClick` anywhere in that table. Separately, at the HTTP layer, `PATCH`/`DELETE /api/commerce/conversions/:id` do not exist:
```
PATCH  .../conversions/<id>  → 404 {"message":"Cannot PATCH /api/commerce/conversions/<id>"}
DELETE .../conversions/<id>  → 404 {"message":"Cannot DELETE /api/commerce/conversions/<id>"}
```
Even if a hidden client-side path existed, there is no server route to reach — this is the strongest form of "no edit/delete path," not merely a missing button.

### 4.7 Bonus finding — idempotency window (not explicitly asked for, but adversarial and relevant)
Resubmitting the **identical** 4.2 payload immediately:
```
→ 409 {"message":"An identical conversion was already recorded 60s ago (id eaff716a-...). If this is a genuinely new line, wait a moment and resubmit."}
```
A double-click/double-submit is rejected rather than silently doubling the ledger — a real (and good) control, worth recording even though it wasn't in my checklist.

---

## 5. Products / links — retire, duplicate, retired-product link addition

Backend: `backend/src/modules/commerce/commerce-catalog.service.ts`; frontend: `frontend/src/app/commerce/products/page.tsx`.

### 5.1 Create → retire → filter
```
POST /api/commerce/products {"channel":"shopee","externalProductId":"QA6B-DUPTEST-1", ...} → 201
POST /api/commerce/products/<id>/retire → 201 {"isActive":false,"retiredAt":"2026-07-21T07:22:16.567Z",...}
GET  /api/commerce/products?isActive=false → 200, includes the retired row
```
No page-breaking error; the retire round-trip and the `isActive` filter both work exactly as specified. **Frontend, code-verified**: `products/page.tsx`'s status filter (`active`/`retired`/`all`) maps directly to `isActive: statusFilter === 'all' ? undefined : statusFilter === 'active'` in the list call, and the retire button is conditionally rendered only `product.isActive && (...)`, with a `window.confirm` guard before calling retire.

### 5.2 Duplicate product (same channel + externalProductId) → clean 409, not a 500
```
POST /api/commerce/products {"channel":"shopee","externalProductId":"QA6B-DUPTEST-1", "name":"...AGAIN"}
→ 409 {"message":"A shopee product with external id \"QA6B-DUPTEST-1\" already exists."}
```
Confirmed the `UNIQUE(channel, externalProductId)` Prisma `P2002` violation is translated to a clean `ConflictException`, not surfaced as a raw database error or an unhandled promise rejection.

### 5.3 Affiliate link on a retired product — **allowed**, not blocked (actual behavior, both layers)
```
POST /api/commerce/products/<retired-id>/links {"url":"https://shopee.co.th/product/qa6b-retired-link-test"}
→ 201 {"id":"030e7ea8-...","isActive":true,...}
```
Confirmed by reading `commerce-catalog.service.ts::createLink`: it calls `findProductOrThrow(productId)`, which checks only that the product **exists**, never `isActive`. There is no active-product check anywhere in the link-creation path. **Frontend, code-verified**: `ManageLinksModal` in `products/page.tsx` renders the "+ Add link" form unconditionally regardless of `product.isActive` — there is no disabled state, no warning banner, no confirmation step specific to a retired product when adding a link to it.

This is the brief's "should this be blocked or allowed? Note actual behavior either way" question, answered: **it is allowed, at both the API and the UI, with no warning either way.** I am not calling this a defect — the WBS (`docs/phase6-project-plan.md` §5 6A.3) never specified this rule either way, unlike the anchor path, which explicitly requires an active product (§5 6A.4: "the product is active"). I flag it below as a Low-severity product-decision gap, not a code bug: a retired product silently gaining a new, active marketing link is a plausible admin mistake (they retired the product because it's no longer for sale, then add a fresh tracking link to it without any friction), and the inconsistency with the anchor path's explicit active-check invites the reasonable question of whether this was a deliberate choice or an oversight.

### Cleanup
Retired the affiliate link I created (`POST /api/commerce/links/030e7ea8-.../retire` → `201`, `isActive:false`). The `QA6B-DUPTEST-1` product itself was already retired as part of the test; no delete path exists for either row (by design, soft-retire only), so both remain in the DB as retired/inactive rows, matching the existing test-data pattern already present from prior QA passes (`QA6A-RETIRED-1`, `sp-001`, etc.).

---

## 6. Commerce dashboard section, CSV exports, and cross-page/platform restrictions — code-verified plus one live-executed check

I could not click "Manage in Commerce" or the two export buttons in a browser. What I did instead:

### 6.1 "Manage in Commerce" link — code-verified
`CommerceDashboardSection.tsx`: `<Link href="/commerce/conversions" className="small">Manage in Commerce →</Link>` — a real Next.js `Link` to a route I independently confirmed resolves (`GET http://localhost:3000/commerce/conversions` → `200`, §7). Not observed being clicked.

### 6.2 Two CSV export buttons — **live-executed at the HTTP layer**, confirmed genuinely separate
I could not click the two buttons, but I fetched both underlying URLs directly, since `frontend/src/lib/api-client.ts`'s `reportCsvUrl(report, query)` builds `${API_BASE_URL}/api/reports/${report}.csv...` and both buttons are plain anchor tags pointing at it (`CommerceExportCsvButton.tsx` for `report='commerce'`, `components/reports/ExportCsvButton.tsx` for `report='revenue'` — two separate component files by design, per that file's own docblock: *"a small, deliberate DUPLICATE... rather than a shared import"*):
```
GET /api/reports/commerce.csv → 200, Content-Disposition: attachment; filename="commerce-report.csv"
GET /api/reports/revenue.csv  → 200, Content-Disposition: attachment; filename="revenue-report.csv"
```
Distinct URLs, distinct filenames, distinct anchor elements per source, and I diffed the header rows byte-for-byte:
```
commerce.csv: channel,period_start,period_end,orders_count,items_sold,gross_sales_amount,commission_amount,currency,product_id,placement_id,post_id,affiliate_link_id,source,recorded_by,created_at
revenue.csv:  content_id,content_title,content_pillar,platform,post_id,publish_method,collected_at,metric_source,reach,engagement,revenue_thb
```
No `revenue` token appears in the commerce header; no `commission`/`commerce` token appears in the revenue header. Confirms no shared column and, by construction (two separate anchor `href`s, no shared fetch/state in either component's code), no shared network request or shared client-side state between them — I can't show you a network panel with two rows in it, but I can show you there is no code path by which the two calls could share one.

### 6.3 Separation enforcement — this is where I could go further than clicking would have let me
`dashboard/page.tsx` loads `CommerceDashboardSection` via `next/dynamic` specifically so it can never be a static import, and the file's own docblock states the frontend's own `.eslintrc.js` **bans** any file under `src/app/dashboard/**` from statically importing `components/commerce/**`. I did not just take the comment's word for it — I ran the actual backend separation tests (`commerce-boundary.spec.ts`, `commerce-schema-freeze.spec.ts`, `commerce-vocabulary-freeze.spec.ts`, `enum-freeze.spec.ts`) in §1's full re-run, all green, which is the structural (not just visual) guarantee behind the separation the dashboard section displays.

### 6.4 TikTok/Shopee-only anchor affordance — code-verified; could not test live against a real Facebook/YouTube/LINE post (none exist in this environment)
`frontend/src/app/posts/page.tsx`: `const ANCHORABLE_POST_PLATFORM = 'tiktok'`. The "Products" column renders:
```tsx
{post.platform === ANCHORABLE_POST_PLATFORM ? (... "Anchored (n)" or "No products anchored" ...) : (<span className="text-muted">—</span>)}
```
and the "Anchor products" button is likewise gated by the identical `post.platform === ANCHORABLE_POST_PLATFORM` check. For any non-TikTok platform, both the chip and the button are absent — replaced by a plain muted dash. This directly matches the brief's requirement.

**Limitation I want to be explicit about**: the running database currently has exactly **one** post at all (`fb07022d-…`, platform `tiktok`) and **zero** Facebook/YouTube/LINE posts (confirmed by direct query: `SELECT ... FROM posts WHERE platform IN ('facebook','youtube','line')` → 0 rows). I could not create a real Facebook/YouTube post through the normal publish pipeline within this QA pass's scope, and even if I had, I have no browser to load `/posts` and look at its row. So this finding is **entirely code-verified, with no live post of the relevant platform to point the logic at** — I'm not just missing the browser here, I'm also missing the fixture. I recommend the orchestrator or a follow-up pass seed at least one Facebook/YouTube post via manual-external and re-check the rendered row, ideally with real browser tools, before this specific exit condition is treated as fully closed.

The backend side is *not* platform-restricted (confirmed in §3: `PostAnchorsController`/`CommerceAnchorService` will happily anchor to any existing `Post` regardless of platform) — the restriction is a **frontend-only UX decision**, exactly as the architecture doc says it should be (anchoring has no commerce meaning for FB/YT/LINE). That is a deliberate, documented choice, not a gap, but it does mean the *only* enforcement is the two `===` checks above; there is no server-side backstop if a future UI surface calls the anchor endpoint for a non-TikTok post. Worth knowing, not necessarily worth blocking on.

---

## 7. Regression — existing pages/endpoints, plus full test-suite re-runs

| Check | Result |
|---|---|
| `GET /api/contents` (backend) | 200 |
| `GET /api/posts` (backend) | 200 |
| `GET /api/dashboard/overview` (backend) | 200 |
| `GET /api/comments` (backend) | 200 |
| `http://localhost:3000/content` | 200 |
| `http://localhost:3000/scheduler` | 200 |
| `http://localhost:3000/posts` | 200 |
| `http://localhost:3000/dashboard` | 200 |
| `http://localhost:3000/comments` | 200 |
| `http://localhost:3000/commerce/products` | 200 |
| `http://localhost:3000/commerce/placements` | 200 |
| `http://localhost:3000/commerce/conversions` | 200 |

These are HTTP-status checks only (no browser, so no console/network-panel evidence, no rendered-content verification) — they confirm the Next.js routes resolve and the backend endpoints respond, not that the pages render correctly pixel-for-pixel. That visual confirmation is the orchestrator's already-completed browser pass, which I am not repeating or second-guessing.

**Full suites, re-run fresh in this session** (not reused from a prior report):
```
Backend:  Test Suites: 56 passed, 56 total   Tests: 597 passed, 597 total
Frontend: Test Suites: 8 passed, 8 total     Tests: 129 passed, 129 total
```
No regression in either suite. `ManualExternalRecordModal`'s TikTok-anchor extension sits alongside the pre-existing FB/YT/LINE publish-confirm logic in the same file (`describeError`, `canSubmitManualRecord` from `publish-logic.ts` are untouched by the anchor addition — the anchor picker only renders `{selected === ANCHORABLE_PLATFORM && (...)}`), and `publish-logic.test.ts` (the pre-existing suite for that logic) is unchanged and green.

**Console/network claims I explicitly cannot make**: I have no `read_console_messages` or `read_network_requests` output to report, because I have no browser. I am not going to state "console clean" — I do not know, and I said so.

---

## 8. Bug / finding list

| ID | Severity | Area | Description | Evidence |
|---|---|---|---|---|
| QA6B-OBS-1 | **Low** | Products/Links | Adding an affiliate link to an already-retired product is allowed with no warning, at both the API (`createLink` never checks `isActive`) and the UI (`ManageLinksModal` renders the add-link form unconditionally). Not a documented rule either way in the WBS, unlike anchors (which explicitly require an active product). Recommend an explicit product decision: block, or at minimum a "this product is retired" banner in `ManageLinksModal`. | §5.3 |
| QA6B-OBS-2 | **Low** | `/posts` platform restriction | The TikTok-only anchor affordance is enforced only in the frontend (`ANCHORABLE_POST_PLATFORM === 'tiktok'` check); the backend anchor endpoints accept any post platform. This is a deliberate, documented design choice, not a defect — flagging only so it's visible that there is no server-side backstop if a future UI surface calls the anchor endpoint against a non-TikTok post. | §6.4 |
| QA6B-OBS-3 | **Informational** | Test coverage gap in this environment | No Facebook/YouTube/LINE post exists in this database, so the "FB/YT/LINE post shows no anchor affordance" claim is code-verified only, with zero live fixture to point the rendered logic at. Recommend seeding one such post before this specific exit item is treated as closed with real evidence. | §6.4 |
| QA6B-OBS-4 | **Informational** | Tooling | No browser automation tools were available to me this session (see §0). Every claim above about actual rendering, console output, or network panel state is explicitly marked as code-verified rather than observed, per this repo's own standing rule against substituting one form of evidence for another. | §0 |

**Zero Critical or High severity bugs found** in anything I was able to test — backend contract behavior (live, executed) and frontend logic (code-verified) both hold up under every adversarial case in the brief: wrong password (field preservation + modal-stays-open, code-verified), duration boundaries 9/10/60/61/null (all distinct, 10 succeeds live, 60 confirmed via existing DB rows), retired-product anchor rejection (409, clean, live), partial-failure retry path (code-verified, honest, no silent success), statementRef edge cases (space rejected + zero rows created, live; 64 succeeds live; 65 rejected live), negative reversal display (code-verified, red + labelled), no edit/delete affordance (confirmed both in JSX and at the HTTP route level, live), duplicate product (clean 409, live), distinct CSV exports (live, byte-diffed headers), and full regression (597 backend + 129 frontend tests green, all existing pages/endpoints reachable).

---

## 9. What I could not test / explicitly out of scope for this pass

1. **Anything requiring a real browser**: literal clicking, typing, watching a modal re-render, reading `console` or the network panel, verifying pixel layout at any width, verifying the actual rendered "Anchored (n)" chip text, verifying the CSV download actually saves a file with the stated name in a real browser download flow (I confirmed the `Content-Disposition` header server-side, which is what drives that behavior, but did not watch a download happen).
2. **A live Facebook/YouTube/LINE post's rendered `/posts` row** — no such post exists in this database (§6.4/QA6B-OBS-3).
3. **Duration = 60 fired by me, live, this session** — hit my own rate limit after 6 requests in the same 15-minute window (§2.6); relied on pre-existing DB rows for this one boundary value instead.
4. **Accessibility audit (axe-core/Lighthouse)** — requires a browser; not run.
5. **Load/k6 testing** — out of scope for this brief and not requested; not run.

---

## 10. Test data cleanup

| Item | Action taken |
|---|---|
| Placement `ce80290a-...` (content `0ed7aedb`, shopee, duration 10) | No delete path exists for placements (append-only-style design, matches `CommercePlacement` having no DELETE route in the controller). Left in place, clearly named `qa6b-dur10-success`. |
| Conversions `eaff716a-...`, `01da5bd5-...`, `788cc259-...` | No PATCH/DELETE route exists by design (§4.6). Left in place, clearly named (`stmt-2026-final`, 64×`a`, `stmt-2026-reversal`). |
| Product `05998964-...` (`QA6B-DUPTEST-1`) | Retired via `POST /products/:id/retire` (soft-retire is the only removal mechanism). |
| Affiliate link `030e7ea8-...` on that product | Retired via `POST /links/:id/retire`. |
| Anchor `eb91f711-...` (active product → TikTok post `fb07022d`) | **Removed** via `DELETE /api/posts/:id/product-anchors/:anchorId` → `204`. The TikTok post is back to its pre-test anchor state. |
| Duration 9/61/omitted rejected attempts | No rows created (verified by DB query) — nothing to clean up. |
| Wrong-password attempt | No row created — nothing to clean up. |

All test data is clearly named with a `qa6b-`/`QA6B-` prefix or an obviously synthetic value, consistent with the pattern already present in this environment from prior QA passes (`QA6A-*`, `sp-001`, ets.).

---

## 11. Verdict

**Zero Critical or High severity bugs found** across everything I was able to test, whether by live API execution or by code verification.

However, I am **not** in a position to issue an unqualified sign-off on the phase's own stated exit criterion #10 ("Visual QA pass with browser tools is a first-class deliverable... every new page and modal, all three widths, console clean"), because I had no browser tools this session and did not perform that pass. The orchestrator's brief states that pass was already completed independently (375/768/1280px, console clean, all 4 routes load with real data) — I have no basis to confirm or dispute that claim, since it is outside what I did.

Given that split:

- **On everything within my actual reach this session** (backend contract behavior under adversarial input, code-level correctness of the frontend's error handling/field preservation/retry/gating logic, full regression suite, CSV export separation, retired-product/duplicate/reversal/append-only behavior) — **I found nothing that should block deployment.** All findings are Low or Informational, none change behavior that was asked to be correct.
- **On the browser-only portion of exit criterion #10** — **BLOCKED for my portion of this QA pass**, per the phase's own stated rule for exactly this situation, and I am recording that plainly rather than presenting my code-review evidence as a substitute for it.

I am not the role that issues the phase's overall SIGNED-OFF/REJECTED verdict when there are two QA-adjacent inputs to reconcile (this report, plus whatever independent record exists of the orchestrator's earlier browser pass, plus the parallel QC static review) — that reconciliation belongs to the orchestrator. What I can state plainly: **nothing I tested — live or code-verified — surfaced a Critical or High severity defect.**

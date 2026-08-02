# Pre-Production Security Review #2 — Content Hub

**Scope:** identical to `docs/pre-production-security-review.md` (2026-08-01)
— full-system STRIDE + OWASP Top 10 pass across the entire shipped codebase
(Phases 1–7, all closed), re-run from scratch. This is **not** a diff review
of the four fix commits. Two independent reasons drove a full re-pass rather
than a targeted one: (1) each of the four original findings (H-1, M-1, M-2,
M-3) needed its own fresh evidence, re-derived directly rather than trusted
from commit messages; (2) the fixes for H-1 and M-3 were a Next.js 14→15 +
React 18→19 bump and a NestJS v10→v11 + Express v4→v5 bump respectively —
exactly the class of change that can silently introduce new issues while
fixing old ones, and a diff review of the fix commits alone cannot catch a
regression the fix commits didn't touch.

**Verification method (this session, 2026-08-02):** direct reads of
`backend/src/modules/connected-accounts/connected-accounts.controller.ts`,
a fresh full 17-controller `@Controller`/`@UseGuards` decorator sweep across
every file in `backend/src/modules/**` and `backend/src/common/audit/**`,
`frontend/next.config.mjs`, `backend/src/main.ts`, `backend/package.json`,
`frontend/package.json`; fresh `npm audit` (with and without `--omit=dev`)
in both `backend/` and `frontend/`; fresh full test re-runs — separation
suite (6/59), backend unit suite (64/719), frontend unit suite (10/169),
byte-identity e2e suite against a real disposable `content_hub_e2e` Postgres
database (2/28) — all executed live this session, not taken on report; a
**live HTTP verification pass** against the actually-running Docker stack
(`content-hub-frontend-1`, `content-hub-backend-1`, both `Up ... (healthy)`
at session start) — `curl -I` against the running frontend to confirm
security headers are genuinely served, and a full login → CSRF-token →
authenticated-POST cycle against the running backend to reproduce a defect
live rather than infer it from code alone; grep sweeps for `next/image`
usage, Express v5 risk patterns (`setGlobalPrefix`, `getAllAndMerge`,
wildcard routes), `dangerouslySetInnerHTML`, raw SQL, hardcoded secrets, and
every `CHECK` constraint across every Prisma migration cross-referenced
against its application-layer guard.

---

## Executive summary

**Verdict: READY FOR UAT WITH CONDITIONS.**

This **confirms** the original review's overall READY-FOR-UAT-WITH-CONDITIONS
posture but **revises its finding set**: all four original conditions
(H-1, M-1, M-2, M-3) are independently confirmed closed with fresh evidence
gathered this session, and neither major dependency bump (Next 14→15/React
18→19, NestJS v10→v11/Express v4→v5) introduced a regression anywhere this
pass checked — every test suite reproduces its pre-upgrade count exactly.
However, this pass's own full adversarial sweep — applying this project's
own standing lesson that the same defect class tends to recur in sibling
files (BUG-7A-01 → BUG-7B-01) — found a **third, previously-undiscovered
occurrence of that exact defect class** in a file neither the original
review nor the Phase 7C.4 close-out checked, because it sits in a Phase 6
(Commerce) migration, not the Phase 7 (Paid) migration both of those passes
scoped their CHECK-constraint sweep to. This is now **M-4**, live-reproduced
against the running stack this session (not inferred from code reading
alone).

| Severity | Original review (2026-08-01) | This review (2026-08-02) |
|---|---|---|
| Critical | 0 | 0 |
| High | 1 (H-1) | 0 — closed |
| Medium | 3 (M-1, M-2, M-3) | 1 new (M-4) — all four originals closed |
| Low | 3 | 3 — unchanged |
| Informational | 3 | 3 — unchanged (one materially updated) |

None of M-4 is a byproduct of either dependency upgrade — it predates both
(the vulnerable code path and its DB CHECK constraint have existed since the
Phase 6 Commerce migration, `20260721000000_phase6_commerce`) and reproduces
identically regardless of NestJS/Express version. It is a pre-existing gap
this pass's adversarial lens surfaced, not a regression this pass caused.

---

## Closing out the four original findings

### H-1 — Next.js 14.2.35 (6 High CVEs, pre-auth attack surface) — **CLOSED, fresh evidence**

`frontend/package.json:18-20` now pins `"next": "^15.5.22"`,
`"react": "^19.2.8"`, `"react-dom": "^19.2.8"` (read directly this session,
not from a commit message). Fresh `npm audit --prefix frontend` (run this
session, full JSON parsed):

```
4 high severity vulnerabilities:
  - brace-expansion  (dev-only, via eslint@8.57.1 -> minimatch and
                       eslint-config-next -> @typescript-eslint/typescript-estree
                       -> minimatch; confirmed via `npm ls brace-expansion`,
                       zero production reachability)
  - next             (via postcss, sharp — both bundled inside next's own
                       dependency tree, not this app's package.json)
  - postcss          (bundled: node_modules/next/... -> node_modules/postcss@8.4.31)
  - sharp            (bundled: node_modules/next/... -> node_modules/sharp@0.34.5)
```

None of the original six advisories (HTTP request smuggling, the two SSRF
CVEs, unauthenticated Server Function disclosure, the two XSS CVEs, the DoS
and cache-poisoning cluster) appear anywhere in this session's fresh audit
output — **all six are confirmed gone**, independently, not by trusting the
fix commit's own close-out note.

**The residual postcss/sharp risk-acceptance claim, independently
re-verified rather than trusted:**
- `grep -rn "next/image" frontend/src --include="*.tsx" --include="*.ts"` →
  **zero matches**, confirmed fresh this session. `sharp` (which backs
  `next/image`'s optimization pipeline) is therefore unreachable from any
  code path this app actually executes.
- `postcss@8.4.31`'s advisories (XSS via unescaped `</style>`, arbitrary
  file read via attacker-controlled `sourceMappingURL`) require processing
  attacker-supplied CSS. `npm ls postcss` shows it resolves solely through
  `next/`'s own build pipeline — this app has no `postcss.config.*` /
  `tailwind.config.*` of its own and no code path that feeds
  externally-supplied CSS through it; it only ever processes this
  repository's own first-party Bootstrap/SCSS at build time. Confirmed by
  `find` (no postcss config files) and `grep` (no code touches `postcss`
  directly).

**Async Request API migration, independently re-verified rather than
trusted:** `frontend/src/app/content/[id]/edit/page.tsx:9-14` declares
`params: Promise<{ id: string }>` and unwraps it via `use(props.params)`
(React 19's `use()` hook) before reading `.id` — read directly, matches the
codemod's documented pattern correctly.
`frontend/src/app/dashboard/revenue/[contentId]/page.tsx:29-30` uses
`useParams<{ contentId: string }>()` from `next/navigation` — a distinct,
**client-side-only** hook that was never affected by the server-side async
params change in the first place, confirmed by reading the file: this route
does not receive a `params` prop at all, so there was nothing here for the
codemod to touch. `find frontend/src/app -type d -name "\[*\]"` confirms
exactly these two directories are the app's entire dynamic-route surface —
no third route was missed.

### M-1 — `ConnectedAccountsController` missing `AdminGuard` — **CLOSED, fresh evidence**

`backend/src/modules/connected-accounts/connected-accounts.controller.ts:34-35`
now reads:

```ts
@Controller('api/connected-accounts')
@UseGuards(SessionAuthGuard, AdminGuard)
export class ConnectedAccountsController {
```

confirmed by direct read this session, matching every other controller's
pattern. The `DELETE :id` route (line 157-159) still separately carries
`@UseGuards(CsrfGuard)` on top of the now-present class-level guards.

**Fresh full 17-controller sweep** (this session independently re-grepped
every `*.controller.ts` under `backend/src/` — one more file than the
original review's 16, because `backend/src/common/audit/audit-log.controller.ts`
is included this time):

| Controller | Class-level guards |
|---|---|
| `audit-log.controller.ts` | `SessionAuthGuard, AdminGuard` |
| `auth.controller.ts` | (per-method by design — login is pre-auth) |
| `comment-templates.controller.ts` | `SessionAuthGuard, AdminGuard` |
| `comments.controller.ts` | `SessionAuthGuard, AdminGuard` |
| `commerce-catalog.controller.ts` | `SessionAuthGuard, AdminGuard` |
| `commerce-conversion.controller.ts` | `SessionAuthGuard, AdminGuard` |
| `commerce-placement.controller.ts` | `SessionAuthGuard, AdminGuard` |
| `commerce-summary.controller.ts` | `SessionAuthGuard, AdminGuard` |
| `post-anchors.controller.ts` | `SessionAuthGuard, AdminGuard` |
| `connected-accounts.controller.ts` | `SessionAuthGuard, AdminGuard` **(fixed)** |
| `content.controller.ts` | `SessionAuthGuard, AdminGuard` |
| `dashboard.controller.ts` | `SessionAuthGuard, AdminGuard` |
| `metrics.controller.ts` | `SessionAuthGuard, AdminGuard` |
| `paid.controller.ts` | `SessionAuthGuard, AdminGuard` |
| `publish/posts.controller.ts` | `SessionAuthGuard, AdminGuard` |
| `ranking.controller.ts` | `SessionAuthGuard, AdminGuard` |
| `reports.controller.ts` | `SessionAuthGuard, AdminGuard` |
| `scheduler.controller.ts` | `SessionAuthGuard, AdminGuard` |

**Zero new controller-guard gaps anywhere in the codebase**, including every
controller shipped after the original review's sweep (there were none new —
Phase 7's `paid.controller.ts` already existed at the original review and
was already correctly guarded there too). `AuditLogController` — not in the
original review's table at all — is correctly guarded and was simply never
listed by name before; it is not a new gap, it was always compliant.

### M-2 — No security headers — **CLOSED, fresh evidence, verified live**

`frontend/next.config.mjs:11-26` now has a `headers()` function setting
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, and
`Strict-Transport-Security: max-age=63072000; includeSubDomains` on
`/:path*` — read directly this session.

**This session went further than reading config** — `curl -I` against the
actually-running `content-hub-frontend-1` container
(`docker ps` confirmed `Up 11 hours (healthy)` at session start) returned:

```
HTTP/1.1 307 Temporary Redirect
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=63072000; includeSubDomains
...
```

All four headers are genuinely served on live traffic, not just present in
a config file that might not be wired up correctly. Backend still carries no
`helmet` (confirmed: `grep -n "helmet" backend/package.json backend/src/main.ts`
→ no hits) — this was only ever a "consider" recommendation in the original
review, not a required fix, and remains an optional fast-follow.

### M-3 — Backend production dependency vulnerabilities — **CLOSED, fresh evidence**

`backend/package.json:31-36` confirmed this session:
`@nestjs/bullmq@^11.0.4`, `@nestjs/common@^11.1.28`, `@nestjs/config@^4.0.4`,
`@nestjs/core@^11.1.28`, `@nestjs/platform-express@^11.1.28`,
`@nestjs/throttler@^6.5.0`. Fresh `npm audit --prefix backend --omit=dev`
(run this session):

```json
{"vulnerabilities": {}, "metadata": {"vulnerabilities": {"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}}}
```

**Zero production vulnerabilities, confirmed independently** — down from the
original 12 (9 moderate, 3 high). The unscoped `npm audit --prefix backend`
(dev included) shows exactly one remaining item: `brace-expansion` (high,
dev-only, via the `eslint`/`jest` toolchain — the same package flagged on
the frontend side, confirmed via the same `npm ls` pattern), not reachable
in the production container.

**Express v5 default under NestJS v11, independently re-checked rather than
assumed low-risk:** `npm ls express` inside `backend/` resolves
`express@5.2.1` via `@nestjs/platform-express@11.1.28`. Fresh greps this
session for the three risk patterns the upgrade plan flagged:
`grep -n "setGlobalPrefix" backend/src/main.ts` → no hits (confirmed by
reading `main.ts` in full — no global prefix is set at all);
`grep -rn "getAllAndMerge" backend/src` → no hits;
`grep -rn "@(Get|Post|Patch|Delete|Put)\(" backend/src/modules backend/src/common --include="*.controller.ts" | grep -E "\*|\(:.*\?\)"` →
no hits. None of Express v5's breaking route-matching changes have any
surface to bite in this codebase — confirmed by exhaustive grep this
session, not carried forward from the pre-upgrade plan's own prediction.

The full backend unit suite (719 tests, including `admin.guard.spec.ts`,
which directly exercises the M-1 fix) and the byte-identity e2e suite
(28 tests) both re-ran green this session on the current Express v5 /
NestJS v11 tree — see "Test suites re-run fresh" below.

---

## New findings from this fresh pass

### MEDIUM

#### M-4 — `CommerceConversionService.create()` has no server-side `periodEnd >= periodStart` guard — raw HTTP 500 on invalid input, live-reproduced

**This is the third occurrence of the exact defect class QA found twice in
Phase 7** (`BUG-7A-01` in `paid-campaign.service.ts`, `BUG-7B-01` in
`paid-performance.service.ts` — both "date-range field pair validated only
by a DB `CHECK` constraint, with no application-layer guard, so a violating
request reaches Postgres and comes back as an unhandled exception instead
of a clean `400`"). `memory.md`'s own Phase 7B closing note states the
lesson explicitly: *"เวลา fix ไฟล์หนึ่งต้องเช็ค sibling service ที่มี
field-shape เหมือนกันด้วยเสมอ"* (when fixing one file, always check sibling
services with the same field shape). The Phase 7C.4 System-Analyst
re-verification did apply this lesson — but scoped its CHECK-constraint
sweep to the 11 constraints in the **Phase 7** migration only ("ไล่ CHECK
constraint ทั้ง 11 ตัวใน migration ทีละตัว ไม่เจอเพิ่ม", `errorlog.md`).
`CommerceConversion.periodStart`/`periodEnd` carries an **identical**
`CHECK ("period_end" >= "period_start")` constraint, but it lives in the
**Phase 6** commerce migration
(`prisma/migrations/20260721000000_phase6_commerce/migration.sql:371`),
outside that sweep's scope — so the third sibling was never checked.

**Evidence, gathered directly this session:**

- `backend/src/modules/commerce/dto/create-conversion.dto.ts:40-44` —
  `periodStart`/`periodEnd` each carry only `@IsDateString()`; no
  cross-field validator exists anywhere in the DTO.
- `backend/src/modules/commerce/commerce-conversion.service.ts:33-101`
  (`create()`) — reads `dto.periodStart`/`dto.periodEnd` directly into the
  Prisma `create()` call at lines 71-72 with **no call to any
  `assertValid*Range`-style guard** anywhere in the method or file (`grep -n
  "assertValidDateRange\|assertValidPeriodRange" backend/src/modules` only
  matches the two Paid-module files — `commerce-conversion.service.ts` has
  no equivalent).
- `backend/src/common/filters/redacting-exception.filter.ts:29-30` —
  confirmed by reading the filter directly: any non-`HttpException` (which
  is exactly what an unmapped Postgres `CHECK` violation surfaces as through
  Prisma) is mapped to `HttpStatus.INTERNAL_SERVER_ERROR` with a generic
  `"Internal server error"` client message — this is the same mechanism
  that produced the raw 500s in BUG-7A-01/7B-01.
- **Live reproduction against the running stack** (`content-hub-backend-1`,
  confirmed `Up ... (healthy)`): logged in as the seeded admin, fetched a
  live CSRF token, then:

  ```
  POST /api/commerce/conversions
  {"channel":"shopee","periodStart":"2026-07-10","periodEnd":"2026-07-01","commissionAmount":100.00}

  → HTTP 500
  {"success":false,"statusCode":500,"message":"Internal server error",
   "path":"/api/commerce/conversions","timestamp":"2026-08-02T01:18:46.327Z"}
  ```

  A sanity check with a valid range (`periodStart` before `periodEnd`)
  against the same endpoint, same session, immediately after, returned a
  clean `201` with the created row — isolating the defect precisely to the
  missing range check, not some other endpoint fault.

**Contrast — the same pattern correctly guarded elsewhere**, confirmed this
session: `backend/src/modules/content/content.service.ts:183` throws
`BadRequestException('targetAgeMin must be less than or equal to
targetAgeMax')` before ever reaching Prisma for the `Content.targetAgeMin/Max`
`CHECK` constraint. `paid-campaign.service.ts` and `paid-performance.service.ts`
both correctly guard their date-range fields post-fix. Every other `CHECK`
constraint in the Commerce and Paid migrations was independently re-checked
this session against its application-layer enforcement (self-reference
checks on `reversalOfId`/`correctsEntryId` are structurally unreachable at
insert time by the code's own logic, `@MaxLength`/`@Min`/`@Max` DTO
decorators cover the length/non-negativity constraints, currency is
server-set not client-supplied) — **`CommerceConversion.periodStart/periodEnd`
is the only unguarded one found**, not a symptom of a wider systemic gap.

**Exploit / impact scenario:** any admin (the system's only user role) who
enters a statement period backwards while hand-transcribing a payout
statement — a plausible data-entry slip, not a crafted attack — gets an
opaque `"Internal server error"` instead of a clear validation message
telling them which field is wrong. This is a reliability/robustness defect,
not a privilege-escalation or data-exposure one: the DB `CHECK` constraint
still prevents the bad row from ever being persisted, and the exception
filter's redaction means no stack trace or internal detail reaches the
client. Severity is Medium rather than High because of that backstop, but it
is a genuine, live-reproduced defect that will confuse the one admin user
and generate unhandled-exception log noise (an ERROR-level stack trace) on
every occurrence — exactly the kind of noise `errorlog.md`'s own Phase 2
carry-forward note already flagged as an operational concern for expected
failure paths.

**Recommended fix:** add an `assertValidPeriodRange`-style guard to
`CommerceConversionService.create()`, mirroring
`PaidPerformanceService.assertValidPeriodRange` almost exactly (same field
shape: `periodStart`/`periodEnd`, both `Date`). This is Bug-Fixer-sized, not
System-Analyst- or Designer-sized — same class of fix as BUG-7A-01/7B-01,
which took a same-day turnaround each. Given this is now the third instance,
also worth a fast follow-up: a shared validation helper both modules could
call, rather than three independent hand-copies of the same range check,
so a fourth sibling occurrence (if one is ever added) fails to compile
rather than silently missing the pattern again.

---

## Disposition of original Low / Informational findings

| ID | Original finding | Status this session |
|---|---|---|
| **L-1** | No `/api/health` HTTP endpoint (`DEVOPS-3`) | **Still open.** Fresh `grep -rln "health" backend/src/modules backend/src/app.module.ts backend/src/main.ts` this session again returns only the internal BullMQ `system-health.processor.ts` — no HTTP route. Unchanged. |
| **L-2** | PDPA retention endpoints exist but have no scheduled trigger | **Still open.** Fresh `grep -rn "@Cron\|CronExpression\|node-cron"` across `backend/src/common/audit` and `backend/src/modules/comments` this session returns nothing. Both retention endpoints remain manual-POST-only; the underlying logic itself re-ran correctly again this session (`npm test` output includes the same live "Audit retention: anonymized 3/2 attempted identifier(s)" lines as the original review). |
| **L-3** | No global `APP_GUARD`; every controller must declare its own `@UseGuards` | **Still open**, and this session's own fresh 17-controller sweep (see M-1 close-out above) is itself independent, current evidence that the pattern is being correctly followed everywhere *today* — but the structural backstop L-3 recommends still does not exist. `grep -n "APP_GUARD" backend/src/app.module.ts` → no hits, confirmed fresh. |
| **I-1** | `next` pinned with caret range, so the vulnerable version was pulled in by ordinary `npm install`, not a stale lockfile | **Evolved, not closed.** `frontend/package.json` now pins `"next": "^15.5.22"` — still a caret range. The specific stale-version risk I-1 flagged is gone (15.5.22 already includes every H-1 CVE fix), but the informational point itself (a caret range means the exact resolved version can drift upward within `npm install` without an explicit developer action) remains structurally true going forward. |
| **I-2** | Login rate limit and account-lockout windows both use matching 15-minute windows | **Still true, re-confirmed fresh.** `auth.controller.ts:12` (`LOGIN_RATE_LIMIT = { default: { limit: 5, ttl: 15 * 60 * 1000 } }`) and `auth.service.ts:7-8` (`MAX_FAILED_ATTEMPTS = 5`, `LOCKOUT_DURATION_MS = 15 * 60 * 1000`) read directly this session — no drift. |
| **I-3** | `ConnectedAccountsController`'s OAuth routes carry no `ThrottlerGuard` | **Still true, re-confirmed fresh** by the full file read performed for the M-1 close-out above — `authorize`/`callback`/`googleAuthorize`/`googleCallback`/`disconnect` carry no `ThrottlerGuard` anywhere. Unchanged from the original review's low-priority assessment (OAuth `state` already provides CSRF-equivalent protection; this remains the established DELETE-route pattern elsewhere too). |

---

## Re-confirmed as already-solid (fresh this session, not restated)

- **Full test suites, re-run fresh this session, all green, all reproducing
  the exact pre-upgrade counts:**
  - Separation suite: `npx jest testing/separation` → **6 suites, 59 tests,
    all passed.**
  - Backend unit suite: `npm test` → **64 suites, 719 tests, all passed**
    (including live-observed retention-service log lines, confirming those
    services still execute correctly under the new NestJS/Express versions).
  - Frontend unit suite: `npx jest` → **10 suites, 169 tests, all passed.**
  - Byte-identity e2e suite: `prisma migrate deploy` against
    `content_hub_e2e` (11 migrations, already current, no-op) then
    `npm run test:e2e` → **2 suites, 28 tests, all passed**
    (`paid-unaffected-by-payout-and-commerce.e2e-spec.ts`,
    `payout-unaffected-by-commerce.e2e-spec.ts`) — the payout ↔ commerce ↔
    paid separation still holds byte-for-byte after both major framework
    bumps.
- **No hardcoded secrets**: fresh `git grep -nIE
  "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][A-Za-z0-9+/_\-]{16,}['\"]"`
  across all tracked source files this session → zero hits. `.env` still
  untracked (`git ls-files | grep -E "^\.env$|/\.env$|\.env\.local$"` → no
  hits).
- **No XSS bypass**: fresh `grep -rn "dangerouslySetInnerHTML" frontend/src`
  → zero matches.
- **No raw SQL in production code**: fresh `grep -rln "queryRaw\|executeRaw"
  backend/src/modules` → only `prisma.service.ts` (a comment banning the
  unsafe variants), unchanged.
- **No new privilege-escalation path**: fresh `grep -rn "user.create"`
  across `backend/src/modules` (excluding specs) → no hits outside
  `prisma/seed.ts`. The single-admin invariant still holds structurally.
- **CSRF still applied on every mutating route** across all 17 controllers
  (verified as part of the M-1 sweep above) — no regression from the
  Express v5 default.
- **`ThrottlerModule` registrations unchanged**: still exactly the four
  modules that need it — `auth`, `comments`, `commerce`, `publish` — fresh
  `grep -rln "ThrottlerModule" backend/src/modules` confirms no new/missing
  registration.
- **Session cookie, CORS, `ValidationPipe`, boot-refusal guards**: all
  re-read directly in `main.ts` this session (see M-3 close-out) — no
  observable drift from the original review's characterization.

---

## Before you flip `NODE_ENV=production` — updated checklist

Carried forward from the original review, with items 1–2 now closed and
item 12 added.

1. ~~Upgrade Next.js off 14.2.35~~ — **DONE.** Now on 15.5.22; verify no
   further Next.js 15.x patch has shipped with a new CVE before go-live
   (`npm audit --prefix frontend` takes seconds to re-check).
2. ~~Upgrade backend `@nestjs/platform-express`/`multer`/`express`~~ —
   **DONE.** `npm audit --prefix backend --omit=dev` is 0/0/0/0 as of this
   session.
3. ~~Add `AdminGuard` to `ConnectedAccountsController`~~ — **DONE**,
   confirmed by fresh 17-controller sweep.
4. ~~Add the minimum security-header set to the frontend~~ — **DONE**,
   confirmed live via `curl -I` against the running container.
5. **(new, M-4)** Add a server-side `periodEnd >= periodStart` guard to
   `CommerceConversionService.create()`, mirroring the Paid module's
   already-shipped fix pattern — cheap, same-day fix, but should land
   before UAT since it is a live-reproduced, user-triggerable crash path.
6. Generate fresh `SESSION_SECRET` and `APP_ENCRYPTION_KEY` for production
   — do not reuse dev/demo values (unchanged from original checklist item 5).
7. Set `NODE_ENV=production` behind real TLS termination (unchanged, item 6).
8. Set `CORS_ORIGIN` to the real production origin(s); rebuild the frontend
   image with the real `NEXT_PUBLIC_API_BASE_URL` (unchanged, item 7).
9. Rotate Postgres credentials off the `content_hub`/`content_hub` demo
   default (unchanged, item 8).
10. Set up and test-restore a Postgres backup at least once (unchanged,
    item 9).
11. **(L-2, still open)** Wire the two PDPA retention endpoints to an actual
    scheduled job (unchanged, item 10).
12. **(L-1, still open)** Add a real `/api/health` HTTP endpoint (unchanged,
    item 11).
13. Fill in `docs/meta-app-review-status.md`'s blank fields (unchanged,
    item 12).
14. If flipping any `PUBLISHER_IMPL_*`/`COMMERCE_IMPL_*`/`PAID_IMPL_META`
    flag to a live value in production, confirm intentionally — `main.ts`
    only warns, not blocks, once `NODE_ENV=production` (unchanged, item 13,
    re-confirmed still true by direct read of `main.ts` this session).
15. **(new)** Re-run `npm audit` in both `frontend/` and `backend/`
    immediately before the production build — `next`'s bundled
    `postcss`/`sharp` residual findings (accepted risk today, since
    `next/image` is unused) should be re-checked against whatever Next.js
    15.x patch is current at go-live time, since Next.js's own bundled
    dependency versions move independently of this app's `package.json`.

---

**Prepared by:** System Analyst, Loop Engineering Position #3 — fresh
full-system re-run, independent of the original review's own findings
except where explicitly cited for comparison.
**Scope:** full-system pre-production security review #2, Phases 1–7 plus
both post-review dependency upgrades.
**Date:** 2026-08-02

# Pre-Production Security Review — Content Hub

**Scope:** full-system STRIDE + OWASP Top 10 pass across the entire shipped
codebase (Phases 1–7, all closed), commissioned ahead of promotion to UAT and
production. This is not a re-review of any single phase — it is a fresh,
adversarial pass across every module, cross-referenced against every prior
System Analyst sign-off (`docs/phase6c-system-analyst-signoff.md`,
`docs/phase7c-system-analyst-signoff.md`, `docs/security-decisions.md`,
`bussiness_rule.md`, `errorlog.md`, `memory.md`, `SETUP-CHECKLIST.md`) so this
review adds new value rather than re-treading confirmed ground.

**Verification method:** direct reads of `backend/src/modules/auth/**`,
`backend/src/common/guards/**`, `backend/src/main.ts`,
`backend/src/config/**`, every controller under `backend/src/modules/**`
(`@Post`/`@Patch`/`@Delete`/`@Put` decorator sweep against applied guards),
`TokenEncryptionService`, upload/storage code, `frontend/src/lib/api-client.ts`,
`next.config.mjs`; full-repo greps for raw SQL, `dangerouslySetInnerHTML`,
and hardcoded secrets; live re-runs (this session, 2026-08-01) of the
separation test suite (6 suites/59 tests), the full backend suite (64
suites/719 tests), the full frontend suite (10 suites/169 tests), and the
byte-identity e2e suite against a real disposable `content_hub_e2e` Postgres
database (2 suites/28 tests) — all genuinely green, not taken on report;
`npm audit` run fresh in both `backend/` and `frontend/`.

---

## Executive summary

**Verdict: READY FOR UAT WITH CONDITIONS.**

The application-layer security architecture (authentication, session
handling, CSRF, authorization, input validation, injection defenses, token
encryption, PDPA controls, boot-time safety guards) is genuinely solid and
consistently applied — this matches the track record described in the prior
System Analyst sign-offs, and this pass independently re-verified rather than
merely restated that track record. No Critical findings. The conditions
below are concentrated in two places neither prior phase gate scoped: **the
dependency supply chain** (never audited before this pass) and **one
authorization inconsistency** on a controller outside the pattern every other
controller follows. Both are fixable without architectural change and neither
requires new design work — they are Bug Fixer-sized, not System Analyst- or
App Designer-sized.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 3 |
| Low | 3 |
| Informational | 3 |

None of the High/Medium findings were previously flagged in any phase gate
document, `errorlog.md`, or `memory.md` — they are genuinely new, surfaced by
this pass's whole-system (rather than per-phase) lens and by running `npm
audit`, which no prior gate did.

---

## Findings by severity

### HIGH

#### H-1 — Frontend ships Next.js 14.2.35, with six unfixed HIGH-severity CVEs including pre-authentication attack surface

`frontend/package.json:18` pins `"next": "^14.2.18"`; the installed resolved
version is `14.2.35` (`npm ls next`). `npm audit --prefix frontend` (run
fresh this session) reports:

```
6 high severity vulnerabilities
fix available via `npm audit fix --force`
Will install next@16.2.12, which is a breaking change
```

The six advisories are not cosmetic — several are exploitable **before any
Content Hub authentication happens**, because they live in the Next.js
request-handling layer itself, which fronts every request to this
admin-only app:

- **HTTP request smuggling in rewrites** (GHSA-ggv3-7p47-pfv8)
- **SSRF in Server Actions / rewrites via attacker-controlled destination
  hostname** (GHSA-89xv-2m56-2m9x, GHSA-p9j2-gv94-2wf4)
- **SSRF via WebSocket upgrades** (GHSA-c4j6-fc7j-m34r)
- **Unauthenticated disclosure of internal Server Function endpoints**
  (GHSA-955p-x3mx-jcvp)
- **Cross-site scripting in App Router applications using CSP nonces**
  (GHSA-ffhc-5mcf-pf4q) — notable because it defeats the exact mitigation
  recommended in finding M-2 below
- **XSS in `beforeInteractive` scripts with untrusted input**
  (GHSA-gx5p-jg67-6x7h)
- Multiple **Denial of Service** vectors: Server Components
  (GHSA-q4gf-8mx6-v5v3, GHSA-8h8q-6873-q5fj), Image Optimization API
  (GHSA-h64f-5h5j-jqjh), Server Actions in the Edge runtime
  (GHSA-4c39-4ccg-62r3), and unbounded `next/image` disk cache growth
  (GHSA-3x4c-7xq6-9pq8)
- Multiple **cache-poisoning** vectors (GHSA-3g8h-86w9-wvmq,
  GHSA-vfv6-92ff-j949, GHSA-wfc6-r584-vfw7, GHSA-68g3-v927-f742,
  GHSA-4633-3j49-mh5q)
- **Middleware/Proxy bypass in Pages Router applications using i18n**
  (GHSA-36qx-fr4f-26g5)

**Exploit scenario:** the Next.js server process is the first thing that
receives every inbound HTTP request, before Content Hub's own
authentication/authorization code (which lives entirely in the NestJS
backend, reached only after the frontend has rendered a page or proxied a
call) ever runs. An attacker does not need a valid admin session to reach
the request-smuggling, SSRF, or DoS surfaces — they are properties of the
Next.js HTTP server itself. This is a materially different risk class from
"an authenticated admin could misuse a feature," which is the risk class
most other findings across this project's history have been in.

**Recommended fix:** upgrade to a patched Next.js release. `npm audit`
resolves this via `next@16.2.12` (a major version bump from 14→16, flagged
breaking) — evaluate whether a smaller within-14.x or 15.x patched release
closes the same CVEs with less migration risk before committing to the
16.x jump; either way this should not ship to production on 14.2.35.

---

### MEDIUM

#### M-1 — `ConnectedAccountsController` is the one controller in the codebase without `AdminGuard`

`backend/src/modules/connected-accounts/connected-accounts.controller.ts:33-34`
declares only `@Controller('api/connected-accounts')` with **no class-level
`@UseGuards`**; every route is individually annotated with
`@UseGuards(SessionAuthGuard)` only (`list` at line 44, `authorize` at line
50, `callback` at line 58, `googleAuthorize` at line 72, `googleCallback` at
line 81), and the mutating `DELETE :id` route at line 160-161 is
`@UseGuards(SessionAuthGuard, CsrfGuard)` — still no `AdminGuard`.

I swept every controller in `backend/src/modules/**` for `@Controller` /
`@UseGuards` / `@Post`/`@Patch`/`@Delete`/`@Put` (full results below, in the
"re-confirmed as solid" section). Every other controller — `content`,
`publish`, `ranking`, `metrics`, `dashboard`, `scheduler`, `reports`,
`comments`, `comment-templates`, `commerce` (all five controllers), `paid` —
declares `@UseGuards(SessionAuthGuard, AdminGuard)` at the class level, so
every route including every mutating one sits behind both authentication
*and* the DB-truth authorization re-check. `ConnectedAccountsController` is
the single exception.

`AdminGuard`'s own docblock
(`backend/src/common/guards/admin.guard.ts:12-20`) states this is
deliberate, forward-looking hardening: *"this guard deliberately does NOT
take a shortcut of 'any authenticated session is authorized' — it re-reads
the user's role from the database on every request... That keeps the check
meaningful... the moment a second role is introduced, rather than needing
every call site rewired at that point."* `ConnectedAccountsController` is
exactly the call site that was missed.

**Why this doesn't fire today:** I confirmed there is no user-creation
endpoint anywhere in the codebase (`grep -rn "user.create"` across
`src/modules` returns nothing outside `prisma/seed.ts`), so the single-admin
invariant holds structurally right now — there is no second, non-admin user
who could exploit the gap. This is not an active vulnerability.

**Why it's still a real finding, not noise:** it is a genuine inconsistency
in a security-critical area — the controller that manages OAuth
connect/disconnect and controls which platform accounts the system can post
to and pull revenue data from — and it is exactly the kind of gap the rest
of the codebase's own `AdminGuard` docblock says it exists to prevent from
being "retrofitted later under pressure once there are multiple users." If a
second user account is ever created by any future feature (or directly via
DB access during an incident), that user could connect/disconnect
Facebook/Google accounts (`SessionAuthGuard` alone, no role check) without
being flagged by any of this system's own architectural conventions, because
this one controller doesn't enforce the convention the rest of the system
relies on.

**Recommended fix:** add `AdminGuard` to the class-level `@UseGuards` on
`ConnectedAccountsController`, matching every other controller's pattern.
Verify the OAuth callback flow still works after the change — the callback
routes read `userId` from the session the same way every other AdminGuard'd
route does, so this should be a mechanical, low-risk fix, but re-run the
OAuth connect/disconnect flow against a live stack after applying it.

#### M-2 — No security headers configured anywhere (frontend or backend)

`frontend/next.config.mjs` contains only `reactStrictMode: true` — no
`headers()` function, no Content-Security-Policy, no
`X-Frame-Options`/`frame-ancestors`, no `X-Content-Type-Options`, no
`Strict-Transport-Security`, no `Referrer-Policy`. There is no
`middleware.ts` in the frontend app (`find frontend -maxdepth 2 -iname
"middleware*"` returns nothing) that could be setting these another way.
The backend has no `helmet` (or equivalent) middleware in
`backend/src/main.ts` or as a dependency (`grep -n "helmet"
package.json src/main.ts` returns nothing) and sets no security response
headers of its own.

**Why this matters now specifically:** finding H-1 above includes an XSS
CVE that is exploitable *even with* CSP nonces
(GHSA-ffhc-5mcf-pf4q) — but that CVE assumes a CSP nonce setup exists to
defeat in the first place. Today there is no CSP at all, which is a weaker
starting position, not a stronger one: any XSS-class bug anywhere in the
React tree (including ones introduced by a future dependency, not just
first-party code — React's own escaping is confirmed intact today, see
"re-confirmed as solid" below) has no CSP backstop. Similarly, the complete
absence of `X-Frame-Options`/`frame-ancestors` means the admin login page
and every authenticated screen can be framed by an arbitrary third-party
site, enabling clickjacking against the single admin account.

**Recommended fix:** add a `headers()` function to `next.config.mjs` (or a
`middleware.ts`) setting at minimum `X-Frame-Options: DENY` (or
`frame-ancestors 'none'` via CSP), `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, and
`Strict-Transport-Security` (once HTTPS is live per SETUP-CHECKLIST §5.1). A
Content-Security-Policy is worth scoping but is more involved for a Next.js
App Router site (inline scripts, hydration) — track it as a fast-follow if
it can't land before UAT, but the header trio above is cheap and should not
wait.

#### M-3 — Backend's own direct production dependencies carry real vulnerabilities, including one in the exact file-upload path this review scrutinized

`npm audit --prefix backend` (fresh run, this session) reports 26
vulnerabilities total, but unlike a typical dev-tooling-only result, several
sit in **direct, production runtime dependencies** — not only the
`@nestjs/cli`/`@angular-devkit`/`webpack`/`inquirer` build-tooling chain
(which is legitimately dev-only and lower priority):

- **`@nestjs/platform-express`** (HIGH, direct dependency) — pulls in
  vulnerable `body-parser`, `express`, and **`multer`**. The `multer`
  advisories are "Denial of Service via incomplete cleanup" and "Denial of
  Service via resource exhaustion" — `multer` is the exact library
  `content.controller.ts:93` uses (`FileInterceptor('file')`) for the
  upload endpoint this review examined in detail (§ "File upload handling,"
  re-confirmed solid below). The upload code itself is well-defended
  (magic-byte sniffing, allow-list, size caps, path-traversal-proof
  filenames), but a DoS in the multipart-parsing library sits underneath all
  of that defense and is not something application code can patch around.
- **`@nestjs/core`** (MODERATE, direct dependency) — "Improperly Neutralizes
  Special Elements in Output Used by a Downstream Component ('Injection')."
- **`body-parser`**, **`express`**, **`qs`** (MODERATE, transitive via the
  above) — DoS-class advisories (invalid `limit` value silently disabling
  size enforcement; `qs.stringify` crash on malformed comma-format arrays).

Scoped to production dependencies only, this is **12 vulnerabilities (9
moderate, 3 high)** — `npm audit --prefix backend --omit=dev` confirms the
same `multer`/`@nestjs/platform-express`/`qs`/`express` chain remains after
excluding devDependencies. The remaining 14 (of the unscoped 26) are
genuinely dev-tooling-only (`@nestjs/cli`, `@angular-devkit/*`, `inquirer`,
`glob`, `webpack`, `tmp`, `external-editor`, `picomatch`, `ajv`,
`brace-expansion`) and are materially lower priority since they never run in
the production container.

**Recommended fix:** run `npm audit fix` (non-force) first to pick up any
non-breaking patches; for the remainder, plan a `@nestjs/platform-express`
(and transitively `multer`/`express`/`body-parser`) version bump — check the
NestJS changelog for the minimum version that resolves the advisory before
jumping to whatever `--force` selects, since `npm audit fix --force` may
select a NestJS major version bump when a minor patch release would suffice.

---

### LOW

#### L-1 — `DEVOPS-3` (no `/api/health` HTTP endpoint) is still open

Confirmed still true this session: `grep -rln "health" backend/src/modules
backend/src/app.module.ts backend/src/main.ts` finds only
`queue/processors/system-health.processor.ts` (an internal BullMQ job, not
an HTTP route) — no `@Get('health')` or equivalent exists anywhere. This was
flagged as `DEVOPS-3` at the Phase 6.0 gate (`errorlog.md`) and carried
forward through every subsequent phase without being closed. Not a security
vulnerability per se, but directly relevant to production readiness: without
an HTTP health endpoint, any orchestrator (load balancer health check,
Kubernetes readiness probe, uptime monitor) can only TCP-connect-check the
port, which confirms the process is listening but not that the database or
Redis connections it depends on are actually healthy. Restated here because
it belongs in the pre-production checklist, not because this pass found
anything new about it.

#### L-2 — PDPA retention/anonymization policies exist but have no scheduled trigger

Both implemented retention controls are real and correctly implemented in
code (re-confirmed this session, see "re-confirmed as solid" below), but
**both are manual-trigger-only, with no cron**:

- `POST /api/comments/retention/purge` (12-month comment hard-delete,
  `CommentRetentionService.purgeExpired`)
- `POST /api/audit-logs/retention/anonymize` (90-day `auth.login.failure`
  actor anonymization, `AuditRetentionService.anonymizeExpiredActors`) — I
  ran the full backend test suite this session and observed this service
  execute live against seeded fixture data: `"Audit retention: anonymized 3
  attempted identifier(s) older than 90 days"` and `"...anonymized 2
  attempted identifier(s)..."` in two separate specs, confirming the logic
  itself works correctly when invoked.

This is already tracked as an open item
(`SETUP-CHECKLIST.md` §6.1: *"ตั้ง cron ให้รันอัตโนมัติ (ตอนนี้ manual —
อยู่ในชุด cron ที่ defer ไว้ร่วมกับ metrics/comment sweep)"*), so this is not
a new discovery — it is restated here because a retention *policy* that
exists in code but never actually runs unless an admin remembers to call it
is not a retention policy that is actually being honored in practice, and
that gap is squarely relevant to a pre-production PDPA readiness checklist.

#### L-3 — No global default guard; every controller must remember its own `@UseGuards`

`backend/src/app.module.ts` registers no `APP_GUARD` provider (checked via
`grep -n "APP_GUARD" src/app.module.ts` — no hits), meaning there is no
system-wide default authentication/authorization baseline. Every single
controller must correctly declare its own `@UseGuards(...)` for the system
to be safe; there is no fail-closed backstop if a future controller is added
without one. This pattern is what allowed finding M-1 to exist undetected —
NestJS's per-controller guard model is standard and this pass found it
correctly applied everywhere except the one controller in M-1, so this is
not "the codebase got this wrong" so much as "the codebase's chosen pattern
has no structural backstop." Worth considering a global `APP_GUARD`
baseline (e.g., `SessionAuthGuard` applied everywhere by default, with an
explicit `@Public()` decorator opt-out for the few genuinely public routes
like `POST /api/auth/login`) as a defense-in-depth improvement in a future
phase — not blocking for UAT, since the current sweep found the pattern
correctly applied with one now-flagged exception.

---

### INFORMATIONAL

- **I-1** — `frontend/package.json` pins `next` with a caret range
  (`^14.2.18`), meaning the exact vulnerable version currently resolved
  (`14.2.35`) was pulled in by ordinary `npm install` within the already-
  permitted range, not by an unusually old lockfile. This makes H-1 an
  active, current-state finding, not a stale-dependency artifact.
- **I-2** — The login rate limit (`AuthController`, `LOGIN_RATE_LIMIT = {
  limit: 5, ttl: 15 * 60 * 1000 }`) and the account-lockout window in
  `AuthService` (`MAX_FAILED_ATTEMPTS = 5`, `LOCKOUT_DURATION_MS = 15 * 60 *
  1000`) use matching 15-minute windows — confirmed consistent, no drift
  between the two independent brute-force defenses.
- **I-3** — `ConnectedAccountsController`'s OAuth `authorize`/`callback`
  routes and the `DELETE :id` disconnect route carry no `ThrottlerGuard`
  (unlike every password-carrying or otherwise sensitive endpoint
  elsewhere). Given these routes don't carry a password and OAuth `state`
  already provides CSRF-equivalent protection on the callback, this is
  low-priority on its own, but note it if M-1 is fixed by adding
  `AdminGuard` — worth a five-minute check on whether the disconnect route
  in particular should also get `ThrottlerGuard` for consistency with the
  DELETE routes elsewhere (e.g. `content.controller.ts`'s deletes do not
  throttle either, so this may simply be the established pattern for
  non-password DELETEs — confirmed consistent, not flagging as a gap on its
  own).

---

## Re-confirmed as already-solid

The following were independently re-verified in this pass — not restated
from a prior document without checking. Where a prior sign-off already
covered the same ground, I cite it and say what I personally re-checked
beyond what it claimed.

### Authentication & session security

- **Argon2id password hashing**, default cost params
  (`m=65536,t=3,p=4` — read directly off the `DUMMY_HASH` literal in
  `auth.service.ts:19` and confirmed `prisma/seed.ts:149` uses the same
  `argon2id` type with no cost override, so it inherits the same library
  defaults). Not previously stated explicitly in any prior doc I found —
  new confirmation.
- **Indistinguishable login failures** — re-read
  `auth.service.ts:48-97` line by line: the dummy-hash timing-safe
  comparison, the identical `UnauthorizedException(GENERIC_LOGIN_ERROR)` on
  all three failure branches (not-found/locked/wrong-password), confirmed
  matching `docs/security-decisions.md` §3's original design exactly, no
  drift.
- **Session cookie config** (`main.ts:32-50`): `httpOnly: true`,
  `secure: appConfig.nodeEnv === 'production'` (genuinely conditional on
  `NODE_ENV`, not a hardcoded `false`), `sameSite: 'lax'`, Redis-backed
  store on its own logical DB (separate from BullMQ's), `rolling: true`
  (sliding TTL). Read the literal object, not a description of it.
- **Session-fixation defense** — `auth.controller.ts:37`,
  `request.session.regenerate()` called before writing `userId`, confirmed
  present and ordered correctly (matches `security-decisions.md` §1).
- **CSRF** — read `csrf.guard.ts` in full: compares a session-stored token
  against the `x-csrf-token` header, throws on any mismatch/absence. Then
  independently swept **every** controller in `backend/src/modules/**` for
  `@Post`/`@Patch`/`@Delete`/`@Put` decorators against applied guards (not
  just the modules individually reviewed at prior gates) — full sweep
  results:

  | Controller | Class guards | Every mutating route also has `CsrfGuard`? |
  |---|---|---|
  | `auth.controller.ts` | (per-method; login is pre-auth by design) | N/A — login has no session yet; logout is idempotent-safe, no state written on double-call beyond destroying an already-destroyed session |
  | `comment-templates.controller.ts` | `SessionAuthGuard, AdminGuard` | Yes (POST/PATCH/DELETE) |
  | `comments.controller.ts` | `SessionAuthGuard, AdminGuard` | Yes (sync/ack/purge/reply/delete) |
  | `commerce-catalog.controller.ts` | `SessionAuthGuard, AdminGuard` | Yes |
  | `commerce-conversion.controller.ts` | `SessionAuthGuard, AdminGuard` | Yes |
  | `commerce-placement.controller.ts` | `SessionAuthGuard, AdminGuard` | Yes |
  | `post-anchors.controller.ts` | `SessionAuthGuard, AdminGuard` | Yes |
  | `connected-accounts.controller.ts` | none at class level (see **M-1**) | Yes on the one mutating route (`DELETE`), but missing `AdminGuard` |
  | `content.controller.ts` | `SessionAuthGuard, AdminGuard` | Yes (create/upload/patch/delete/assets) |
  | `metrics.controller.ts` | `SessionAuthGuard, AdminGuard` | Yes |
  | `paid.controller.ts` | `SessionAuthGuard, AdminGuard` | Yes |
  | `publish/posts.controller.ts` | `SessionAuthGuard, AdminGuard` | Yes |
  | `ranking.controller.ts` | `SessionAuthGuard, AdminGuard` | Yes |
  | `scheduler.controller.ts` | `SessionAuthGuard, AdminGuard` | N/A — read-only |
  | `dashboard.controller.ts` / `commerce-summary.controller.ts` / `reports.controller.ts` | `SessionAuthGuard, AdminGuard` | N/A — all routes are `@Get` |

  **Result: CSRF is genuinely applied on every mutating route across every
  module**, with the OAuth callback's documented exception
  (`security-decisions.md` §2) being the only intentional gap, and it is
  correctly justified (state-parameter protection instead, since Meta's
  redirect can't carry a custom header).

- **Login rate-limiting**: `ThrottlerGuard` + `Throttle({ limit: 5, ttl: 15
  * 60 * 1000 })` on `POST /api/auth/login`, confirmed at
  `auth.controller.ts:22-25`.
- **Logout/session invalidation**: `request.session.destroy()`, confirmed
  correct.

### Authorization

- **`AdminGuard` re-reads role from the DB on every request** — read
  `admin.guard.ts:26-40` directly: `this.prisma.user.findUnique({ where: {
  id: userId } })` runs on every `canActivate()` call, no caching, no
  client-supplied claim trusted. Confirmed, not merely restated from the
  docblock's own claim about itself.
- **Every mutating endpoint has `AdminGuard` except one** — see **M-1**
  above; this is the one gap the full sweep found, not zero, but everywhere
  else is confirmed correct across all 16 controllers.
- **No privilege-escalation path exists**: confirmed there is no
  user-creation endpoint anywhere in the HTTP surface
  (`grep -rn "user.create"` across `src/modules` returns nothing outside
  `prisma/seed.ts`, which only runs at container boot, not over HTTP). The
  single-admin model is genuinely structurally enforced, not merely a
  convention nobody has violated yet.
- **Step-up re-authentication** — confirmed applied consistently to
  exactly the actions `bussiness_rule.md`/`security-decisions.md` require it
  for: publish confirmation (`publish-orchestrator.service.ts`), commerce
  manual-external placement recording (`commerce-placement.service.ts`),
  comment reply (`comment-reply.service.ts`), and comment retention purge
  (`comments.controller.ts:89-104`, called explicitly inside the handler).
  **Paid module deliberately has no step-up anywhere** — this is not a gap:
  it is a reasoned, already-confirmed System Analyst decision
  (`docs/phase7-system-analyst-signoff.md`, SA-P3, "CONFIRM the reasoning
  holds"), because every paid write is a descriptive record of something
  that already happened entirely outside Content Hub, with no live-platform
  write and no ranking-engine feedback loop — the same class of action that
  never required step-up for Commerce's read-only reporting either. I
  independently re-confirmed no `paid` service imports
  `StepUpAuthService` (`grep` across `src/modules/paid`) and that this
  keeps `PaidModule`'s import graph a clean leaf.

### Input validation & injection

- **Global `ValidationPipe`** confirmed genuinely applied in
  `main.ts:57-63`: `{ whitelist: true, forbidNonWhitelisted: true, transform:
  true }` — read the literal call, not a claim about it.
- **No raw SQL in production code**: `grep -rln "queryRaw\|executeRaw"
  backend/src/modules` returns only `prisma.service.ts`, which contains the
  string only inside a comment banning the unsafe variants — zero actual
  `$queryRaw`/`$executeRaw` call sites in any module's production code. The
  only real usages of `$queryRaw`/`$executeRaw` in the entire repo are in
  `backend/src/testing/**` (the e2e harness's disposable-database
  TRUNCATE/introspection helpers), and even there they use tagged-template
  `$queryRaw`/`$executeRaw` with `Prisma.raw` over a hardcoded constant
  list — never `$queryRawUnsafe`/`$executeRawUnsafe` with interpolated
  user input. The ESLint ban on the unsafe variants
  (`.eslintrc.cjs:43-49`, `no-restricted-syntax`) is confirmed live in the
  config, not just described in `security-decisions.md` §5.
- **No XSS bypass**: `grep -rn "dangerouslySetInnerHTML" frontend/src`
  (`--include="*.tsx" --include="*.ts"`) returns zero matches anywhere in
  the frontend. React's default escaping is not bypassed anywhere in this
  codebase.
- **File upload handling** (`content.controller.ts` +
  `upload-validation.service.ts` + `local-disk-storage.service.ts`):
  magic-byte sniffing (JPEG/PNG/MP4 signatures checked against the actual
  buffer, not client-supplied `Content-Type` or filename), a hard
  allow-list of exactly three types, per-category size ceilings enforced
  both at the Multer stream level (`content.module.ts`'s
  `MulterModule.registerAsync` limits) and again inside
  `UploadValidationService.validate()`, and — critically for path
  traversal — **the client-supplied original filename is never used
  anywhere**: `local-disk-storage.service.ts:34` generates
  `${randomUUID()}.${extension}` (extension itself only ever one of three
  server-resolved literals, never client input) and even then double-checks
  with `destination.startsWith(this.storageDir)` before writing. Path
  traversal and arbitrary file write are structurally impossible here, not
  merely filtered. (The underlying `multer` library itself does carry
  unpatched DoS advisories — see **M-3**, a supply-chain concern layered
  underneath this otherwise-solid application code, not a flaw in the code
  itself.)

### Secrets & credential handling

- Repo-wide grep for hardcoded secret-shaped strings
  (`git grep -nIE "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][A-Za-z0-9+/_\-]{16,}['\"]"`
  across all tracked `.ts`/`.tsx`/`.js`/`.json` files) and for common
  vendor key-format signatures (OpenAI `sk-`, Google `AIza`, GitHub `ghp_`,
  PEM private-key headers) returned **zero hits** anywhere in the tracked
  repository.
- **`.env` hygiene confirmed at the git level, not just by reading
  `.gitignore`**: `git ls-files | grep -E "^\.env$|/\.env$|\.env\.local$"`
  returns nothing — no `.env` file has ever been committed to this repo,
  and `git check-ignore -v` confirms `.env` (root), `backend/.env`, and
  `frontend/.env.local` are each actively matched by an ignore rule right
  now (root `.gitignore:6`, `backend/.gitignore:4`,
  `frontend/.gitignore:5` respectively).
- `.env.example` and `.env.docker.example` contain only placeholder values
  (`replace-with-...`, `demo-app-id-replace-me`) — confirmed by reading
  both files in full, no real credential leaked into either template.
- **`TokenEncryptionService`** (`token-encryption.service.ts`): AES-256-GCM,
  confirmed correct primitive usage — `createCipheriv`/`createDecipheriv`
  with a 12-byte IV and 16-byte auth tag, ciphertext format
  `base64(iv || authTag || ciphertext)`, key read once from
  `APP_ENCRYPTION_KEY` at `onModuleInit` and validated to be exactly 32
  bytes after base64-decode (throws `InternalServerErrorException`
  otherwise). The key is held only as a private `Buffer` field on this one
  service and is never written to any log statement anywhere in the file
  (confirmed by reading the file in full — the only `logger` calls are in
  the storage adapter, not this service).
- **`SESSION_SECRET`/`APP_ENCRYPTION_KEY` boot-refusal confirmed by reading
  the actual Joi schema**, not inferred: `env.validation.ts:20`
  (`SESSION_SECRET: Joi.string().min(32).required()`, no `.default(...)`)
  and `env.validation.ts:24` (`APP_ENCRYPTION_KEY: Joi.string().required()`,
  no default) — both genuinely refuse to boot if absent or too short;
  `TokenEncryptionService.onModuleInit()` adds a second independent check
  (exact-32-byte-after-decode) on top of the Joi validation.

### PDPA / data protection

- **Cross-cutting retention pass across all four data categories the task
  named** (Metric, Comment, Commerce, Paid):
  - **Metric**: I read the full `Metric` model
    (`prisma/schema.prisma:444-459`) — `postId`, `platform`, `reach`,
    `engagement`, `revenue`, `source`, two timestamps. No free-text column,
    no identifier that could hold personal data. Confirmed **no retention
    policy exists for Metric** (`grep -rn "retention" backend/src/modules/metrics`
    returns nothing) — and confirmed this is correct, not an oversight: a
    table with no PII-capable column needs no erasure/anonymization policy.
    This was not previously stated explicitly in any phase doc; it is a
    genuine new check with a genuine negative result, not an assumption.
  - **Comment**: 12-month hard-delete (`CommentRetentionService.purgeExpired`)
    plus a PDPA data-subject erasure endpoint (`eraseOne`) that hard-deletes
    a single comment on request and audits by hashed reference only
    (`redactCommentMeta`) — confirmed both exist and are wired to the
    controller with step-up on the bulk purge.
  - **Commerce**: `COMMERCE_ERASABLE_FREE_TEXT_COLUMNS` now lists all four
    columns the Phase 6C.4 sign-off flagged as missing —
    `commerce_conversions.statement_ref`, `commerce_placements.note`,
    **and** `affiliate_links.tracking_code` / `affiliate_links.sub_id`
    (`commerce.constants.ts:52-60`) — confirmed the 6C.4 fix (`37516c7` per
    `memory.md`) is genuinely present in the current tree, not just
    claimed in a commit message.
  - **Paid**: `PAID_ERASABLE_FREE_TEXT_COLUMNS` lists `ad_campaigns.objective`
    and `ad_performance_entries.source_ref` (`paid.constants.ts:54-60`),
    matching the Phase 7 gate's mandated shape exactly.
  - **Audit logs**: anonymize-in-place policy for `auth.login.failure`'s
    `actor` field after 90 days, confirmed implemented
    (`audit-retention.service.ts`, `audit-log.constants.ts`) and confirmed
    **working live** — this session's own full backend test run emitted
    `"Audit retention: anonymized 3 attempted identifier(s) older than 90
    days"` from real fixture data, not a mocked assertion.
- **`auth.login.failure` PII status — CLOSED, not open.** `errorlog.md`
  (Phase 5D.1 entry) records this as an open question handed to the System
  Analyst: *"เก็บ email ที่ผู้ใช้พิมพ์เข้ามา... นี่คือ personal data เพียง
  จุดเดียวในตารางนี้... ยกให้ System Analyst ตัดสินคู่กับข้อ 2."* The task
  brief for this review also describes it as "a known, still-open PDPA
  question." Having read `audit-log.constants.ts` directly, **this is
  resolved**: the 90-day anonymization policy specifically targets this
  exact field (`AUDIT_ACTIONS_WITH_ATTEMPTED_IDENTIFIER = ['auth.login.failure']`),
  is implemented, is tested, and was observed executing correctly this
  session. The only residual concern is **L-2** above — the policy has no
  scheduled trigger yet — which is a different, narrower, already-tracked
  gap, not the original open PII question.

### Production configuration readiness

- **`NODE_ENV=production` cookie behavior**: confirmed via literal read of
  `main.ts:45` — `secure: appConfig.nodeEnv === 'production'`, a genuine
  conditional, not a hardcoded value that happens to look conditional in a
  comment.
- **`assertAdapterFlagsAreSafe()` boot guard** — read the full function
  (`assert-adapter-flags-safe.ts:31-63`), not just its docblock: it collects
  every `PUBLISHER_IMPL_*`/`COMMERCE_IMPL_*`/`PAID_IMPL_META` flag that has
  resolved away from its safe default, and **throws** (refuses to boot) if
  any such flag is set while `NODE_ENV !== 'production'`; if `NODE_ENV ===
  'production'` it only **warns** to console rather than blocking — this
  asymmetry is intentional and correct (production is allowed to run live
  adapters; every other environment is not), confirmed by reading the
  branch logic directly rather than trusting the comment describing it.
- **`envValidationSchema`** (`env.validation.ts`) confirmed to require
  `CORS_ORIGIN` with no default (`Joi.string().required()`) — CORS is
  pulled from environment configuration, not hardcoded to `localhost`
  anywhere in `main.ts` (`app.enableCors({ origin:
  appConfig.corsOrigin.split(',')... })`).
- **Rate limiting sweep**: confirmed `ThrottlerModule.forRootAsync()` is
  independently registered in exactly the four modules that need it —
  `auth`, `comments`, `commerce`, `publish` — each guarding its own
  password-carrying or otherwise sensitive endpoints with `ThrottlerGuard`.
  **Paid correctly has no such registration**: it has no password-carrying
  endpoint (per the confirmed SA-P3 no-step-up decision above), so there is
  no "credential oracle" risk for a Paid-specific throttler to close —
  this was verified by reading `paid.module.ts` and `paid.controller.ts` in
  full, not assumed from the absence being convenient. No module was
  missed: `dashboard`, `metrics`, `ranking`, `scheduler`,
  `connected-accounts`, `content`, `reports` all correctly have no
  module-local `ThrottlerModule` because none of their routes carry a
  password either.

### Cross-module separation

- **Full separation test suite re-run fresh this session, genuinely green**:
  `npx jest testing/separation` → **6 suites, 59 tests, all passed**
  (`commerce-schema-freeze`, `enum-freeze`, `commerce-vocabulary-freeze`,
  `paid-no-live-http-client`, `csv-header-freeze`, plus the Phase 7
  additions layered into the same files) — this is a superset of the 5
  files/55 tests the Phase 7C.4 sign-off ran, because it also includes
  `paid-no-live-http-client.spec.ts`.
- **Full backend regression, re-run fresh**: `npm test` → **64 suites, 719
  tests, all passed** (the Phase 7D close-out in `memory.md` recorded
  719/719 on 2026-08-01; this session's independent re-run reproduces that
  exact count on the current tree).
- **Full frontend regression, re-run fresh**: `npx jest` → **10 suites, 169
  tests, all passed**.
- **Byte-identity e2e suite, re-run fresh against a real disposable
  database**: ran `prisma migrate deploy` against `content_hub_e2e`
  (11 migrations, already current, no-op), then `npm run test:e2e` →
  **2 suites, 28 tests, all passed**
  (`paid-unaffected-by-payout-and-commerce.e2e-spec.ts`,
  `payout-unaffected-by-commerce.e2e-spec.ts`), confirming the payout ↔
  commerce ↔ paid separation still holds byte-for-byte on the current
  shipped code, independently re-executed rather than taken on the prior
  sign-off's word.

---

## Before you flip `NODE_ENV=production` — checklist

Synthesized from `SETUP-CHECKLIST.md`'s existing admin action items plus
this review's new findings. Items marked **(new)** were not previously in
`SETUP-CHECKLIST.md`.

1. **(new, H-1)** Upgrade Next.js off 14.2.35 to a patched release before
   any production exposure — this is pre-authentication attack surface,
   higher priority than the items below.
2. **(new, M-3)** Run `npm audit fix` in `backend/`; plan the
   `@nestjs/platform-express`/`multer`/`express` upgrade path for the
   remainder.
3. **(new, M-1)** Add `AdminGuard` to `ConnectedAccountsController`.
4. **(new, M-2)** Add the minimum security-header set
   (`X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`,
   `Referrer-Policy`, `Strict-Transport-Security`) to the frontend; consider
   `helmet` on the backend.
5. Generate fresh `SESSION_SECRET` and `APP_ENCRYPTION_KEY` for production —
   **do not reuse the dev/demo values** (`SETUP-CHECKLIST.md` §1, already
   flagged there as a hard requirement, restated here because it's the
   single highest-blast-radius manual step in the whole checklist: reusing
   the dev key means every production OAuth token would be encrypted under
   a key that has already existed in a lower-trust environment).
6. Set `NODE_ENV=production` behind real TLS termination (reverse
   proxy/load balancer) — required for the session cookie's `Secure` flag
   to not silently break login (`SETUP-CHECKLIST.md` §5.1).
7. Set `CORS_ORIGIN` to the real production origin(s); rebuild the frontend
   image with the real `NEXT_PUBLIC_API_BASE_URL` (build-time, not
   runtime — `SETUP-CHECKLIST.md` §5.2 already flags this correctly).
8. Rotate Postgres credentials off the `content_hub`/`content_hub` demo
   default (`SETUP-CHECKLIST.md` §1.4).
9. Set up and **test-restore** a Postgres backup at least once
   (`SETUP-CHECKLIST.md` §5.3 — a backup that has never been restored is
   not a verified backup).
10. **(new, L-2)** Wire the two existing PDPA retention endpoints
    (`comment retention purge`, `audit-log anonymize`) to an actual
    scheduled job — the policies are correctly implemented but currently
    require a human to remember to call them.
11. **(new, L-1)** Add a real `/api/health` HTTP endpoint before relying on
    anything beyond a bare TCP healthcheck in production orchestration
    (`DEVOPS-3`, carried forward, still open).
12. Fill in `docs/meta-app-review-status.md`'s blank fields (Meta App ID,
    redirect URI registered, Data Use Checkup renewal date, on-call owner) —
    already flagged in `SETUP-CHECKLIST.md` §2.4, restated because it's the
    one item on that list an outage would surface at the worst possible
    time (OAuth breaking silently until Meta's periodic re-attestation is
    tracked).
13. If flipping any `PUBLISHER_IMPL_*`/`COMMERCE_IMPL_*` flag to a live
    value in production, confirm this is intentional — `main.ts` will only
    warn, not block, once `NODE_ENV=production` is set (by design, verified
    in this review), so there is no safety net beyond the admin's own
    judgment at that point.

---

**Prepared by:** System Analyst, Loop Engineering Position #3
**Scope:** full-system pre-production security review, Phases 1–7
**Date:** 2026-08-01

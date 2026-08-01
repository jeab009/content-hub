# Dependency Upgrade Plan — H-1 (Next.js) + M-3 (Backend production deps)

- **Source**: `docs/pre-production-security-review.md`, findings H-1 and M-3.
- **Trigger**: user directed "fix M-1 and M-2 now, hold on the dependency
  upgrades" (2026-08-01), then asked for this plan separately. This document
  plans the upgrade; it does not execute it — no dependency version has been
  changed by this document.
- **Research method**: read `package.json`/`package-lock.json` directly for
  current versions; ran `npm audit --json` in both `frontend/` and `backend/`
  and parsed the actual advisory `range`/`fixAvailable` fields (not just the
  human-readable summary) to find the true minimum fixed version per
  advisory; checked Node.js version in `Dockerfile`/`package.json engines`;
  web-searched current Next.js and NestJS migration guides for breaking
  changes. Findings below are traceable to a command or a cited source, not
  inferred.

---

## 1. Key finding that changes the recommended path

`npm audit fix --force` in `frontend/` proposes `next@16.2.12` because that's
the newest version satisfying every advisory — **not** the lowest one.
Parsing the raw advisory data shows every one of the 6 HIGH-severity Next.js
CVEs from H-1 has a fixed-version ceiling of **`<15.5.21`** or earlier:

| Advisory (from H-1) | Vulnerable range | Fixed at |
|---|---|---|
| HTTP request smuggling in rewrites | `>=9.5.0 <15.5.13` | 15.5.13 |
| SSRF in Server Actions (custom servers) | `>=14.1.1 <15.5.21` | 15.5.21 |
| SSRF in rewrites (attacker-controlled hostname) | `>=12.0.0 <15.5.21` | 15.5.21 |
| SSRF via WebSocket upgrades | `>=13.4.13 <15.5.16` | 15.5.16 |
| Unauthenticated disclosure of Server Function endpoints | `>=13.0.0 <15.5.21` | 15.5.21 |
| XSS in App Router with CSP nonces | `>=13.4.0 <15.5.16` | 15.5.16 |
| XSS in `beforeInteractive` scripts | `>=13.0.0 <15.5.16` | 15.5.16 |
| DoS: Server Components (×2 advisories) | `<15.5.15`, `<15.5.16` | 15.5.15/16 |
| DoS: Image Optimization API | `<15.5.16` | 15.5.16 |
| DoS: Server Actions, Edge runtime | `<15.5.21` | 15.5.21 |
| Cache poisoning (×4 advisories) | all `<15.5.16` or `<15.5.21` | 15.5.16–21 |
| Middleware/Proxy bypass (i18n, Pages Router — not used by this app) | `<15.5.16` | 15.5.16 |

**Every advisory closes by Next.js 15.5.21.** Recommendation: target
**Next.js 15.5.21+** (the latest 15.x at upgrade time), not 16. This closes
100% of H-1's findings while crossing one major version boundary instead of
two, and specifically avoids Next 16's additional breaking change on top of
15's (see §3) — strict HTML nesting validation, which silently breaks
hydration on patterns (nested anchors/buttons, table rows inside divs) that
15 does not enforce. There is no security reason to go to 16; it would be
adopted for framework features this admin-only, low-traffic app doesn't need,
at extra migration risk.

If a future dependency forces a 16 upgrade anyway (e.g., a library dropping
15.x support), re-run this same audit-range check before assuming another
forced major jump is the only path — the same "audit picks newest, not
lowest-fixed" gap could recur.

---

## 2. Frontend track — Next.js 14.2.35 → 15.5.21+

### 2.1 What breaks (Next.js's own migration guidance, both 14→15 and the
already-required React bump)

1. **Async Request APIs (breaking in 15, mandatory)** — `cookies()`,
   `headers()`, `draftMode()`, and dynamic route `params`/`searchParams`
   become `Promise`-returning; synchronous access is deprecated in 15 (still
   works with a codemod-inserted compat shim) and fully removed in 16 (not
   our target, but confirms 15 is the right stopping point — sync access
   still works there). **Action**: grep this app's actual usage —
   `grep -rn "params\.\|searchParams\.\|cookies()\.\|headers()\." frontend/src/app` —
   and either await each call site by hand or run Next's official codemod
   (`npx @next/codemod@latest next-async-request-api .`) which inserts the
   `await`s automatically. This app's App Router pages
   (`frontend/src/app/**`) are the surface to check; confirmed via `find`
   that only `dashboard/revenue/[contentId]` and `content/[id]/edit` are
   dynamic routes (2 files) — a small, auditable surface, not a sweep across
   dozens of pages.
2. **`fetch()` no longer cached by default** — Next 15 changes the default
   caching behavior of `fetch()` inside Server Components from
   cache-by-default to no-store-by-default. **Action**: grep
   `frontend/src/` for any `fetch(` call inside a Server Component that
   relied on the old default (this app's data-fetching goes through
   `api-client.ts` from Client Components in the pages read so far — verify
   this holds across the whole `app/` tree, not just the pages already
   reviewed in prior phases) — if none rely on the old default, this is a
   no-op; if any do, add explicit `{ cache: 'force-cache' }`.
3. **React 18 → 19 (mandatory dependency of Next 15)** — `react`/`react-dom`
   must bump from `^18.3.1` to `19.x`. React 19's own breaking changes
   (removed legacy APIs, stricter `<Suspense>`/hydration behavior) are
   smaller in practice for an App-Router-only, no-legacy-API codebase like
   this one, but must be checked: `grep -rn "ReactDOM.render\|componentWillMount\|componentWillReceiveProps\|componentWillUpdate\|findDOMNode\|createFactory\|PropTypes" frontend/src` —
   if this returns nothing (expected for a codebase built entirely in the
   App Router era), React 19 migration is close to a no-op beyond the
   version bump itself.
4. **`eslint-config-next`** must be bumped in lockstep with `next` (both are
   pinned together in `package.json` today — `^14.2.18` for both).

### 2.2 Sequencing (staged, not a single big-bang commit)

1. Bump `react`/`react-dom` to `19.x` alone first, run the full frontend
   suite (169 tests) + `next build` + a manual browser smoke pass at
   375/768/1280px on the highest-traffic pages (`/dashboard`, `/content`,
   `/posts`) — isolates any React 19-only regression before Next itself
   changes.
2. Bump `next`/`eslint-config-next` to `15.5.21` (or whatever the latest
   15.x patch is at execution time — always take the newest 15.x, not the
   exact number cited here, since new 15.x patches ship routinely).
3. Run `npx @next/codemod@latest next-async-request-api .` (or hand-fix the
   2 dynamic-route files identified in §2.1.1 if the codemod's diff looks
   unfamiliar/risky to accept blind).
4. Re-run: `npm run lint`, `npx tsc --noEmit`, `npm test` (169 baseline),
   `npm run build`.
5. **Live browser verification** (this repo's own standing rule — a
   dependency bump that changes the rendering/hydration layer is exactly
   the class of change BUG-P5-01 exists to warn against): drive every major
   page — `/content`, `/posts`, `/scheduler`, `/dashboard`, `/commerce/*`,
   `/paid`, the two dynamic routes from §2.1.1 specifically — at
   375/768/1280px, confirm no hydration warnings in console (React 19 is
   stricter here per the HTML-nesting note in §3, worth checking even
   though the hard *enforcement* is a 16-only behavior — 19 does add new
   console warnings for some previously-silent cases).
6. `npm audit` again — confirm 0 high/critical remain in `next`/`postcss`
   (the postcss advisory in H-1's original report is a transitive dependency
   of `next` itself and should clear automatically with the version bump).
7. Rebuild the Docker frontend image, confirm clean boot + the M-2 security
   headers still present (`curl -I`) + no new console errors — a full
   regression of the just-shipped M-1/M-2 work, not just the new dependency.

### 2.3 Effort/risk estimate

**Medium.** Two real breaking changes to touch (async APIs — small surface,
2 files; fetch caching — needs a grep-confirmed negative result), one
dependency major bump (React) that is very likely a no-op for an App-Router
codebase with no legacy API usage, and mandatory full-system browser
verification per this repo's own standing discipline. Not a rewrite; a
half-day to one-day task including verification, not a multi-day migration.

---

## 3. Backend track — NestJS 10.4.x → 11.1.28+

### 3.1 What actually needs to move (verified via `npm audit --json`'s raw
`fixAvailable` field, not the summary)

The M-3 finding's fix is **not** "bump multer" in isolation — `multer` is a
transitive dependency of `@nestjs/platform-express`, and the audit data
shows the fix requires `@nestjs/platform-express@11.1.28`, which is a
**NestJS v10 → v11 major version upgrade**, not a patch. Because NestJS
packages are version-locked as a set, this pulls in:

| Package | Current | Required | Notes |
|---|---|---|---|
| `@nestjs/core` | `^10.4.15` (resolved `10.4.22`) | `11.1.28`+ | major |
| `@nestjs/common` | `^10.4.15` (resolved `10.4.22`) | `11.1.16`+ | major |
| `@nestjs/platform-express` | `^10.4.15` | `11.1.28`+ | major — pulls in patched `express`/`body-parser`/`qs`/`multer` transitively |
| `@nestjs/config` | `^3.3.0` | `4.0.4`+ | major (separate advisory: `lodash` ReDoS, transitive) |
| `@nestjs/bullmq` | `^10.2.3` | `11.0.4`+ | major (separate advisory chain via `@nestjs/bull-shared`) |
| `@nestjs/throttler`, `@nestjs/testing`, `@nestjs/cli`, `@nestjs/schematics` | v10-line | v11-line equivalents | must move in lockstep, not independently audited but implied by the v11 set |

This is a **full-framework major version upgrade**, materially larger than
H-1's frontend track. Treat it as such in planning, not as a dependency
patch.

### 3.2 What breaks (NestJS's own v10→v11 migration guide)

1. **Express v5 becomes the default** under `@nestjs/platform-express` v11.
   Express 5's path-matching algorithm changed (stricter regex-based route
   matching, some previously-valid route patterns like bare `*` wildcards or
   certain optional-parameter syntaxes are rejected at startup rather than
   silently misbehaving). **Action**: grep every controller's route decorator
   for wildcard/optional-parameter patterns —
   `grep -rn "@\(Get\|Post\|Patch\|Delete\|Put\)(" backend/src/modules --include="*.controller.ts" | grep -E "\*|\(:.*\?\)"` —
   this app's routes read during the M-1 controller sweep were all
   simple static/`:param` paths (no wildcards observed), so this is
   expected to be low-risk, but must be confirmed exhaustively, not assumed
   from the subset already read.
2. **`setGlobalPrefix` no longer supports RegExp-style exclusions** (if this
   app uses a RegExp-based prefix exclusion — check `main.ts` directly for
   `setGlobalPrefix`). Read `main.ts`'s actual call before assuming impact.
3. **`Reflector.getAllAndMerge()` return-shape change** (array→object when a
   single metadata entry exists) — relevant only if this app's guards/
   decorators use `getAllAndMerge`; grep
   `grep -rn "getAllAndMerge" backend/src` before assuming impact.
4. **`CacheModule`/`cache-manager` migrated to Keyv** — only relevant if this
   app uses `@nestjs/cache-manager`; this codebase's caching is Redis via
   BullMQ/session store directly, not `@nestjs/cache-manager` (confirmed by
   its absence from `package.json`), so this breaking change is **not
   applicable** here — stated explicitly so it isn't mistakenly treated as
   a required migration step.
5. **tsconfig module resolution** — NestJS v11's DI container expects modern
   module resolution; this repo's `tsconfig.json` should be checked for
   `"module"`/`"moduleResolution"` settings predating `NodeNext`/`Node16`
   before the upgrade, not discovered as a boot-time failure after.

### 3.3 Sequencing

1. Read `main.ts` for `setGlobalPrefix` usage and grep for
   `getAllAndMerge` and wildcard routes (§3.2 items 1–3) **before** touching
   any `package.json` version — these determine whether this is a
   mechanical bump or needs code changes first.
2. Bump the full `@nestjs/*` package set together in one change (per NestJS's
   own guidance — partial upgrades within the framework are unsupported and
   likely to fail at boot with DI resolution errors), plus `@nestjs/bullmq`/
   `@nestjs/bull-shared` and `@nestjs/config` in the same pass since they're
   independently flagged and version-coupled to the same major-version set.
3. `npx tsc --noEmit` first — this will surface most breaking-API usage as
   compile errors before anything runs, which is the cheapest signal.
4. Full backend suite (719 baseline unit + 28 e2e) — this repo already has
   unusually strong test coverage for exactly this kind of change (guard
   behavior, route resolution, DI wiring are all exercised by the existing
   suite's breadth across every module).
5. **Manually re-verify the M-1 fix specifically** — `ConnectedAccountsController`
   was just changed to rely on class-level `@UseGuards` composition; Express
   v5's routing changes are the most likely place a previously-passing guard
   test could silently stop covering what it claims to, so don't just trust
   a green re-run — re-read the guard execution order after the upgrade.
6. Rebuild the Docker backend image, confirm `assertAdapterFlagsAreSafe()`
   and `assertPublisherFlagsAreSafe()` boot guards still fire correctly
   (these are exactly the kind of startup-time logic a DI-container version
   bump could silently break) — boot the container and deliberately set one
   `*_IMPL_*` flag to a live value outside `NODE_ENV=production` to confirm
   the boot-refusal still throws, then unset it and confirm normal boot.
7. Full curl-based smoke pass across a representative endpoint from every
   module (mirrors this repo's own established pattern from every prior
   phase's verification step) before considering this closed.

### 3.4 Effort/risk estimate

**Medium-High.** This is a full-framework major version upgrade (v10→v11
across ~7 packages), which is a materially different risk class than a
single-library patch. The concrete unknowns (wildcard routes, RegExp
prefixes, `getAllAndMerge` usage) are each cheap to check and, based on the
code already read during the M-1 sweep and this project's overall coding
style (explicit, conventional route decorators, no exotic Express features
observed anywhere), are more likely than not to be non-issues — but that
must be confirmed by grep, not assumed. Budget one to two days including the
full verification pass, not a same-day change.

---

## 4. Sequencing between the two tracks

**Independent — no ordering dependency.** Frontend and backend are separate
npm workspaces with no shared dependency graph; either can go first, or they
can be split across two separate PRs/sessions for isolated rollback. Given
the relative sizes (§2.3 vs §3.4), doing the **frontend track first** is
lower-risk practice reps before the larger backend change, and closes H-1
(explicitly named as higher-priority than M-3 in the original review's
checklist, since it's pre-authentication attack surface) sooner.

Do **not** attempt both in the same commit — if something regresses, a
single-track commit makes `git bisect`/rollback trivial; a combined commit
does not.

---

## 5. What this plan deliberately does not do

- **Does not execute any upgrade.** No `package.json` has been touched by
  this document. Explicit go-ahead needed per track before starting, per
  this repo's standing practice of not taking risky/hard-to-reverse actions
  without confirmation.
- **Does not re-litigate whether to upgrade at all** — both CVE sets are
  real (independently confirmed in the pre-production review and re-verified
  here against raw advisory data), and "stay on vulnerable versions
  indefinitely" was never the option on the table; this plans the *how* and
  *when*, not the *whether*.
- **Does not scope in unrelated dependency updates** (e.g., other
  `devDependencies` with lower-severity findings from the original
  `npm audit` output) — those are out of scope for H-1/M-3 specifically and
  should be tracked separately if wanted.

---

**Prepared by:** orchestrator, directly (not delegated to a subagent) —
grounded in real `npm audit --json` output and current Next.js/NestJS
migration documentation fetched live, not from training-data recall of
version numbers.
**Date:** 2026-08-01
**Status:** plan only, awaiting go-ahead to execute either track.

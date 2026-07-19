# Changelog

> Note: Phases 2–4 were tracked in `docs/phase*-*.md` rather than here; this
> file resumes at Phase 5.

## Phase 5D.1 — Engine-scoped ranking reads + durable audit trail (2026-07-19)

Backend-only consolidation pass. Closes the two items that gated the ranking-v2
enable decision (`docs/phase5-bugfix-feedback.md` §3, §5.3). Visual QA (5D.2) is
a separate pass; no frontend file changed. **`RANKING_ENGINE` still defaults to
`v1`** — enabling v2 is the admin's decision and comes after this fix is
verified.

### Fixed

- **BUG-P5-02 (Medium) — recommendations could mix ranking-engine versions.**
  `getLatestScores` aggregated latest-per-platform with no engine filter. v1
  writes 2 score rows (facebook, youtube); v2 writes 4 (adds tiktok, line_oa).
  Because v1 never writes the two extra platforms, a v2 → v1 rollback left the
  v2 tiktok/line_oa rows in the recommendation set permanently — nothing ever
  superseded them — so `pickRecommendedScore` compared a v1 score against a v2
  score. Those are computed from different factor sets under different weight
  vectors and are not on the same scale. Observed live in the demo DB: facebook
  0.4822 (v1) beating tiktok 0.4782 (v2) by 0.004 while the UI badge read
  "Engine v1 · 4 factors".

  Both read surfaces are now scoped to the active engine **in the WHERE
  clause**, sharing one filter, one ordering (`LATEST_SCORE_ORDER_BY`) and one
  collapse rule (`latestScorePerPlatform`):
  - `RankingEngineService.getLatestScores` / `getRecommendation` (per-content
    read; feeds the publish flow's `was_override` recompute)
  - `SchedulerService.readyContentsWithScores` (batched scheduler overview)

  BUG-QA-003 is preserved and strengthened: `pickRecommendedScore` remains the
  single shared tie-break, and the two surfaces now also select the *same rows*
  before it runs. A shared tie-break over two differently-scoped row sets could
  still have disagreed.

  Pre-existing mixed rows are **left on disk and ignored** — no data migration,
  nothing deleted. Historical scores stay attributable to the engine that
  produced them, which is the reason `EngineVersion` exists.

### Added

- **Durable audit trail** — new `audit_logs` table (migration
  `20260719190730_phase5d1_audit_logs`, additive). `AuditLogService.record()`
  now persists every entry **in addition to** the existing stdout JSON line.
  Previously the trail was stdout-only and was destroyed by any container
  recreate — proven, not theoretical: 8 `manual_external` posts left zero
  surviving audit lines. `bussiness_rule.md` justifies the copyright gate on the
  manual-external path entirely on audit-trail grounds.
  - `meta` is persisted **only after `redactSensitive()`** — the same redacted
    object used for the log line, so the two can never diverge and raw
    passwords/tokens/PII cannot be written. Phase 4 comment PII rules
    (`authorRef`/`textLength` only) hold unchanged.
  - The write is **non-blocking and non-transactional** with the operation it
    audits: a failed audit write logs an ERROR and never rolls back a publish.
    Explicit and tested.
  - `action` is stored as an indexed String, not a Prisma enum — the typed
    `AuditAction` union stays the source of truth, and an audit sink must never
    refuse to record an unknown action.
  - Indexes on `(action, created_at)` and `(actor, created_at)`.
- **`GET /api/audit-logs`** — admin-only, paginated, filterable by
  `action` / `actor` / `result` / `from` / `to`. `SessionAuthGuard + AdminGuard`,
  no CsrfGuard (GET, read-only convention), `pageSize` capped at 200. Read-only
  by design: no route edits or deletes an audit row. Nothing is re-redacted on
  read because nothing sensitive was ever written.
- `ActiveRankingEngineService` — one resolver for "which engine is in effect",
  used by both the write selector and both read surfaces so they cannot drift.

### Tests

Backend **378 → 401** (35 → 38 suites). New: `ranking-engine-mixing.spec.ts`
(10 — engine-mixing both directions, both surfaces agreeing under mixed data,
v1 unchanged, v1→v2→v1 round trip), `audit-log.service.spec.ts` (7 — persistence
alongside stdout, redaction of the persisted row asserted byte-level, audit-write
failure not breaking the audited operation), `audit-log-query.service.spec.ts`
(6). The existing BUG-QA-003 tie-break tests pass with their assertions
untouched.

### Deferred

- **Audit-log retention**: no policy added this pass — see `errorlog.md`.
- **QA5B-OBS-2** (non-UUID `contentId` → 400): backend stays 400 by design;
  the fix is frontend error mapping, carried to 5D.2. Rationale in `errorlog.md`.

## Phase 5B — Multi-platform frontend, ranking-v2 reasoning UI, exports (2026-07-19)

Frontend-only pass against the frozen 5A contract. No backend file changed.
Live adapters + PDF (5C) remain out of scope.

### Added

- **Manual-external record modal**
  (`components/publish/ManualExternalRecordModal.tsx`): platform picker over all
  four platforms, external post id, optional URL, override reason (required and
  only shown when the chosen platform differs from the recommendation), and
  step-up password. Mirrors the existing step-up modals — a 401 is recovered
  **in** the modal (error shown, password cleared, every other field preserved),
  while 400 / 403 / 409 / 429 each surface a distinct message. Shows the
  recommended platform and its score breakdown so an override is a visible,
  informed choice. Reachable per ready content from `/scheduler`.
- **Revenue drill-down** at `/dashboard/revenue/[contentId]`: totals, by
  platform, by post, and a trend chart reusing the existing `TrendChart`.
  Linked from each row of the dashboard's "Revenue by content" table.
- **CSV export buttons** (`components/reports/ExportCsvButton.tsx`): revenue on
  the dashboard and on the drill-down (scoped to that content via `contentId`),
  override log on `/posts`, comment summary on `/comments` (forwarding the
  platform filter). Rendered as anchors, not fetch+blob — the endpoints already
  return `Content-Disposition: attachment` and the session cookie is
  `SameSite=Lax`, so the browser downloads them natively. Disabled state is a
  real `<button disabled>` so it stays focusable and announced.
- **`lib/ranking-reasoning.ts`**: pure formatting for the v2 `override_feedback`
  factor — raw decision counts, both rates, and an explicit NEUTRAL callout that
  trusts the engine's `neutral` flag rather than inferring from a 0.5 value
  (a *computed* 0.5 is a real balanced signal, and mislabelling it would be a
  lie about how the score was reached).
- **api-client**: `recordManualExternalPost`, `getContentRevenue`,
  `reportCsvUrl`; types `PublishMethod`, `EngineVersion`, `RecordManualExternalInput`,
  `OverrideFeedbackInput`, `RevenueByPostItem`, `ContentRevenueDrilldown`,
  `ReportQuery`; `externalPostUrl` + `publishMethod` added to `Post`.
- 34 new jest tests (44 → 78): manual-record enable/validation, override-reason-
  required-when-overriding, the `line`/`line_oa` enum bridge, four-platform label
  coverage, and `override_feedback` formatting including both neutral reasons.

### Changed

- **All four platforms across the UI**: `/scheduler` publishes to any platform
  with a connected account (was Facebook/YouTube only) and renders all four
  cadence cards; `/posts` gains a "Method" column (Dispatched / Recorded
  manually) and links the external id to its permalink when one exists.
- **`ScoreReasoning`** extended (not duplicated) for v2's fifth factor, plus an
  engine badge (`Engine v1 · 4 factors` / `Engine v2 · 5 factors`) so the admin
  can tell which engine produced a score.
- **Platform labels** dropped their `(Phase 5)` suffix now that TikTok and LINE
  OA ship. TikTok/LINE carry a hint that manual recording is their normal path;
  the ordinary publish path is **not** blocked for them, since the backend
  registers mock adapters that dispatch.
- `COMMENT_PLATFORMS` widened to all four — every adapter now implements
  `fetchComments`, and comments attach to manually-recorded posts too.

### Notes

- `toAssetPlatform` was added as a real map rather than a cast: the two platform
  enums disagree on LINE (`line` vs `line_oa`), so a cast would silently produce
  a value that every `AssetPlatform`-keyed lookup misses.
- Report filters are limited to what `ReportQueryDto` accepts
  (`from`/`to`/`platform`/`contentId`). The posts-page status filter is
  deliberately *not* forwarded — the backend 400s unknown query fields
  (verified).

## Phase 5.0 + 5A — Multi-platform backend, ranking v2, CSV export (2026-07-19)

Backend-only pass. Frontend (5B) and live adapters/PDF (5C) are NOT in this
change.

### Added

- **Schema (additive)**: `posts.external_post_url` (nullable) and
  `posts.publish_method` (`PublishMethod` enum: `adapter` default |
  `manual_external`). Migration
  `20260719120223_phase5_0_publish_method_external_url`. Legacy rows stay valid
  with no backfill.
- **Cadence seed**: TikTok 14/week and LINE OA 3/week, admin-confirmed
  (`is_provisional=false`), idempotent like the existing rows. Pillar ratio
  policies are platform-independent and unchanged.
- **TikTok + LINE OA adapters** (`tiktok.adapter.ts`, `line.adapter.ts`),
  registered in `PlatformAdapterRegistry` — all four `AssetPlatform` values now
  resolve. Mock-first, gated by `PUBLISHER_IMPL_TIKTOK` / `PUBLISHER_IMPL_LINE`
  (default `mock`). **Their live paths are unverified stubs that reject
  cleanly** — no credentials exist, and no live integration is claimed.
- **`POST /api/posts/manual-external`**: records a post the admin published
  natively on the platform (the delivered TikTok/LINE path). Step-up re-auth +
  CSRF + AdminGuard + login-grade throttle, server-side `was_override`
  recompute, active-duplicate 409, audit action
  `manual_external_post_recorded`.
- **Ranking engine v2** (`RankingEngineV2Service`): five explainable factors
  over all four platforms — engagement blended with revenue, plus a new
  `override_feedback` factor learned from the admin's own past decisions
  (raw counts in the reasoning jsonb; neutral below a 5-decision floor).
  Selected by `RANKING_ENGINE` (default `v1`).
- **CSV exports** (`/api/reports/*.csv`): revenue drill-down, override log, and
  comment summary. Admin-only, audited (`report_exported`, no PII), hand-rolled
  CSV with formula-injection escaping. The comment report is **aggregate-only**
  — it never selects author, text, author id, or reply text (PDPA).
- **`GET /api/dashboard/revenue/:contentId`**: per-content revenue drill-down
  by platform, by post, and over time.
- Env: `PUBLISHER_IMPL_TIKTOK`, `PUBLISHER_IMPL_LINE`, `RANKING_ENGINE` — all
  with safe defaults, documented in `.env.example` and `docker-compose.yml`.

### Unchanged (deliberately)

- **Ranking v1 is frozen**: `RankingEngineService`, `RankingFactorsService`,
  and the v1 `FACTOR_WEIGHTS` / `RANKED_PLATFORMS` values are untouched, and
  all pre-existing v1 tests pass unedited. A golden regression test asserts v2
  reproduces v1's recommendation on legacy no-history content.

## Phase 1 — Foundation — Demo rollout (2026-07-15)

DevOps/Rollout pass: git repo initialized (previously ungitted), docker-compose
demo stack added, two QC-flagged hygiene items fixed. See the Deployment
Report for full details; this is a demo/local rollout, not a production
deployment (no cloud infra, domain, or CI/CD remote exists yet for this
project).

### Added

- `docker-compose.yml` (root): one-command local demo stack — Postgres 16,
  Redis 7, backend, frontend, with healthchecks and a named volume for
  Postgres data.
- `backend/Dockerfile`, `backend/docker-entrypoint.sh`, `backend/.dockerignore`:
  multi-stage NestJS image; entrypoint runs `prisma migrate deploy` then
  `prisma db seed` (both idempotent) before starting the server.
- `frontend/Dockerfile`, `frontend/.dockerignore`: multi-stage Next.js image;
  `NEXT_PUBLIC_API_BASE_URL` passed as a build-time arg.
- `.env.docker.example`: template for the root `.env` consumed by
  docker-compose.yml.
- Live-verified via a real `docker compose up --build`: all 4 services
  reach "healthy", migrations apply, admin is seeded (idempotently — reruns
  correctly skip), login returns a session cookie, `/api/auth/me` confirms
  the session, and the Facebook OAuth authorize endpoint redirects to the
  real Meta URL.

### Fixed

- `backend/prisma/seed.ts`: replaced a stale `require('zxcvbn')` +
  `eslint-disable-next-line @typescript-eslint/no-var-requires` with a plain
  `import zxcvbn from 'zxcvbn'` (the repo's `esModuleInterop` + `@types/zxcvbn`
  already supported this; the disable comment was dead weight — the file
  isn't even covered by the project's `lint` script glob). Re-verified:
  `tsc --noEmit`, `eslint`, and all 30 Jest tests still pass.
- `CHANGELOG.md`: corrected a stale queue-name reference
  (`connected-accounts:refresh-token`, the pre-fix name that would have
  crashed BullMQ — see BUG-001-adjacent note in `queue.constants.ts`) to the
  actual name, `connected-accounts-refresh-token`.

## Phase 1 — Foundation — QA rejection fixes (2026-07-15)

Fixes for defects found by QA Tester when actually booting the app (QC's
static-only review had missed these). Verified by starting the real backend
against real Postgres/Redis containers and hitting endpoints with curl — see
Quality Control handoff notes for full evidence.

### Fixed

- **BUG-001 (critical, blocked all runtime testing)**: backend crashed on
  startup with `Nest can't resolve dependencies of the THROTTLER:MODULE_OPTIONS`.
  `AuthModule` declared `RedisThrottlerStorageService` in its own `providers`
  array and referenced it via `ThrottlerModule.forRootAsync({ inject: [...] })`
  in the same module's `imports` — Nest resolves a dynamic module's
  `useFactory`/`inject` against providers visible to that dynamic module, not
  the importing module's own providers. Fixed by extracting
  `RedisThrottlerStorageService` into its own `RedisThrottlerStorageModule`
  (`backend/src/common/throttler/redis-throttler-storage.module.ts`), which
  is now passed via `imports` on `ThrottlerModule.forRootAsync`.
- **BUG-002 (major)**: the documented command `npm run prisma:seed` failed
  with `Environment variable not found: DATABASE_URL` because `ts-node`
  invoked directly does not load `.env` (only `prisma` CLI subcommands do).
  Fixed by adding `dotenv-cli` as a dev dependency and changing the
  `prisma:seed` script (and the `prisma.seed` config used by `prisma db seed`)
  to `dotenv -e .env -- ts-node prisma/seed.ts`.
- **BUG-003 (critical, found during this fix's mandatory boot verification,
  not in the original QA report)**: after fixing BUG-001, the backend still
  crashed on startup with `Nest can't resolve dependencies of the
  QueueService`. Root cause: a circular `require` between
  `queue.module.ts` (which imports `QueueService`) and `queue.service.ts`
  plus both processors (which imported the `SYSTEM_HEALTH_QUEUE` /
  `TOKEN_REFRESH_QUEUE` name constants back from `queue.module.ts`). The
  circular import meant those constants were still `undefined` at the point
  the `@InjectQueue(...)` parameter decorators ran, so both queues silently
  resolved to the same default Nest token and collided. Fixed by extracting
  the two constants into a new `backend/src/modules/queue/queue.constants.ts`
  with no imports of its own, and pointing `queue.module.ts`,
  `queue.service.ts`, and both processors at it directly.
- **BUG-004 (critical, found during the same boot verification)**: once
  BUG-003 was fixed, startup crashed a third time with `Queue name cannot
  contain :` — BullMQ rejects `:` in queue names, but
  `TOKEN_REFRESH_QUEUE` was defined as `'connected-accounts:refresh-token'`.
  Renamed to `'connected-accounts-refresh-token'` (`queue.constants.ts`);
  updated the one README reference to match. No stored data referenced the
  old queue name (Phase 1 has no persisted job history to migrate).

## Phase 1 — Foundation (2026-07-15)

Initial implementation. All Phase 1 exit criteria met: admin can log in,
admin can connect a Facebook Page via OAuth, DB schema is migrated and
seed-tested.

### Added

- Monorepo scaffold: `backend/` (NestJS) + `frontend/` (Next.js), independent
  `package.json`/lockfiles, shared root docs.
- Prisma schema with all 5 approved tables (`User`, `ConnectedAccount`,
  `Content`, `Post`, `Metric`, `Comment`), migrated and verified against a
  real Postgres instance; `target_age_min <= target_age_max` CHECK
  constraint added via hand-written migration DDL.
- Seed script creating one admin user, with a generated-and-printed-once
  password when `SEED_ADMIN_PASSWORD` is unset (never a hardcoded password).
- Session-based auth (connect-redis, Redis DB 1): Argon2id hashing, password
  policy (12+ chars, zxcvbn ≥ 3), per-IP login rate limiting (Redis-backed
  `ThrottlerModule`, 5/15min), per-account lockout (15min after 5 failures),
  session-fixation-safe login (session regenerated before session data is
  written), CSRF-protected mutations, indistinguishable login failure
  responses.
- Facebook OAuth connect/disconnect flow: authorize → consent → callback
  (state-validated, code exchanged for short- then long-lived token, Pages
  fetched, token AES-256-GCM encrypted, `ConnectedAccount` upserted) →
  disconnect (status flip + token columns nulled). Retry-once on Meta
  network failure; no partial persistence on failure; access_denied and
  single-use-code-retry error paths have distinct, non-alarming user-facing
  copy.
- BullMQ queue skeleton on Redis DB 0: 5-minute `system-health` no-op ping,
  daily `connected-accounts-refresh-token` sweep of tokens expiring within 7
  days.
- Structured audit logging for login success/failure, lockout, OAuth
  connect/disconnect/error, token-refresh failure.
- Global exception filter + logging interceptor, both redacting sensitive
  fields (passwords, tokens, secrets, cookies) by field-name matching, in
  both normal logs and exception/stack-trace serialization.
- Ownership/ACL checks on every connected-account mutation.
- ESLint rule banning `$queryRawUnsafe`/`$executeRawUnsafe`.
- Frontend: login screen, protected settings screen (connected-account list,
  connect/disconnect actions, OAuth callback status banners).
- 30 backend unit tests (auth login/lockout/indistinguishability, OAuth
  state CSRF validation, token encryption round-trip/tamper-detection,
  connected-account ownership, redaction utility).
- GitHub Actions CI workflow (Postgres + Redis service containers; lint,
  typecheck, test, build for both apps).
- `docs/security-decisions.md` (key-compromise runbook, KMS-migration
  triggers, full write-up of all 11 security-review items).
- `docs/meta-app-review-status.md` (blank checklist template for the admin).

### Deferred to Phase 2+

- Content CMS, ranking engine, manual publish flow, dashboard UI, comment
  aggregation, YouTube/TikTok/LINE platforms — out of Phase 1 scope by
  design.
- Facebook Page picker UI (currently connects the first Page returned by
  the Graph API).
- Persistent/queryable audit log table.
- KMS-based token encryption (currently a single env-var key).

### Known deviations

- `ConnectedAccount.accessTokenEncrypted` made nullable (spec said
  non-nullable `text`) to satisfy the mandatory disconnect-flow security fix
  requiring token columns to be nulled. See `docs/security-decisions.md`.

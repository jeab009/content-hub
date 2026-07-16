# Changelog

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

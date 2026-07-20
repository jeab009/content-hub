# Content Hub — Phase 1 (Foundation)

Content Hub is a system for scheduling and distributing content (product
promos, short dramas, comedy clips) across social platforms, with a
dashboard for monitoring reach, revenue, and comments. This repo implements
**Phase 1 only**: repo/CI scaffold, the full 5-table DB schema, single-admin
session auth, the Facebook OAuth connect flow, and a BullMQ queue skeleton.
No CMS, ranking engine, dashboard UI, publish logic, or non-Facebook
platforms are in scope yet — see `history_prompt.md` / `makedown.md` /
`memory.md` at the repo root for the full multi-phase plan.

## Repo layout

```
content-hub/
├── backend/    NestJS API — auth, Facebook OAuth, Prisma/Postgres, BullMQ/Redis
├── frontend/   Next.js (App Router) — login screen, settings screen
├── docs/       security-decisions.md, meta-app-review-status.md
└── .github/workflows/ci.yml   lint + typecheck + test + build, both apps
```

## Prerequisites

- Node.js 20+
- PostgreSQL 16 (or compatible)
- Redis 7 (or compatible)
- Docker, if you want to run Postgres/Redis locally via containers instead
  of native installs

## Quick start (local development)

### 1. Start Postgres and Redis

Easiest via Docker:

```bash
docker run -d --name content-hub-pg -e POSTGRES_USER=content_hub \
  -e POSTGRES_PASSWORD=content_hub -e POSTGRES_DB=content_hub \
  -p 5432:5432 postgres:16-alpine

docker run -d --name content-hub-redis -p 6379:6379 redis:7-alpine
```

### 2. Backend

```bash
cd backend
cp .env.example .env
# Edit .env:
#  - DATABASE_URL should already match the docker command above
#  - Generate SESSION_SECRET:        node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
#  - Generate APP_ENCRYPTION_KEY:    node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
#  - Fill in FACEBOOK_APP_ID / FACEBOOK_APP_SECRET from your Meta App dashboard
#    (see docs/meta-app-review-status.md before relying on this in anything
#    beyond local dev against your own test Page)

npm install
npm run prisma:migrate       # applies migrations (prisma migrate deploy)
npm run prisma:seed          # creates the one admin user; prints a generated
                              # password once if SEED_ADMIN_PASSWORD is unset
npm run start:dev            # http://localhost:4000
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local   # NEXT_PUBLIC_API_BASE_URL defaults to http://localhost:4000
npm install
npm run dev                  # http://localhost:3000
```

Open http://localhost:3000 — it redirects to `/login`. Sign in with the
seeded admin email and the password printed by `prisma:seed` (or whatever
you set via `SEED_ADMIN_PASSWORD`). After login you land on `/settings`,
where "Connect a Facebook Page" starts the OAuth flow.

## Demo deployment via Docker Compose

For a one-command local/demo stack (Postgres + Redis + backend + frontend,
all containerized) instead of the manual steps above:

```bash
cp .env.docker.example .env    # then fill in real secrets — see comments in the file
docker compose up --build
```

Open http://localhost:3000. On first boot the backend container applies
migrations and seeds the admin user automatically; if you left
`SEED_ADMIN_PASSWORD` unset in `.env`, find the generated password with:

```bash
docker compose logs backend | grep -A3 "Generated admin password"
```

Useful commands:

```bash
docker compose ps                 # all 4 services should show "healthy"
docker compose logs -f backend    # tail backend logs
docker compose down               # stop (keeps the Postgres volume)
docker compose down -v            # stop and wipe the Postgres volume
```

This path is verified working end-to-end (migrations, seed, login, session
cookie, OAuth authorize redirect) — see the Deployment Report for the full
writeup. It is a **demo/local deployment**, not a production one: single
replica per service, no TLS, no orchestration, secrets from a local `.env`
file. See "Running in production" above and the Deployment Report for what
real production deployment would additionally require.

Images: `backend/Dockerfile` (NestJS, multi-stage, non-root user, keeps the
Prisma CLI in the runtime image so `prisma migrate deploy` + `prisma db
seed` can run automatically on start — see the Dockerfile's own comments for
why that's a deliberate demo-only tradeoff) and `frontend/Dockerfile`
(Next.js, multi-stage, non-root user; `NEXT_PUBLIC_API_BASE_URL` is a
**build-time** arg since Next.js inlines `NEXT_PUBLIC_*` vars into the
browser bundle).

## Running tests

```bash
cd backend && npm test        # unit suite (mocked Prisma — safe against any database)
cd frontend && npm run lint && npm run typecheck && npm run build
```

### `npm run test:e2e` — needs its own throwaway database

The Phase 6 separation suite (`backend/test/*.e2e-spec.ts`) runs against a **real**
Postgres and `TRUNCATE`s **every** application table between runs — `users`,
`contents`, `posts`, not just the commerce ones. Pointing it at the Docker Compose
demo database erases your demo data.

The harness refuses to run unless the database **name ends in `e2e`**. Create one
once, then use it:

```bash
docker compose exec postgres psql -U content_hub -d postgres \
  -c "CREATE DATABASE content_hub_e2e OWNER content_hub;"

cd backend
export DATABASE_URL='postgresql://content_hub:content_hub@localhost:5432/content_hub_e2e?schema=public'
npx prisma migrate deploy
npm run test:e2e
```

`ALLOW_E2E_TRUNCATE=1` overrides the name check. Do not set it against the demo
database.

## Scripts reference (backend)

| Command | Purpose |
|---|---|
| `npm run start:dev` | Dev server with watch mode |
| `npm run build` | Production build (`dist/`) |
| `npm run lint` | ESLint, zero warnings allowed |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Jest unit tests |
| `npm run prisma:migrate` | Apply migrations (`prisma migrate deploy`) — use in CI/prod |
| `npm run prisma:migrate:dev` | Create + apply a new migration — use in local dev when you change `schema.prisma` |
| `npm run prisma:seed` | Seed the one admin user |

## What's implemented

- **Auth**: session-based (connect-redis, Redis DB 1), Argon2id password
  hashing, password policy (12+ chars, zxcvbn score ≥ 3), per-IP rate
  limiting on login (5/15min, Redis-backed `ThrottlerModule`), per-account
  lockout (15min after 5 consecutive failures), session-fixation-safe
  (session id regenerated on login), CSRF-protected mutations, indistinguishable
  login failure responses.
- **Facebook OAuth**: authorize → Meta consent → callback (state validated,
  code exchanged for short-lived then long-lived token, Pages fetched,
  token AES-256-GCM encrypted, `ConnectedAccount` upserted) → disconnect
  (status flip + token columns nulled). Retries once on Meta network
  failure; no partial writes on failure.
- **DB schema**: all 5 approved tables (`users`, `connected_accounts`,
  `contents`, `posts`, `metrics`, `comments` — see `backend/prisma/schema.prisma`),
  migrated and seed-tested against a real Postgres instance during this
  build.
- **Queue**: BullMQ on Redis DB 0, `system-health` 5-minute no-op ping,
  `connected-accounts-refresh-token` daily sweep of tokens expiring within 7
  days.
- **Security hardening**: see `docs/security-decisions.md` for the full
  writeup of all 11 items from the System Analyst review, plus one
  documented deviation from the locked schema spec (nullable
  `accessTokenEncrypted`, required by the mandatory disconnect-nulling
  security fix).

## What's stubbed or deferred (and why)

- **Frontend is intentionally minimal** — login + settings only, no design
  system polish, per the Phase 1 scope ("no dashboard UI"). Bootstrap is
  wired in but only lightly used.
- **Audit log is log-line based, not a DB table** — the approved 5-table
  schema has no audit table. See `docs/security-decisions.md` §7 for the
  Phase 2+ trigger to add one.
- **Token encryption uses a single env-var key, not a KMS** — see
  `docs/security-decisions.md` §10 for the explicit revisit criteria.
- **Facebook OAuth connects the first Page returned by `/me/accounts`** —
  Phase 1's UI has no page-picker; an admin managing multiple Pages will
  only get the first one connected. Flagged for Phase 2 UI work, not a bug.
- **`meta-app-review-status.md` is a blank template** — this build has no
  access to a real Meta Business Manager account; the admin must fill it in
  before relying on the connect flow outside local dev.
- **No live remote/CI run** — `.github/workflows/ci.yml` is written and
  spins up real Postgres + Redis service containers, mirroring exactly the
  commands (`lint`, `typecheck`, `test`, `build` for both apps) that were
  run and passed locally during this implementation, but has not been
  executed against a live GitHub Actions run (no remote repo configured yet).

## Deviations from the approved spec

Documented in full in `docs/security-decisions.md`. Summary: 
`ConnectedAccount.accessTokenEncrypted` was made nullable (spec said
non-nullable `text`) because the mandatory security fix requiring token
columns to be nulled on disconnect cannot be satisfied on a non-nullable
column.

## Running in production

- Set `NODE_ENV=production` — this flips the session cookie's `Secure` flag
  on, which requires the app to be served over HTTPS (put it behind a
  reverse proxy/load balancer terminating TLS).
- Use `npm run prisma:migrate` (`prisma migrate deploy`), not
  `prisma:migrate:dev`, in any non-local environment.
- Every secret in `backend/.env.example` needs a real, unique value per
  environment — `SESSION_SECRET`, `APP_ENCRYPTION_KEY`,
  `FACEBOOK_APP_SECRET` in particular. See `docs/security-decisions.md` §10
  for the key-compromise runbook if `APP_ENCRYPTION_KEY` is ever suspected
  leaked.

# Phase 6.0 — Commerce Schema & Separation Gate · Deployment Report

- **Author**: Senior DevOps & Rollout Engineer, Loop Engineering Position #7
- **Date**: 2026-07-20
- **Commit**: `f0f5705` — "feat(backend): Phase 6.0 commerce schema & separation gate"
- **Inputs**: QC APPROVED (`docs/phase6-qc-review.md`), QA SIGNED OFF, zero Critical/High
  (`docs/phase6-qa-report.md`)
- **Target environment**: **local/demo Docker Compose stack only.** There is no cloud
  production environment for this project (no git remote configured, single-host
  compose stack). This report is scoped accordingly — no cloud deploy was performed or
  attempted.
- **Verdict: DEPLOYED (demo/local).**

---

## 1. Deployment sequence executed

| Step | Action | Result |
|---|---|---|
| 1 | Confirm target commit / working tree | `git rev-parse HEAD` = `f0f5705`; `git status --short` clean |
| 2 | Migration status check (live container) | PASS — see §2 |
| 3 | Constraint cross-check (independent of QA, via raw `psql`) | PASS — see §2 |
| 4 | CI topology review (`.github/workflows/ci.yml`) | PASS with caveats — see §3 |
| 5 | e2e-truncation risk assessment | **Confirmed live risk, no code guard against wrong DB name** — see §4 |
| 6 | `docker compose build backend` | PASS (cached, no source changes since last build; verified working tree clean at `f0f5705`) |
| 7 | `docker compose up -d backend` (recreate) | PASS — clean boot, `healthy` |
| 8 | Route table inspection (no new commerce endpoints) | PASS — confirmed |
| 9 | Frontend container check | PASS — unaffected, `healthy` |
| 10 | Rollback plan | Documented — see §5 |

---

## 2. Migration verification (independent of QA's prior run)

Ran directly against the live compose Postgres container (`content-hub-postgres-1`),
via `docker compose exec backend npx prisma migrate status` and raw `psql`:

```
10 migrations found in prisma/migrations
Database schema is up to date!
```

`_prisma_migrations` ordering confirmed correct — `20260721000000_phase6_commerce` is
last, applied at `2026-07-20 02:46:55 UTC`, immediately after
`20260719190730_phase5d1_audit_logs`. No drift, no pending migrations.

Hand-written constraints independently re-verified live (not reusing QA's psql output,
re-ran fresh):

- `commerce_conversions`: `commerce_conversions_currency_chk` — `CHECK (currency ~
  '^[A-Z]{3}$')`; `commerce_conversions_no_self_reversal_chk` — `CHECK (reversal_of_id
  <> id)`; `commerce_conversions_statement_ref_len_chk` — `CHECK (... <= 64)`. Confirmed
  present via `\d+ commerce_conversions`.
- `commerce_placements`: `commerce_placements_note_len_chk` — `CHECK (note IS NULL OR
  char_length(note) <= 200)`; `commerce_placements_shopee_duration_chk` with the
  explicit `IS NOT NULL` conjunct. Confirmed present via `\d+ commerce_placements`.
- Hand-written FKs: `pg_constraint` introspection across the 5 commerce tables returns
  **18 foreign keys** (matches QA's count), including the cross-module FKs into
  `posts`, `contents`, `content_assets`, `users` — all real Postgres constraints, none
  expressible as a Prisma `@relation`.

This independently reproduces QA's §2 findings rather than trusting them — same result.

---

## 3. CI topology review — would it actually run?

**Reviewed `.github/workflows/ci.yml` directly.** Structurally sound:

- `backend` job: own `postgres:16-alpine` service (`content_hub`), own `redis`, runs
  lint → typecheck → `prisma generate` → `prisma migrate deploy` → unit tests → build.
- `separation-e2e` job: **genuinely isolated** — GitHub Actions provisions a fresh
  `services.postgres` container per job, so this job's Postgres (`POSTGRES_DB:
  content_hub_e2e`, `DATABASE_URL` pointing at `content_hub_e2e`) is a physically
  different container instance from the `backend` job's Postgres, not a shared DB with
  a different name. The two jobs cannot race or collide even though both listen on
  `5432` inside their own job sandbox. Migrations run (`prisma migrate deploy`) before
  `npm run test:e2e`. This satisfies condition B2 as designed.
- One gap: the `separation-e2e` job does not provision a `redis` service, unlike the
  `backend` job. If any code path exercised by `test:e2e` (Nest app boot, queue module
  init) requires a live Redis connection rather than a mock, this job would fail at
  runtime in CI. QA's local run used the compose stack's Redis, which was present, so
  this gap was not exercised. **Flag for Bug Fixer / next CI run**: confirm whether the
  e2e Nest bootstrap path needs Redis; if so, add a `redis` service block to
  `separation-e2e` before this workflow is ever pushed to a remote.
- **Stated plainly, per task instructions: no live GitHub Actions runner has ever
  executed this workflow.** There is no git remote configured on this repo (`git
  remote -v` returns nothing), so `.github/workflows/ci.yml` has never been evaluated
  by GitHub's own YAML parser or scheduler. Everything above is a static review of the
  YAML, not a live CI result. The only live execution of the underlying commands in
  this report is the local `docker compose` / `psql` verification in §2 and §6, and
  QA's own manual `npm run test:e2e` run (14/14 passed, per QA report §1/§4).

---

## 4. CRITICAL rollout risk — `npm run test:e2e` database truncation (P6-OBS-2)

**Assessed independently by reading `backend/src/testing/e2e/e2e-database.ts` directly**
(not just QA's description of it):

```ts
function assertDisposableDatabase(url: string | undefined): string {
  ...
  const isLocal = /@(localhost|127\.0\.0\.1|postgres):/.test(url);
  if (!isLocal) {
    throw new Error('Refusing to run the e2e suite: DATABASE_URL does not point at
      localhost/127.0.0.1/postgres. This suite TRUNCATES every table. ...');
  }
  return url;
}
```

**Finding, stated plainly: the guard checks only the *host* portion of `DATABASE_URL`
(`localhost` / `127.0.0.1` / `postgres`) — it does not inspect the database *name* at
all.** `resetDatabase()` then runs `TRUNCATE TABLE ... RESTART IDENTITY CASCADE` across
all 14 application tables (`TRUNCATE_ORDER` constant), not just the 5 commerce ones.

Consequence: `npm run test:e2e` **inherits whatever `DATABASE_URL` is currently set to**
and truncates that database in full, provided only that the host looks local. Since the
Docker Compose demo stack's Postgres is reachable at `postgres:5432` (in-container) or
`localhost:5432` (from host), and its database is literally named `content_hub` — the
same name CI happens to use for its unit job — the guard's "is this disposable?" check
passes for the **real demo database** exactly as readily as it passes for a genuine
throwaway CI database. There is nothing in the check that distinguishes "CI's
freshly-provisioned, about-to-be-discarded `content_hub`" from "the developer's
long-lived demo `content_hub` with seeded users and content." This is precisely what
QA reproduced in P6-OBS-2: running it against the compose stack wiped `users` and
`contents`.

**CI itself is not at risk** — its unit job's `content_hub` and its `separation-e2e`
job's `content_hub_e2e` are both fresh, ephemeral, per-job containers with no
persistent volume, so a truncation there costs nothing. The risk is specific to any
developer (or agent) running `npm run test:e2e` locally against the persistent compose
stack, which is exactly the demo environment this report is deploying to.

### Recommended concrete guard (for 6A, before any further local e2e usage)

Extend `assertDisposableDatabase` to also require the **database name** to carry an
explicit, opt-in e2e marker, e.g.:

```ts
const url = new URL(rawUrl.replace(/^postgresql:/, 'http:')); // parse path safely
const dbName = url.pathname.replace(/^\//, '');
if (!/(^|_)e2e$/.test(dbName)) {
  throw new Error(
    `Refusing to run the e2e suite against database "${dbName}": its name does not ` +
    `end in "_e2e" or "e2e". This suite TRUNCATES every application table. ` +
    `Point DATABASE_URL at a disposable database whose name says so (e.g. ` +
    `content_hub_e2e), or set an explicit ALLOW_E2E_TRUNCATE=1 override.`
  );
}
```

This converts "host looks local" (true for the persistent demo DB) into "name says
disposable" (false for the persistent demo DB, true only for a database a human
deliberately named/created for this purpose, e.g. CI's `content_hub_e2e`). Recommend
pairing this with a one-line warning added to `README.md` / `SETUP-CHECKLIST.md` before
6A ships more local e2e usage, per QA's P6-OBS-2 recommendation — confirmed this note
does not currently exist in either file (checked via `git diff` on this commit and
current file contents).

**This is the single most important item for Bug Fixer / 6A to carry forward.** It is
not a regression introduced by this deploy (the compose stack today is intact — see
§6), but it is a live footgun that will fire again the next time anyone runs
`npm run test:e2e` locally without first pointing `DATABASE_URL` at a differently-named
database.

---

## 5. Rebuild + boot verification (live output)

```
$ docker compose build backend
... (cached — no source changes since the image already reflects f0f5705,
     working tree confirmed clean via `git status --short`)
 Image content-hub-backend Built

$ docker compose up -d backend
 Container content-hub-postgres-1  Running
 Container content-hub-redis-1     Running
 Container content-hub-backend-1   Recreated
 Container content-hub-backend-1   Started

$ docker compose ps backend
NAME                    STATUS
content-hub-backend-1   Up (healthy)
```

Backend logs on this fresh boot: `Prisma generate` skipped (already generated),
`Applying database migrations... No pending migrations to apply.`, seed script ran
idempotently (all rows "already exists — skipping"), Nest bootstrapped cleanly
(`AppModule dependencies initialized` → all 15 feature modules → `NestApplication
successfully started` → `Content Hub backend listening on port 4000`).

**Route table inspection** (`RoutesResolver`/`RouterExplorer` log lines): confirmed
controllers registered are exactly `AuditLogController`, `AuthController`,
`ConnectedAccountsController`, `ContentController`, `RankingController`,
`PostsController`, `SchedulerController`, `MetricsController`, `DashboardController`,
`CommentsController`, `CommentTemplatesController`, `ReportsController`. **No
`CommerceController` or any `/api/commerce/*` route exists** — correct and expected for
a 6.0 schema-only gate; 6A builds the endpoints.

**Note on health check**: the compose stack has no `/api/health` HTTP endpoint — a
plain `curl http://localhost:4000/api/health` returns `404 Cannot GET /api/health` (this
is a pre-existing property of the app, not a 6.0 regression; confirmed by checking
`backend/Dockerfile`'s `HEALTHCHECK` instruction, which uses a raw TCP-connect probe on
port 4000, not an HTTP endpoint — `docker inspect` reports the container `healthy` on
that basis). No API surface changed here, so this is unchanged from pre-6.0 behavior
and out of scope for this gate, but flagging so Bug Fixer does not mistake the 404 for
a new defect.

Frontend container (`content-hub-frontend-1`) was not rebuilt (Phase 6.0 touched no
frontend runtime code, only `.eslintrc.js`, a lint-time config) — confirmed still
`healthy`, Next.js 14.2.35 serving on port 3000, unaffected.

---

## 6. Rollback plan

**Migration is additive only** — confirmed by direct schema diff review (§2 of this
report and QC's independent review): 5 new tables, 3 new enums, 1 new nullable column
(`content_assets.duration_seconds`). No `ALTER`/`DROP` on any pre-existing payout/ranking
table (`posts`, `metrics`, `ranking_scores`, `contents`, `comments`, `audit_logs`,
`users`). Old application code (any commit prior to `f0f5705`) has no Prisma model
referencing the new tables/column, so it remains fully schema-compatible against the
post-migration database — a code rollback does not require a matching migration
rollback.

### Rollback runbook (demo/local)

1. **Code rollback** (if a defect is found in production/demo behavior traceable to
   this commit):
   ```
   git log --oneline -3          # confirm f0f5705 is HEAD, prior commit is 01bcc3a
   git checkout 01bcc3a -- backend frontend   # or full revert / branch checkout
   docker compose build backend frontend
   docker compose up -d backend frontend
   ```
   No `prisma migrate resolve --rolled-back` step is needed — the additive migration
   is harmless to leave applied; old code simply never queries the 5 new tables.
2. **Full schema rollback** (only if genuinely required — not expected, no reason
   identified): the migration has no down-migration script (Prisma convention — none of
   the pre-existing 9 migrations have one either). Manual rollback would require a
   hand-written `DROP TABLE ... CASCADE` for the 5 commerce tables, `DROP TYPE` for the
   3 new enums, and `ALTER TABLE content_assets DROP COLUMN duration_seconds`, executed
   against the compose Postgres, followed by `DELETE FROM _prisma_migrations WHERE
   migration_name = '20260721000000_phase6_commerce'`. Not exercised or required for
   this deployment — documented for completeness only, per the skill's "every
   deployment MUST have a tested rollback procedure" standard. This path has NOT been
   tested; if ever needed, test it against the compose stack first, not directly.
3. **Container-level rollback**: `docker compose down backend && docker compose up -d
   backend` using a previously tagged image (`docker tag content-hub-backend:<sha> ...`
   before overwriting) is the fastest path if the defect is runtime-only and the
   schema is not implicated.

### Rollback triggers for this gate
- Any existing (pre-6.0) endpoint changes behavior (payout, ranking, dashboard,
  reports, comments) — would indicate the separation guarantee failed.
- `npx prisma migrate status` reports drift on re-check.
- Any of the 4 separation specs or the e2e byte-identity spec starts failing on a
  subsequent run against the demo database.

---

## 7. New env/config surface introduced by this release

**None.** Confirmed via `git show --stat f0f5705` and a targeted diff of
`docker-compose.yml` / `.env.docker.example` between `f0f5705~1` and `f0f5705`: neither
file changed. `grep -rn "process.env" backend/src/modules/commerce/` returns no
matches — the commerce module reads no new environment variables. The `separation-e2e`
CI job sets `RANKING_ENGINE=v2` and its own `DATABASE_URL`, but both are CI-job-local
env, not a new variable the application itself consumes beyond what already existed
(`RANKING_ENGINE` predates this phase). SETUP-CHECKLIST.md's diff in this commit is an
unrelated addition (§6.4, a Meta Ads MCP note) — not part of this deployment's config
surface.

---

## 8. Known issues carried forward to Bug Fixer

| ID | Severity | Description |
|---|---|---|
| DEVOPS-1 | High (process risk, not a live defect) | `npm run test:e2e` truncates whatever database `DATABASE_URL` points at, gated only by hostname, not database name. Recommend the name-suffix guard in §4 before 6A adds more local e2e usage. |
| DEVOPS-2 | Low | `separation-e2e` CI job has no `redis` service, unlike the `backend` job — unverified whether the e2e Nest bootstrap needs one. Should be checked before this workflow's first real run on a remote. |
| DEVOPS-3 | Informational | No `/api/health` HTTP endpoint exists anywhere in this app (pre-existing, not introduced by 6.0); Docker's healthcheck is a raw TCP-connect probe. Not a regression, but worth a real HTTP health endpoint before any future cloud deployment. |
| P6-QA-1 / P6-QA-2 / P6-QA-3 | Low | Carried forward unchanged from QA report — documentation/test-hygiene notes only, non-blocking. |

---

## 9. Verdict

**DEPLOYED (demo/local).** Migration applied and verified live, independent of the
prior QA run. CI topology reviewed and structurally sound with one gap noted (§3).
Backend and frontend containers rebuilt/recreated and confirmed healthy with no new
commerce routes (correct for a gate release). Rollback path is documented and safe
(additive migration, old code compatible). No new env/config surface. The one
CRITICAL item to carry forward is the `test:e2e` truncation footgun (§4) — not a defect
in this release, but a live operational risk for whoever next touches this repo
locally.

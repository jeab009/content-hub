# Phase 4.0 Gate + 4A Comment Aggregation — Deployment Report

- **Author**: Senior DevOps & Rollout Engineer (Loop Engineering, position #7)
- **Date**: 2026-07-19
- **Scope**: Phase 4.0 schema/compliance gate + Phase 4A `CommentsModule` backend
- **Deployed commit**: `f828482` ("feat(backend): Phase 4.0 gate + 4A comment aggregation")
- **Inputs consumed**: `docs/phase4-qa-report.md` (SIGNED OFF, zero bugs), `docs/phase4-qc-review.md` (APPROVED), `docs/phase4-architecture-design.md`, `.github/workflows/ci.yml`, `docker-compose.yml`, `backend/Dockerfile`, `backend/docker-entrypoint.sh`, `CHANGELOG.md`, `errorlog.md`
- **Target**: local/demo Docker Compose stack (`backend` :4000, `frontend` :3000, `postgres`, `redis`). **There is no cloud/remote production environment for this project** — this is intentionally a demo rollout, not a live prod deploy.

## Verdict

**DEPLOYED (demo/local).** Clean rebuild, clean boot, migration applied and confirmed live, all new routes mapped, no code changes made by this stage (pure verification/rollout).

---

## 1. Deployment sequence executed

| Step | Action | Result |
|---|---|---|
| 1 | Pre-check running stack (`docker compose ps`) | All 4 services already up (backend healthy, ~1h uptime from prior QA session) |
| 2 | `docker compose build backend` | **Success** — multi-stage build, `npx prisma generate` + `nest build` both clean, image `content-hub-backend:latest` rebuilt in ~13s (mostly cached layers; only `prisma/`, entrypoint, package.json layers changed) |
| 3 | `docker compose up -d backend --force-recreate` | Container recreated: `Recreated → Starting → Started`, reached `health: starting` at +3s, **`healthy` at +17s** (within the Dockerfile's `--start-period=15s`) |
| 4 | Inspect entrypoint log | `[entrypoint] Applying database migrations...` → `7 migrations found` → seed step (idempotent, all rows "already exists — skipping") → `[entrypoint] Starting Content Hub backend...` |
| 5 | `npx prisma migrate status` (inside container) | **`Database schema is up to date!`** — 7/7 migrations recorded, including the new one |
| 6 | Route-map verification (live boot log) | `CommentsController {/api/comments}` and `CommentTemplatesController {/api/comment-templates}` both registered; all 8 comment/template routes mapped (see §3) |
| 7 | DB-level index verification (`psql \d comments`, `\d escalation_alerts`) | Partial unique index and escalation unique constraint both live in Postgres, not just in the migration file |
| 8 | Smoke HTTP check | `GET /api/comments` → **401** (unauthenticated, correct — guard is active, route is live); no 404/500 |

## 2. Migration status — `20260719004112_phase4_comment_aggregation`

- Deploy path confirmed: `backend/docker-entrypoint.sh` runs `npx prisma migrate deploy` (not `migrate dev`) on every container start, before seeding, before `exec`'ing the Nest app — correct for this compose-based demo release pattern (skill file §4 "Pre-Deployment" — migrations before new code serves traffic).
- `npx prisma migrate status` output (live, inside the running container against the compose Postgres):
  ```
  7 migrations found in prisma/migrations
  Database schema is up to date!
  ```
- `_prisma_migrations` table query confirms all 7 rows recorded, most recent:
  ```
  20260719004112_phase4_comment_aggregation | finished_at: 2026-07-19 00:44:10.834519+00
  ```
- Live schema inspection (not just the migration SQL file) confirms the two DB-enforced dedup controls called out by QC/QA are actually materialized:
  - `"comments_platform_external_key" UNIQUE, btree (platform, external_comment_id) WHERE external_comment_id IS NOT NULL`
  - `"escalation_alerts_rule_key_window_start_key" UNIQUE, btree (rule_key, window_start)`
- Migration is **additive-only** (new enums, new nullable columns, new tables, new indexes) — no destructive changes, no data loss risk, forward-safe. Confirmed by QC review §"Tree Hygiene" and independently by the schema diff read during this stage.

## 3. Route map confirmed live (boot log, `RouterExplorer`)

```
CommentsController {/api/comments}:
  POST   /api/comments/sync
  GET    /api/comments
  GET    /api/comments/escalations
  POST   /api/comments/escalations/:id/ack
  POST   /api/comments/retention/purge
  POST   /api/comments/:id/reply
  DELETE /api/comments/:id
CommentTemplatesController {/api/comment-templates}:
  GET    /api/comment-templates
  POST   /api/comment-templates
  PATCH  /api/comment-templates/:id
  DELETE /api/comment-templates/:id
```
All 11 new endpoints mapped, matching the QC/QA reports exactly. `NestApplication successfully started` + `Content Hub backend listening on port 4000` with no startup errors or warnings.

## 4. New env/config surface

### 4.1 `SENTIMENT_IMPL` (genuinely new in this release)
- Added in `backend/src/config/env.validation.ts` (Joi) and `backend/src/config/configuration.ts`.
- Joi schema: `Joi.string().valid('rule_based', 'model').default('rule_based')` — **safe default**, so a fresh boot with no `.env` entry does not break. Confirmed live: boot log shows `[SentimentClassifierProvider] Using the rule-based Thai sentiment classifier (offline, deterministic)` with the var unset in `.env`/`.env.docker.example`/`docker-compose.yml`.
- **Gap**: not documented in `.env.docker.example` or `docker-compose.yml`'s `environment:` block. Not a boot-breaker (default is safe and matches the intended ship-disabled posture for the model tail), but it's a discoverability gap — an operator wanting to understand the flag has to read source. Recommend adding a commented-out line to `.env.docker.example` in a follow-up.

### 4.2 `PUBLISHER_IMPL_FACEBOOK` / `PUBLISHER_IMPL_YOUTUBE`
- **Pre-existing from Phase 2** (confirmed via `git show f828482` — no diff touched these lines this release). Not new to Phase 4A; the Phase 4A code comment in `configuration.ts` merely references them by analogy ("Mirrors the PUBLISHER_IMPL_* mock/live gate"). No action needed for this release; flagged only because the task asked to verify them.
- Same safe-default pattern (`mock`), same non-blocking documentation gap in `.env.docker.example`.

### 4.3 `SEED_ADMIN_PASSWORD` drift (QA P4-OBS-1) — rollout risk, carried forward
- Confirmed independently: top-level `.env` ships `SEED_ADMIN_PASSWORD=` (blank), `backend/.env` ships `SEED_ADMIN_PASSWORD=TestPassw0rd!2026XYZ`. `docker-compose.yml` passes the **top-level `.env`** value into the backend container's `environment:` block (`SEED_ADMIN_PASSWORD: ${SEED_ADMIN_PASSWORD:-}`) — `backend/.env` is not read at all inside the container (only used for bare-metal/non-compose dev).
- On the **current demo volume** this is a non-issue: the seed step is idempotent (`Seed: ... already exists — skipping` for policy/cadence rows; admin user already exists from a prior seed) and QA's login succeeded first-try.
- **Risk for a fresh volume** (e.g., `docker compose down -v` then `up`): the seed script would run with blank `SEED_ADMIN_PASSWORD` from the top-level `.env`, generating and printing a **random** password to backend logs once — matching the documented "leave blank" behavior, but different from what's in `backend/.env`. Anyone expecting to log in with `TestPassw0rd!2026XYZ` after a volume reset would hit the same class of failure as the earlier P2F-OBS-1 precedent (`errorlog.md`). Not a Phase 4 code defect — this is compose-env-file drift that predates Phase 4A. Documenting for Bug Fixer as a watch item, not filing a new bug.

## 5. CI/CD pipeline coverage

- `.github/workflows/ci.yml` (`backend` job): `npm run lint` → `npm run typecheck` → `npx prisma generate` → `npx prisma migrate deploy` → `npm test -- --ci --coverage` → `npm run build`, against Postgres 16 + Redis 7 service containers. This wiring runs against the whole `backend/src` tree, so it **does cover** the new `CommentsModule`, the new migration, and the new config surface (lint/typecheck/test/build all execute unconditionally over the full source tree, not path-filtered).
- `package.json` scripts (`lint`, `typecheck`, `test`, `build`) match exactly what CI invokes — confirmed no drift between local commands and the CI job.
- **Not run on a live runner**: no GitHub remote is configured for this repo (`git status`/`git log` confirm a fully local repo, no `origin`), consistent with prior phases' notes in `errorlog.md` ("not yet run on a live GitHub Actions instance — no remote repo configured"). The static/behavioral equivalent (QC's `tsc`/`eslint`/`jest 285/285` and QA's live Docker Compose behavioral pass) has already substituted for this gate per the QC/QA reports, and this stage's live rebuild+reboot is the DevOps-side substitute for the CI `build`/`migrate deploy` steps.

## 6. Health check results

- No dedicated `GET /api/health` route exists in this codebase (`404` on request) — the compose `HEALTHCHECK` instead does a raw TCP connect on port 4000 (`backend/Dockerfile` lines 47–48), which is what Docker's `healthy` status reflects. This is a pre-existing pattern from earlier phases, not new to Phase 4A; noting it here as an observation for a future Grafana/Prometheus setup (skill file §5), not a Phase 4 gap.
- Functional proxy for health: `GET /api/comments` (unauthenticated) → **401** — confirms the process is up, routing/guards are wired, and the DB-backed `SessionAuthGuard` is functioning, all within seconds of `healthy` status.
- `docker compose ps` — all 4 services `healthy` post-recreate: `postgres`, `redis`, `backend` (recreated this run), `frontend` (untouched, still healthy from its last boot).

## 7. Rollback plan

**Trigger conditions** (per skill file §6): health check fails 3x consecutive, crash loop, migration failure, error-rate spike once monitoring exists.

Since this release's migration is **additive-only** (new enums/columns/tables/indexes, nothing renamed or dropped), rollback is low-risk and does **not** require a down-migration to restore prior functionality — the previous code (`712a7c3`, last commit before Phase 4 in-tree work landed as `f828482`) will run correctly against the post-migration schema (it simply never queries the new tables/columns).

**Container rollback steps** (if Phase 4 code needs to be pulled back post-deploy):
```bash
git checkout 712a7c3 -- backend/          # or git revert f828482 for a clean history
docker compose build backend
docker compose up -d backend --force-recreate
docker compose logs backend --since=1m   # confirm clean boot
```
1. No down-migration is required — additive schema is forward-compatible with the old code.
2. If a hard schema rollback is ever needed anyway (e.g., disk-space/cleanup), the new tables/columns can be dropped manually; Prisma's `migrate resolve --rolled-back 20260719004112_phase4_comment_aggregation` marks it unapplied in `_prisma_migrations` first.
3. Verify: `docker compose ps` all healthy, `curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/api/posts` (a known Phase 2 route) returns 401 (not 500/502).
4. Notify PM and Bug Fixer with the failure logs before any further deploy attempt (skill file feedback-loop criteria).

## 8. Post-deployment smoke-check list (for Bug Fixer / next verification pass)

- [x] `docker compose ps` — all 4 services healthy
- [x] Backend boot log — zero errors/warnings, all modules initialized
- [x] `npx prisma migrate status` — up to date, 7/7 migrations
- [x] Partial unique indexes live in Postgres (`comments`, `escalation_alerts`)
- [x] All 11 comment/template routes mapped
- [x] `GET /api/comments` unauthenticated → 401 (not 404/500)
- [ ] Full authenticated smoke pass (login → sync → inbox → reply → escalation → purge) — already exhaustively covered by QA's live behavioral report (`docs/phase4-qa-report.md`); not re-run here since QA already exercised these against this exact commit's build.
- [ ] Fresh-volume boot test (`docker compose down -v && up`) exercising blank `SEED_ADMIN_PASSWORD` path end-to-end — recommended follow-up given §4.3, not performed in this pass since it would disturb the shared demo dataset QA/QC already validated against.

## 9. Known issues carried into monitoring

None new from this stage. Carried forward from QA (non-blocking):
- **P4-OBS-1**: `.env` / `backend/.env` `SEED_ADMIN_PASSWORD` drift on fresh volumes (§4.3 above, this report's own independent confirmation).
- QA's coverage notes on concurrent-sync race and per-post live failure isolation (covered by passing unit tests, not independently re-verified live here — demo dataset constraint, not a defect).

---

## Handoff to: Bug Fixer

**Verdict: DEPLOYED (demo/local).** Commit `f828482` is live on the Docker Compose stack. `docker compose build backend` succeeded clean; `docker compose up -d backend --force-recreate` reached `healthy` in 17s; `npx prisma migrate status` reports **7/7 migrations, "Database schema is up to date!"**, including `20260719004112_phase4_comment_aggregation`; both DB-enforced dedup constraints (`comments_platform_external_key`, `escalation_alerts_rule_key_window_start_key`) confirmed live via `\d` in Postgres, not just in the migration file. All 11 new comment/template routes confirmed mapped in the boot log; `GET /api/comments` returns 401 (guard active, not 404/500).

**New env/migration surface**: `SENTIMENT_IMPL` is genuinely new this release (Joi-validated, safe default `rule_based`, confirmed live via the `SentimentClassifierProvider` boot log line). `PUBLISHER_IMPL_FACEBOOK`/`PUBLISHER_IMPL_YOUTUBE` are pre-existing (Phase 2), unchanged this release. Neither is documented in `.env.docker.example`/`docker-compose.yml` — non-blocking (safe Joi defaults verified live) but a discoverability gap worth a follow-up doc patch.

**Rollout risks to watch**:
1. `SEED_ADMIN_PASSWORD` drift between top-level `.env` (blank) and `backend/.env` (`TestPassw0rd!2026XYZ`) — only the top-level `.env` value reaches the compose backend container. Non-issue on the current volume (idempotent seed, login already verified by QA); would surface as a P2F-OBS-1-style login failure on a **fresh** volume/reset.
2. No `GET /api/health` endpoint exists — Docker's `healthy` status is TCP-connect-only, not an app-level DB/Redis check. Pre-existing gap, not Phase 4-specific; worth a future Prometheus/Grafana pass per the skill file's monitoring template.
3. No live GitHub Actions run has ever occurred (no remote configured) — CI coverage of the new module is verified by script/command parity + this stage's local rebuild, not by a runner execution.

**Monitoring dashboards**: none provisioned yet — this demo stack has no Prometheus/Grafana/Sentry wired up (out of scope for Phase 4; see skill file §5 template for the reference setup to stand up in a future phase). In the interim, the only "dashboard" is `docker compose logs backend -f` and `docker compose ps`; Bug Fixer should tail those for anomalies (crash loops, exception-filter ERROR-level 401 noise flagged as a Phase-2-carryforward item in `errorlog.md`, or unexpected 5xx on the new `/api/comments*` routes).

Relevant files: `/Users/uthorn.y/Desktop/Content/content-hub/docs/phase4-deployment-report.md` (this report), `/Users/uthorn.y/Desktop/Content/content-hub/docker-compose.yml`, `/Users/uthorn.y/Desktop/Content/content-hub/backend/Dockerfile`, `/Users/uthorn.y/Desktop/Content/content-hub/backend/docker-entrypoint.sh`, `/Users/uthorn.y/Desktop/Content/content-hub/backend/prisma/migrations/20260719004112_phase4_comment_aggregation/`, `/Users/uthorn.y/Desktop/Content/content-hub/.github/workflows/ci.yml`.

# Error Log — Content Hub

Test failures / runtime errors found during build. Full root-cause detail lives in `CHANGELOG.md`; this file tracks status only.

## Phase 1 — Foundation

| ID | Severity | Found by | Summary | Status |
|---|---|---|---|---|
| BUG-001 | Critical | QA Tester (boot test) | Backend crash on startup: `Nest can't resolve dependencies of the THROTTLER:MODULE_OPTIONS` — `RedisThrottlerStorageService` declared in wrong module's `providers`. | Fixed — see CHANGELOG §"QA rejection fixes" |
| BUG-002 | Major | QA Tester (boot test) | `npm run prisma:seed` failed: `Environment variable not found: DATABASE_URL` — `ts-node` doesn't load `.env` directly. | Fixed — added `dotenv-cli` |
| BUG-003 | Critical | Found during BUG-001 fix verification | Backend crash: `Nest can't resolve dependencies of the QueueService` — circular `require` between `queue.module.ts` and `queue.service.ts`/processors. | Fixed — extracted `queue.constants.ts` |
| BUG-004 | Critical | Found during BUG-003 fix verification | Startup crash: `Queue name cannot contain :` — BullMQ rejects `:` in queue names. | Fixed — renamed `connected-accounts:refresh-token` → `connected-accounts-refresh-token` |

## Current test status (as of 2026-07-15 Deployment Report)

- Backend: 30/30 Jest unit tests passing
- Backend: lint (zero warnings) + typecheck passing
- Frontend: lint + typecheck + build passing
- Docker Compose demo stack: live-verified end-to-end (migrations, seed, login, session cookie, OAuth authorize redirect)
- CI workflow (`.github/workflows/ci.yml`): written, mirrors local commands, **not yet run** on a live GitHub Actions instance (no remote repo configured)

## Phase 1.5 — Compliance & Schema Gate (2026-07-16)

| ID | Severity | Found by | Summary | Status |
|---|---|---|---|---|
| QC-001 | Critical (process, not code) | QC review | Phase 2 WIP code (uncommitted, pre-existing) mixed in same working tree as Phase 1.5 delivery — `configuration.ts`, `env.validation.ts`, `audit-log.service.ts`, `main.ts`, Phase 2 schema fields (`posts.version`, `contents.file_size_bytes/mime_type`, `posted_unconfirmed` enum), out-of-order migration `20260716054701_phase2_publish_cms_ranking`. QC verdict REJECTED on tree hygiene; Phase 1.5 code itself verified correct. | Resolved — admin chose keep + separate commits (Phase 1.5 and Phase 2 WIP committed as distinct commits, nothing deleted) |
| QA-OBS-1 | Low | QA test | `pillar_ratio_policies` / `platform_cadence_targets` idempotency is app-layer only (no DB UNIQUE constraint) — safe now, duplicate risk if Phase 3+ writes concurrently | Open — flag for Phase 3 design |
| QA-OBS-2 | Low | QA test | Shipped `TargetAgeSegment` enum includes `18-22`/`46+` beyond the `23-30`/`31-45` documented in bussiness_rule.md | Open — docs sync needed |

- Phase 1.5 QA: SIGNED OFF. 39/39 tests, migration verified on real Postgres, seed idempotency verified ×2, live boot clean, 8 extra adversarial edge cases on copyright gate all fail-closed. Zero code bugs.

## Open / not yet tested

- No live remote CI run performed
- Phase 2+ features (CMS, ranking, publish, dashboard, comments, multi-platform) not built yet — no tests exist for them (note: partial Phase 2 WIP exists uncommitted-then-committed separately, untested by QA)

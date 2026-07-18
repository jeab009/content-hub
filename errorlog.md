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

## Phase 2 — CMS + Ranking + Publish (2026-07-17..18)

| ID | Severity | Found by | Summary | Status |
|---|---|---|---|---|
| P2-OBS-1 | Low (demo data) | dev smoke | Publish dispatch → `token_invalid` failure: connected_accounts rows (facebook, youtube) in demo volume were encrypted with a different `APP_ENCRYPTION_KEY` (prior session), so AES-GCM decrypt fails. Publish flow handled it correctly (clean fail, audit-logged, post→failed). NOT a code defect. | Open — re-connect accounts against current key to exercise full mock-publish success path; unit tests already cover mock adapter success + idempotency |
| BUG-QA-001 | Critical | QA (behavioral) | No guard against duplicate publish intents: 2 concurrent `POST /api/posts` same (content,platform) → 2 Post rows, each independently dispatchable → double-post path once tokens valid. Per-row claim ≠ cross-row guard. | **Fixed** `9a75424` — app-level 409 on active-duplicate + partial unique index `posts_content_platform_active_key` (race backstop, P2002→409). QA re-verified w/ 4-way concurrency. |
| BUG-QA-002 | High | QA (behavioral) | CMS ready-gate bypass: PATCH `contentPillar` only (comedy→drama) on ready row skipped copyright recheck → row stuck ready+cleared+no-evidence. Publish-time defense caught it (409) so no publish bypass, but data-integrity corrupt + shows ready in scheduler. | **Fixed** `9a75424` — `update()` recomputes gate against merged record whenever result would be ready. QA re-verified. |
| BUG-QA-003 | Medium | QA (behavioral) | Tie-break non-deterministic: RankingEngine (per-content query) vs Scheduler (batched query) picked different platform on tied scores → false was_override in audit. Documented RANKED_PLATFORMS tie-break never implemented. | **Fixed** `9a75424` — shared `pickRecommendedScore()` (score DESC, RANKED_PLATFORMS idx ASC) + secondary ORDER BY, used by both paths. QA re-verified all 3 surfaces agree. |

- **Phase 2 backend: QC APPROVED + QA SIGNED OFF** (2026-07-18). Tests 210→225 (+15 regression). QC static review missed all 3 bugs QA behavioral testing caught — reinforces value of running both.

- Phase 2A (CMS backend): 39→126 tests. Copyright gate at ready-transition verified live (comedy exempt, drama/product require evidence, fail-closed). Committed `ce524ac`.
- Phase 2B (ranking/publish/adapters): 126→210 tests. Verified live: ranking + 4-factor reasoning, step-up re-auth (empty→400/wrong→401/correct→ok), server-side was_override both directions, override reason persisted, idempotency claim (unit-tested "no double post"). Committed `4516195`.
- Two interruptions from Anthropic session limits mid-pass; both resumed and verified by main thread (lint/typecheck/tests/docker boot/curl) before committing — no fake success.

## Phase 2 Frontend (Pass C — 2026-07-18)

| ID | Severity | Found by | Summary | Status |
|---|---|---|---|---|
| P2F-OBS-1 | Low (dev env, not code) | main-thread verify | Login ทดสอบไม่ผ่าน (401): admin password ใน demo Postgres volume เป็น random ที่ seed script gen ตอน first boot แล้ว print ลง backend log ครั้งเดียว — log rotate/หายไปแล้ว. Backend `.env` มี `SEED_ADMIN_PASSWORD=TestPassw0rd!2026XYZ` แต่ user row สร้างก่อนหน้าด้วยรหัสอื่น (seed skip ถ้า user มีอยู่แล้ว). แก้: argon2.hash ค่าใน .env แล้ว UPDATE user row + reset `failedLoginAttempts=0`. ไม่ใช่ code defect — เป็น demo-data drift | Resolved (dev DB) — production seed ไม่กระทบ; ถ้า re-verify ครั้งหน้า login ด้วย `admin@example.com` / ค่าใน backend/.env |
| P2F-OBS-2 | Info | main-thread verify | Publish ทุกอันจบเป็น `failed` เพราะ connected-account token stale (P2-OBS-1 เดิม, AES-GCM decrypt fail จาก APP_ENCRYPTION_KEY คนละตัว). UI จัดการถูก: แสดง failed + ปุ่ม Retry, resolution flow ทำงาน. Full mock-publish success path ยังไม่เคยรันผ่าน UI (unit test cover แล้ว) | Open — re-connect FB/YouTube accounts กับ key ปัจจุบันเพื่อเห็น posted จริงผ่าน UI |

- **Frontend tests**: jest 24/24 ผ่าน (publish-logic 12 + copyright-gate 12), lint zero-warning, typecheck clean, `next build` (Docker image) ผ่าน. ไม่มี test fail / ไม่มี runtime error ใหม่จาก code.

## Phase 3 — Dashboard v1 (2026-07-18)

| ID | Severity | Found by | Summary | Status |
|---|---|---|---|---|
| P3-OBS-1 | Low (dev env, not code) | main-thread verify | api-sync happy path ทดสอบไม่ได้ตอนแรก: connected-account token ใน demo DB เข้ารหัสด้วย APP_ENCRYPTION_KEY เดิม → getValidToken decrypt fail ("Unsupported state or unable to authenticate data"). Ingestion จัดการถูก (per-post failed, isolated, ไม่ล้ม batch). แก้: re-encrypt token ของ FB/YT accounts ด้วย key ปัจจุบัน (mock placeholder token) เพื่อ exercise mock adapter → synced สำเร็จ | Resolved (dev DB) — mock mode ไม่สนใจค่า token; live ต้อง reconnect จริง |
| P3-OBS-2 | Info | design | Cron auto-sync ยังไม่ทำ — metric sync trigger ผ่านปุ่ม Sync (manual) เท่านั้น. BullMQ repeatable job (infra พร้อมใน QueueModule) ทำเป็น Phase 3.5 ได้ | Open — defer |

- **Phase 3A backend**: 236 tests (จาก 225, +11: adapter contract fetchMetrics, dashboard aggregation, ingestion isolation). Verified live บน Postgres: sync (mock synced), manual append, append-only history, dashboard latest-per-post. Adapter contract spec อัพเดต: fetchMetrics ไม่ throw PlatformCapabilityNotImplementedError แล้ว (Phase 3 เติม), เหลือ fetchComments/replyComment เป็น stub (Phase 4)
- **Phase 3B frontend**: jest 24/24, lint+typecheck clean, `next build` ผ่าน. Verified browser: dashboard render (KPI/trend/tables), Sync button, manual metric modal (201) → dashboard reflects latest-per-post. ไม่มี console error
- **Append-only invariant** ยืนยัน live: post เดียวมี 3 metric rows (2 manual + 1 api) เก็บครบ, dashboard total ใช้ row ล่าสุด (ไม่ sum ทับ)

## Carry-forward to Phase 2 kickoff (from Bug Fixer close-out, 2026-07-16)

- QC review + QA baseline ของ Phase 2 WIP commits ก่อนเขียนโค้ดใหม่ — migration `20260716054701_phase2_publish_cms_ranking` ถูก apply ใน demo DB แล้ว ต้อง treat schema เป็น already-live
- `ExceptionFilter` log 401 ปกติเป็น ERROR level พร้อม stack trace — จะเกิด alert noise เมื่อมี monitoring จริง, ลด expected auth failure เป็น WARN ใน Phase 2
- QA-OBS-1: เพิ่ม DB UNIQUE constraint ก่อน Phase 3
- QA-OBS-2: sync bussiness_rule.md กับ TargetAgeSegment enum

## Open / not yet tested

- No live remote CI run performed
- Phase 2 + Phase 3 (dashboard) เสร็จ + verified. **ยังไม่ build**: comment aggregation (Phase 4), TikTok/LINE (Phase 5) — no tests exist yet
- Full mock-publish success path ยังไม่เคยเห็น posted จริงผ่าน UI (token stale, P2F-OBS-2) — unit test cover แล้ว; metric api-sync happy path verified แล้วหลัง re-encrypt token (P3-OBS-1)
- Cron auto-sync + KPI alert ยังไม่ทำ (defer, ดู makedown §9.7)

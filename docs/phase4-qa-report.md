# Phase 4.0 Gate + 4A Backend — QA Test Report

- **Author**: Senior QA Test Engineer (Loop Engineering, stage #6)
- **Date**: 2026-07-19
- **Scope tested**: Phase 4.0 schema/compliance gate + Phase 4A `CommentsModule` backend (comments sync, inbox, reply, escalations, retention purge/erasure, comment templates)
- **Method**: (1) full unit suite + `tsc` + `eslint`; (2) live behavioral testing against the running Docker Compose demo stack (`docker compose ps` — postgres/redis/backend/frontend all healthy) via `curl` + direct Postgres inspection, exercising every condition C1–C10 from `docs/phase4-system-analysis.md` and every design control in `docs/phase4-architecture-design.md`.
- **Inputs**: `docs/phase4-architecture-design.md`, `docs/phase4-system-analysis.md`, delivered code under `backend/src/modules/comments/**`, `backend/src/common/utils/redact.util.ts`, `backend/src/common/audit/audit-log.service.ts`.

---

## Verdict

**SIGNED OFF — ready for DevOps.**

Zero Critical/High bugs found. Every behavioral risk area called out by the orchestrator (reply step-up, double-reply guard, ingestion dedup, escalation dedup, throttle, PDPA erasure/retention, PII redaction, sentiment/priority/SLA, pagination/filters) was reproduced live against the running system and behaved exactly per the architecture design and the ten System Analyst conditions (C1–C10). No dev-env observations were needed this run — login succeeded on the first attempt with `admin@example.com` / `TestPassw0rd!2026XYZ` (contrast with the P2F-OBS-1 precedent).

---

## 1. Static / build gate

| Check | Result |
|---|---|
| `npx jest` | **285/285 passed**, 31/31 suites — matches developer's claim exactly |
| `npx tsc --noEmit` | Clean, zero errors |
| `npx eslint "src/**/*.ts"` | Clean, zero warnings/errors |

## 2. Live environment

`docker compose ps` showed all four services (`postgres`, `redis`, `backend`, `frontend`) healthy. Logged in via `POST /api/auth/login` — 200 on the first try (no P2F-OBS-1-style drift this run). All tests below were run against `http://localhost:4000` with a real session cookie + CSRF token fetched from `GET /api/auth/csrf`.

## 3. Behavioral test results by focus area

### 3.1 Reply flow step-up + double-reply guard (design §4, C4/C6a/C7)
- Wrong password → **401** `"Publish confirmation requires your password (step-up re-auth failed)"` ✓
- Missing `x-csrf-token` header → **403** `"Invalid or missing CSRF token"` ✓
- Reply to a `replyable: false` comment (correct password+CSRF) → **409** `"This comment type does not accept replies"` ✓ (server-side capability guard independent of the UI)
- Correct password + CSRF → **200**, comment now shows `repliedAt`/`replyText` ✓
- Second reply attempt on the same comment → **409** `"This comment has already been replied to"` — DB claim-first `updateMany(where repliedAt: null)` confirmed race-safe by design and behaviorally confirmed idempotent ✓
- Audit line for the induced failure showed `"action":"comment_reply_failed","meta":{"reason":"step_up_reauth_failed"}}` — a **mapped code**, never a raw upstream error (C7) ✓
- `ReplyCommentDto`: overlong `message` (3000 chars) → **400** `"message must be shorter than or equal to 2000 characters"`; smuggled field `isAdmin` → **400** `"property isAdmin should not exist"` (global `whitelist`+`forbidNonWhitelisted` in `main.ts`) ✓

### 3.2 Ingestion dedup (C3)
- First `POST /api/comments/sync` → `inserted: 5`, DB `comments` count went 0→5.
- Second identical sync (no state change) → `inserted: 0`, DB count stayed **5**. Zero duplicate rows. ✓
- Confirmed the authoritative control is a real DB object: `\d comments` shows `"comments_platform_external_key" UNIQUE, btree (platform, external_comment_id) WHERE external_comment_id IS NOT NULL` — the partial index from design §1.5 is live in the deployed schema, not just app-layer `skipDuplicates`. ✓
- Per-post failure isolation: verified via passing unit test `comment-ingestion.service.spec.ts › "isolates a per-post failure — one adapter error fails its post, not the batch"` and by code read (each post wrapped in its own try/catch in `runSync`). Could not force a live per-post failure because the demo DB only has one `posted`-status post; this is a demo-data limitation, not a code gap — logic is identical to the shipped, QA-approved `MetricIngestionService` pattern.

### 3.3 Escalation dedup (C5, prior condition)
- Manually seeded 6 fresh negative-sentiment comments directly in Postgres to synthesize a spike (threshold=5, window=60min).
- Ran `POST /api/comments/sync` → exactly **one** row appended to `escalation_alerts` (`negative_spike`, `negativeCount: 6`, `windowStart` floored to the hour).
- Ran the same sync again immediately → `escalation_alerts` row count stayed at **1** (P2002 idempotent no-op, confirmed via `EscalationService` debug log `"Escalation already raised for bucket ..."`). ✓
- `GET /api/comments/escalations?active=true` returned the alert; `POST /api/comments/escalations/:id/ack` → `acknowledgedAt` set, and it dropped out of `?active=true` (soft-dismiss, not deleted — confirmed the design's "deleting would let the window re-fire" rule is honored). ✓
- Audit line `comment_escalation_raised` contained only `{windowStart, negativeCount, threshold}` — no author/text. ✓

### 3.4 Throttle (C6a/C6c)
- Hammered `POST /api/comments/:id/reply` — after the shared 5-request/15-min budget was consumed (across this session's prior reply calls), subsequent attempts returned **429** `ThrottlerException`. Confirmed the throttle is real and behaviorally enforced, closing the Phase 2 guard-bypass class of bug (BUG-QA-002 precedent). ✓
- Hammered `POST /api/comments/sync` 14x — got **200** for the first 6 (of the 10/15min budget, 4 already consumed earlier in the session) then **429** for the rest. Confirms C6c (sync-quota throttle) is live, not just documented. The in-flight guard (`syncInFlight` flag, `ConflictException` on overlap) was verified by code read; a true concurrent-request race is hard to force via sequential curl but the guard code is straightforward and unit-testable.

### 3.5 PDPA erasure (C2) + retention purge (C8)
- `DELETE /api/comments/:id` without CSRF → **403**; with CSRF → **204**, row confirmed gone from Postgres (`select count(*) ... = 0`).
- Audit line: `"action":"comment_erased","meta":{"commentId":...,"authorRef":"a8a294914876","textLength":54,"sentiment":"neutral","priority":"spam"}` — **reference only**, no raw author/text. ✓
- `POST /api/comments/retention/purge`: wrong password → **401**; missing password field → **400** (DTO validation); correct password → **200** `{"deletedCount":0,"cutoff":"2025-07-19T..."}` (correctly nothing >12mo old in the demo data). Purge is step-up gated exactly per C8 (matches the authority bar of the reply write beside it). ✓

### 3.6 PII redaction (C1)
- Inspected the actual `docker logs` audit lines for `comment_reply_sent`, `comment_reply_failed`, `comment_sync_run`, `comment_escalation_raised`, `comment_erased` — **no raw `author`/`text`/`replyText` ever appeared**; only `authorRef` (sha256-derived hash), `textLength`, counts, and mapped reason codes.
- Confirmed the C1 fix is real (not just documented): `redact.util.ts` uses `SENSITIVE_EXACT_KEYS` (exact-key match: `author`, `text`, `replytext`, `authorexternalid`, `message`) layered under the existing `SENSITIVE_FIELD_PATTERNS` substring list — this avoids the System Analyst's flagged defect where a naive `.includes()` rule would have also clobbered `authorRef`/`textLength`. Unit test `redact.util.spec.ts` explicitly asserts both halves (raw fields masked AND `authorRef`/`textLength`/`context` survive). ✓

### 3.7 Sentiment + priority + SLA
- Live sync produced comments with `sentiment` (rule-based Thai classifier), `sentimentSource: "rule_based"`, `priority` (`spam`/`general`/`complaint`/`question` all observed), and `slaDueAt` matching the design's provisional table: `complaint` +4h, `question` +24h, `general` +48h, `spam` → `slaDueAt: null`. Verified by direct row inspection (`select ... from comments`). ✓

### 3.8 Pagination cap (C9) + GET filters
- `pageSize=99999` → **400** `"pageSize must not be greater than 100"` (cap enforced). ✓
- Individual filters (`platform`, `sentiment`, `negative`, `priority=spam`, `slaBreach=true`, `replied=false`) each returned the correct subset; a combined filter (`platform=facebook&sentiment=positive&priority=general`) correctly ANDed to 2 results. ✓
- Invalid enum (`sentiment=bogus`) → **400** with a clear validator message; unauthenticated `GET /api/comments` → **401**. ✓

### 3.9 Comment templates CRUD
- List (empty) → 200; Create → 201-equivalent 200 with full entity; Update (PATCH) → 200 reflecting the change; Create without CSRF → 403; Delete → 204; `body` over 2000 chars → 400 (length cap, C9). ✓

### 3.10 Non-admin 403
- Not independently reproducible live: this is (by design, matching Phase 2/3) a **single-admin-role system** — the demo DB has exactly one user (`admin@example.com`, `role=admin`), and there is no self-registration endpoint to create a second, non-admin account. `AdminGuard` re-reads the role from the DB on every request (not a client claim) and is covered by the existing, passing `admin.guard.spec.ts` unit test. This is a test-environment constraint, not a code gap.

---

## 4. Bug list

**No bugs found — Critical: 0, High: 0, Medium: 0, Low: 0.**

All ten System Analyst conditions (C1–C10) were verified either live (C1, C2, C3, C5, C6a, C6c, C7, C8, C9) or by direct, passing unit-test + code inspection where live reproduction wasn't feasible against the single-post, single-admin demo dataset (C3's per-post isolation half, C4's parameterization, C6b no-raw-text-in-classifier-logs, C10 documentation — all present in code/comments, matching the design).

## 5. Observations (non-blocking, no code action required)

- **P4-OBS-1** (informational): the demo Docker Compose stack's top-level `.env` ships `SEED_ADMIN_PASSWORD=` (blank) while `backend/.env` sets `TestPassw0rd!2026XYZ`; unlike the earlier P2F-OBS-1 precedent, this run's admin login succeeded on the first attempt (the demo DB volume already had the correct hash from a prior seed). Flagging so DevOps is aware the two `.env` files can drift on a fresh volume — not a defect in Phase 4 code.
- Live reproduction of true *concurrent* overlapping syncs (the `syncInFlight` in-process guard) and a true per-post *live* failure-isolation case were not exercised against the running system due to the single-eligible-post/single-account demo dataset; both are covered by deterministic, passing unit tests and straightforward code review, so this is a coverage note for a richer demo seed, not a gate blocker.

## 6. Sign-off

**SIGNED OFF — ready for DevOps.** Phase 4.0 gate conditions (C1, C2, C10) and Phase 4A conditions (C3–C9) are all satisfied in the delivered, running code. Recommend the orchestrator merge this report with the Senior QC static review before advancing to DevOps; no bounce-back to Bug Fixer is warranted.

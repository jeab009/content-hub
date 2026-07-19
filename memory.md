# Memory — Content Hub Project

## Project

- **Goal**: สร้างระบบยิง content (สินค้า/ละครสั้น/คลิปตลก) เข้า social ทุกช่องทาง, target อายุ 23-45 ปี. ต้อง dashboard monitor user, revenue ต่อ content/platform, และเก็บ comment มาปรับปรุง content.
- **Status**: อยู่ phase design — ยังไม่ implement code. รอ Grill Gate answer (revenue model, priority platform, budget/timeline, compliance owner) ก่อนเข้า Phase 1.
- **Design doc**: [makedown.md](makedown.md) — screens, data model, tech stack, phase plan.
- **Prompt log**: [history_prompt.md](history_prompt.md)
- **Suggestions/comments**: [suggestion.md](suggestion.md)

## Decisions (confirmed 2026-07-15)

- **Revenue model**: มาจาก payout/monetization ที่แต่ละ platform ส่งเข้าช่องเรา (ไม่ใช่ affiliate/ยอดขายตรง). FB + YouTube มี API ดึง earnings จริง (Graph API `content_monetization_earnings`, YouTube Reporting API monetary metrics). TikTok/LINE ไม่มี public revenue API — ต้อง manual/export ทดแทน.
- **Ownership**: Admin คนเดียวดูแลทั้งหมด (platform priority, budget, compliance) — role model เรียบง่าย ไม่ต้อง multi-approval

- **Platform/priority**: ระบบจัด priority + เลือก platform ให้เอง (rule-based ranking, ดู [makedown.md](makedown.md) §8) — admin แค่กดยิง (execute), ไม่ auto-publish

## Decisions (2026-07-16 รอบสอง)

- **Budget/timeline**: เลื่อนไปกำหนดตอน phase UAT (plan เรียง dependency order ไว้แล้ว แปลงเป็น date ได้ทันที)
- **Pillar ratio + cadence**: ยืนยันใช้ค่า recommend — product 40/drama 30/comedy 30, FB 7/wk, YT 3/wk. `is_provisional` flip เป็น false แล้วทั้ง seed + live DB
- **Meta App Review**: connect Page ตัวเองเท่านั้น → Dev Mode sufficient, ไม่ต้อง submit review. ค้างกรอก App ID/Business Manager จริง

- **Ads/Paid**: ตัดสินแล้ว (2026-07-16) — **B-lite**: ไม่รวมเข้าระบบช่วง Phase 2-5, ใช้ Meta Ads Manager/TikTok Ads ตรงๆ, เก็บ requirement จริง, revisit เป็น Phase 7 ตอน Phase 5 จบ

## Remaining open decision

- ไม่มี decision ค้างแล้ว — ทุก gate ก่อน Phase 2 ปิดครบ (budget/timeline ไปกำหนดตอน UAT ตามตกลง). Phase 2 พร้อมเริ่มเมื่อ admin สั่ง
- Gap analysis อื่นๆ (ดู [makedown.md](makedown.md) §10): comment SLA/escalation, copyright workflow — จัดเข้า Phase 4/1.5 แล้วใน plan v2

## Build status (2026-07-16)

- **Implemented**: Phase 1 (foundation) + **Phase 1.5 (Compliance & Schema Gate)** — schema amendment (copyright gate fields, `content_assets`, `pillar_ratio_policies`, `platform_cadence_targets`), `CopyrightGateService` fail-closed, seed provisional defaults. QA signed off 39/39 tests บน Postgres จริง. ดู [makedown.md](makedown.md) §9.5
- **Phase 2 backend เสร็จ + ผ่าน QC/QA (2026-07-17..18)**: CMS (ContentController CRUD+upload+asset, copyright gate), Ranking v1 (explainable, ranking_scores), Publish flow (step-up re-auth, server-side was_override, idempotency, posted_unconfirmed resolution), FB+YouTube adapters (mock/live gating), Google OAuth connect flow, Scheduler overview. commits `ce524ac`+`4516195`+`9a75424`(bug fixes). **QC APPROVED + QA SIGNED OFF**. QA เจอ 3 bug (dup-publish critical, ready-gate bypass high, tie-break medium) แก้หมดแล้ว. 225 tests
- **Phase 2 frontend เสร็จ (2026-07-18)**: Pass C1 CMS UI (`c5195a1`) + Pass C2 Scheduler/Publish UI — หน้า `/scheduler` (cadence cards, ready-to-publish table, rank/re-rank, PublishConfirmModal พร้อม score reasoning + override reason + step-up password) และ `/posts` (status filter, content title map, Retry modal, posted_unconfirmed resolution: Mark posted / Not posted). Verify แล้วบน Docker stack จริงผ่าน browser: rank, publish override (server ตอบ wasOverride=true), retry 200, resolve-not-posted กลับเป็น failed. typecheck+lint+jest 24/24 ผ่าน. หมายเหตุ: admin password ใน dev DB ถูก reset เป็นค่า `SEED_ADMIN_PASSWORD` ใน backend/.env ระหว่าง verify (ตัวเดิมเป็น random ที่ log หายไปแล้ว)
- **Phase 3 เสร็จ (2026-07-18)**: Dashboard v1 (metric ingestion + revenue/reach dashboard).
  - **3A backend** (`5a2aeb7`): adapters เพิ่ม `fetchMetrics` (mock/live gated เหมือน publish — mock = deterministic synthetic snapshot จาก post.id+age, live = FB Graph insights / YouTube Analytics API). MetricsModule: append-only ingestion (`POST /api/metrics/sync` ดึง metric ของ post ที่ live บน FB/YT, per-post failure isolated ไม่ล้ม batch), manual entry (`POST /api/posts/:id/metrics`), history (`GET`). DashboardModule: `GET /api/dashboard/overview` (KPI totals latest-per-post, per-platform, cumulative daily trend) + `/revenue` (by content/platform). Metric append-only ตาม System Analyst condition #3 — ไม่มี PATCH/DELETE. 236 backend tests
  - **3B frontend** (`98f6cf1`): หน้า `/dashboard` (KPI cards, SVG trend chart dependency-free, revenue-by-platform/content tables, Sync metrics button), Add-metric modal ใน `/posts` (manual append). Verified end-to-end บน Docker: sync, manual entry, latest-per-post aggregation
  - Dev-env note: re-encrypt connected-account tokens ใน demo DB ด้วย APP_ENCRYPTION_KEY ปัจจุบัน (mock token) เพื่อ verify api-sync happy path — ดู [errorlog.md](errorlog.md) P3-OBS-1
- **Phase 4.0 gate + 4A backend เสร็จ + ผ่าน QC/QA (2026-07-19)** (`f828482`): CommentsModule — sync (FB/YT mock, dedup partial-unique index), inbox `GET /api/comments` (filter platform/sentiment/priority/SLA/replied), reply (step-up + CSRF + double-reply guard + PII-redacted audit), rule-based Thai sentiment + priority + SLA, escalation dedup (negative spike → 1 alert), retention purge 12mo + PDPA erasure, comment templates CRUD. 285 tests. QA SIGNED OFF zero bugs, Bug Fixer verdict **CONTINUE LOOP → build 4B frontend**. API contract frozen. ดู docs/phase4-*.md
- **Phase 4B frontend เสร็จ + ผ่าน QC/QA (2026-07-19)** (`0eca262`): `/comments` inbox + reply composer modal (step-up) + escalation banner. QC APPROVED WITH CONDITIONS (3 UX-minor non-blocking), QA CONDITIONAL (browser tools ไม่ได้ granted → curl+jest+source audit แทน, clean). 1 Low bug BUG-QA-4B-01 (step-up message copy bleed) แก้แล้ว action-neutral. frontend 44 tests. **Phase 4 ปิดสมบูรณ์ end-to-end**
- **Phase 5.0 gate + 5A backend เสร็จ (2026-07-19)** (`9e5c4e8`): migration (`Post.external_post_url`, `publish_method` enum adapter|manual_external), seed cadence TikTok 14/wk + LINE 3/wk (is_provisional=false), TikTok/LINE adapters (mock default, live = unverified stub), registry ครบ 4 platform, **manual-external-record endpoint** (step-up + CSRF + server-side was_override + duplicate 409 + copyright gate บังคับ), **RankingEngineV2Service** (v1 byte-frozen, engagement blend revenue + factor ใหม่ `override_feedback`, flag `RANKING_ENGINE` default v1, golden regression test v2==v1 บน legacy), **CSV export 3 reports** (revenue drill-down, override log, comment summary aggregate-only PDPA — byte-level test ยืนยัน 0 leak). **285→378 tests**
  - Dev catch สำคัญ: `RANKED_PLATFORMS` ทำ 2 หน้าที่ (tie-break order + v1 scoring set) — append tiktok/line_oa จะทำให้ v1 เขียน 4 rows แทน 2 (พัง frozen constraint). แยกเป็น `PLATFORM_TIE_BREAK_ORDER` (4 ตัว) + `RANKED_PLATFORMS` (v1, 2 ตัว frozen) + `RANKED_PLATFORMS_V2` (4 ตัว)
- **Phase 5A ผ่าน QC/QA แล้ว (2026-07-19)**: QC APPROVED (zero findings ทุกระดับ), QA SIGNED OFF (zero Critical/High). 2 Low doc-findings แก้แล้ว (stale comment, golden-regression caveat). **สำคัญ: v2 พลิกคำแนะนำจาก v1 ได้สำหรับ pillar ที่มี override history จริง** — `override_feedback` scope เป็น (pillar, platform) — ถูกต้องตาม design, document ไว้ใน golden test แล้ว
- **Phase 5B frontend เสร็จ (2026-07-19)** (`931dbde`): 4-platform รองรับทั่ว UI, ManualExternalRecordModal (step-up + override reason + 409/429 handling), ScoreReasoning รองรับ v2 factor ที่ 5 (override_feedback counts + neutral flag), revenue drill-down `/dashboard/revenue/[contentId]`, ปุ่ม export CSV 3 จุด. jest 44→78. **QC REJECTED (COMMENT_PLATFORMS ขยายผิดเป็น 4 — backend รองรับแค่ FB/YT) → แก้แล้ว → APPROVED + QA SIGNED OFF**. หมายเหตุ: browser tools ไม่ available ทั้ง 4B/5B QA — ยังไม่มีใครเห็น UI รันจริงด้วยตา
- **Not implemented**: 5C (live adapters + PDF), 4C model sentiment. Cron auto-sync defer (Phase 3.5 bundle) — ตอนนี้ manual Sync button
- **Phase 5D เสร็จ (2026-07-19..20)**: 5D.1 (`2f1aff1`) แก้ BUG-P5-02 engine-scoped score reads (v1/v2 ไม่ปนกันอีก) + audit trail persist ลง DB (รอด restart, redaction ครบ, ไม่ block business op) 378→401 tests. 5D.2 แก้ chart label clipping (BUG-P5-01) + error mapping (QA5B-OBS-2) 88→92 tests
  - **Visual QA ครั้งแรกของโปรเจกต์** (main thread ใช้ browser tools เอง หลัง QA subagent 2 รอบไม่มี tools และปฏิเสธจะแกล้งทำ): เดินครบทุกหน้า ยืนยัน fix ทั้ง 4 ตัวด้วยตา, **เห็น v2 5-factor panel ครั้งแรก** (weights 100%, contributions=total เป๊ะ, override_feedback อ่านเข้าใจ), 401/409 flow ถูก, 0 console error, 0 HTTP 500. **ไม่พบ bug ใหม่**
- **v2 เปิดแล้ว (2026-07-20)** — `RANKING_ENGINE` default = `v2` ทั้ง configuration.ts / env.validation / docker-compose / .env.example. Admin ยืนยันตอนปิด 5D. Re-rank ready content ครบทั้ง 3 ตัวแล้ว (4 platform ต่อ content, engine v2) ไม่มีอะไรอ่านเป็น unranked. คำแนะนำพลิกเป็น TikTok บน comedy pillar ตามที่คาด. 401 tests ยังผ่านหมดกับ default ใหม่. Rollback = ตั้ง `RANKING_ENGINE=v1` + re-rank (reads แยก engine ทั้งสองทาง ไม่ผสม)
- Carry-forward (non-blocking): QC 4B 3 UX-minor, QA5B-OBS-1 (manual-external อยู่แค่ /scheduler), audit retention policy (`auth.login.failure` เก็บ email ใน actor = PII ชิ้นเดียว, System Analyst ตัดสิน), QA-OBS-2 docs sync, cron auto-sync, 401-log-noise WARN downgrade, 5C (live adapters + PDF) ยังไม่ทำ
- Phase 1.5 ค้าง: Meta App Review submission (admin ต้องกรอก docs/meta-app-review-status.md), ยืนยันตัวเลข pillar ratio + cadence target จริง (ตอนนี้ provisional 40/30/30, FB 7/wk, YT 3/wk)
- Known bugs BUG-001~004 (Nest DI, dotenv, circular import, queue name) — ทั้งหมด fixed แล้ว ดู [errorlog.md](errorlog.md)

## Reference files

- [errorlog.md](errorlog.md) — test failures/error ที่เจอระหว่าง build
- [bussiness_rule.md](bussiness_rule.md) — business rule ที่ confirm แล้ว (แยกจาก design/tech detail)

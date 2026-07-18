# Content Hub — Design & Implement Plan

Platform: source ยิง content (สินค้า/ละครสั้น/คลิปตลก) ไป social ทุกช่อง + dashboard monitor user, revenue, comment.
Target audience: 23-45 ปี.

## 1. System Modules

1. **Content Source (CMS)** — เก็บ content, tag ประเภท (product/drama/comedy), asset (video/image/caption), schedule.
2. **Distribution Engine** — ยิง content ไป social API (Facebook, TikTok, Instagram, YouTube, Line OA) ตาม schedule/queue.
3. **Dashboard**
   - User monitor: ผู้เข้าใช้งาน, engagement, reach per platform
   - Revenue monitor: รายได้ต่อ content, ต่อ platform, ต่อช่วงเวลา
   - Comment aggregator: ดึง comment จากทุก platform เข้า inbox เดียว, tag sentiment, ใช้ปรับปรุง content
4. **Auth/Account** — multi-user, role (admin/creator/viewer), connect social account (OAuth per platform)

## 2. Screens (UI)

- **Login / Workspace select**
- **Content Library** — grid, filter by type/status/platform, upload/create new
- **Content Editor** — caption, media, target platforms, schedule time, target age tag
- **Scheduler / Queue** — calendar view ของ content ที่จะยิง
- **Dashboard: Overview** — KPI card (reach, revenue, engagement, active users) + trend chart
- **Dashboard: Revenue** — table/chart รายได้แยกตาม content/platform
- **Dashboard: Comments** — inbox รวม comment, filter sentiment, reply
- **Settings** — connect social account, notification, team member

## 3. Data Model (high level)

- `content(id, type, title, media_url, caption, target_age_min, target_age_max, status, created_by)`
- `post(id, content_id, platform, priority_score, recommended_at, scheduled_at, posted_at, status, executed_by, external_post_id)`
- `metric(id, post_id, platform, reach, engagement, revenue, collected_at)`
- `comment(id, post_id, platform, author, text, sentiment, collected_at)`
- `user(id, name, role, connected_accounts)`

## 4. Tech Stack (proposed)

- Backend: Node.js/NestJS or Python/FastAPI + PostgreSQL
- Queue/Scheduler: Redis + BullMQ (หรือ Celery)
- Frontend: React + Tailwind, chart ด้วย Recharts
- Social integration: Meta Graph API, TikTok API, YouTube Data API, LINE Messaging API
- Hosting: Docker + cloud (AWS/GCP)

## 5. Implementation Plan (step-by-step, แบ่ง phase)

Status: Grill Gate ตอบครบแล้ว (revenue model, ownership, platform/priority) — เหลือ budget/timeline ตัวเลข. เริ่ม Phase 1 ได้.

### Phase 1 — Foundation (infra + auth)
1. Init repo (backend + frontend monorepo หรือแยก), CI lint/test พื้นฐาน
2. ออกแบบ + migrate DB schema จริง (`content`, `post`, `metric`, `comment`, `user`) ตาม §3
3. Auth admin (login เดียวก่อน, role เดียว)
4. เชื่อม pilot platform แรก (แนะนำ Facebook ก่อน เพราะมี earnings API พร้อม) — OAuth connect account, เก็บ token
5. Setup queue infra (Redis + BullMQ หรือเทียบเท่า) สำหรับงาน schedule/post ทีหลัง

**Exit criteria**: login เข้าได้, connect FB page ได้, DB schema พร้อมใช้

### Phase 2 — Content CMS + Ranking + Manual Publish
1. Content CMS: upload media, กรอก caption, tag type (product/drama/comedy), tag target age
2. Scheduler/Queue UI: list content พร้อมโพสต์
3. Ranking engine v1 (rule-based): คำนวณ priority_score ต่อ (content, platform) จาก engagement/earnings history + API availability weight (ดู §8)
4. Publish flow: admin กด "ยิง" ทีละ platform (manual trigger call API จริง) → บันทึก `post` record, status, external_post_id
5. เพิ่ม platform ที่ 2 (YouTube) เข้า pipeline เดียวกัน

**Exit criteria**: content ถูก rank + admin ยิงจริงไป FB/YouTube ได้ end-to-end, เห็นสถานะ posted

### Phase 3 — Dashboard v1 (user + revenue)
1. Pull metric จาก FB Graph API (`content_monetization_earnings`) + YouTube Reporting API (monetary scope) ตาม cron/job
2. Overview dashboard: KPI card (reach, revenue, active user) + trend chart
3. Revenue table แยกตาม content/platform
4. TikTok/LINE ใส่ revenue แบบ manual input ฟอร์มก่อน (ยังไม่มี API)

**Exit criteria**: admin เห็นรายได้จริงต่อ content/platform ใน dashboard

### Phase 4 — Comment Aggregation
1. Pull comment จากทุก platform ที่ connect แล้ว (webhook หรือ polling ตาม API แต่ละเจ้า)
2. Sentiment tagging (ใช้ off-the-shelf Thai sentiment model)
3. Inbox UI รวม comment, filter by platform/sentiment, reply ได้ (ถ้า API รองรับ)

**Exit criteria**: comment จากทุก platform เข้า inbox เดียว, sentiment tag แสดงผล

### Phase 5 — Multi-platform Expansion + Analytics เต็มรูป
1. เพิ่ม TikTok, LINE OA เข้า publish pipeline (manual publish เหมือนเดิม, revenue ยัง manual)
2. Ranking engine v2: ใช้ data จริงที่สะสมมา ปรับ weight score ให้แม่นขึ้น
3. Export report (CSV/PDF), revenue chart drill-down ต่อ content
4. Log override tracking (admin ยิงตามคำแนะนำ vs override) → feed กลับเข้า ranking model

**Exit criteria**: ครบ 4 platform, ranking แม่นขึ้นจาก real data, export report ใช้งานได้

## 6. Revenue Model (confirmed)

Revenue = payout จากแต่ละ platform ส่งเข้าช่องเรา (creator monetization/ad-share), ไม่ใช่ยอดขายตรง/affiliate. ดังนั้น metric schema ต้อง pull "earnings" จาก API/dashboard เฉพาะ platform ไม่ใช่คำนวณเอง.

Research per platform (2026):

- **TikTok** — Creator Rewards Program, ~$0.40–$1.00/1,000 qualified view (60s+ video), no public earnings API found — ต้องดึงจาก Creator Studio dashboard (export/manual หรือ scrape ถ้า TikTok ไม่เปิด API ส่วนนี้)
- **Facebook/Meta** — มี metric `content_monetization_earnings` ผ่าน Graph API insights (ตั้งแต่ Meta รวม Content Monetization Program, ส.ค. 2025) ใช้ได้ level page/post ต่อช่วงเวลา — **มี API จริง**, ใช้เชื่อมตรงได้
- **YouTube** — YouTube Reporting API มี metric `estimated_partner_ad_auction_revenue`, `estimated_partner_ad_reserved_revenue`, `estimated_partner_red_revenue` — ต้อง OAuth scope สำหรับ monetary report (yt-analytics-monetary.readonly) — **มี API จริง**
- **LINE OA (Thailand)** — ไม่พบ public revenue-share API สำหรับ LINE OA ทั่วไป (LINE Creators Market มี revenue-share term แยกต่างหาก คนละ product) — ถ้าใช้ LINE OA เพื่อขายของ ต้อง track revenue เองผ่านระบบขาย ไม่ใช่จาก LINE

**สรุปผลต่อ metric schema**: platform ที่มี API จริง (FB, YouTube) → sync earnings อัตโนมัติ. TikTok/LINE → ต้อง manual input หรือหาทางเชื่อม third-party/export ทดแทน จนกว่าจะมี API เปิดให้.

## 7. Ownership (confirmed)

Admin คนเดียวดูแลทั้งหมด — budget/timeline, content compliance. ไม่ต้องออกแบบ multi-role approval flow ซับซ้อน ช่วงแรก, ทำ role เดียว (admin) พอ, เผื่อ extend ทีหลัง.

## 8. Platform/Priority Engine (confirmed)

ระบบเป็นคน**จัด priority + เลือก platform** ให้ต่อ content แต่ละชิ้น (ไม่ใช่ admin เลือกเอง). Admin มีหน้าที่แค่**กดยิง (execute publish)** ตามคำแนะนำ/คิวที่ระบบจัดมา — ไม่ auto-publish เอง ต้องผ่าน admin confirm ทุกครั้ง (กัน content ผิดพลาด/ละเมิด).

**Ranking logic (v1, rule-based)**:
- input: content type (product/drama/comedy), earnings-per-platform ย้อนหลัง (จาก §6 metric), engagement rate ต่อ platform, API availability (FB/YouTube > TikTok/LINE เพราะ sync earnings อัตโนมัติ)
- output: แนะนำ platform เรียง priority + เวลาที่ควรโพสต์ (ตาม engagement window ของ audience 23-45 ปี)
- Phase แรกใช้ weighted-score เทียบ historical revenue+engagement ต่อ (content type, platform) — ยังไม่ต้อง ML model, เพิ่ม scoring model ทีหลังได้เมื่อมี data พอ

**UI**: หน้า Scheduler/Queue โชว์ content ready-to-post พร้อม platform ranking (badge "แนะนำ" เรียงจากคะแนนสูงสุด) → admin เลือก "ยิงเลย" per platform ทีละอัน หรือ "ยิงตามคำแนะนำทั้งหมด" (batch, ยัง require confirm ก่อน execute จริง)

## 9. Remaining Open Question

- Budget/timeline ยังไม่ระบุตัวเลขจาก admin

## 9.5 Phase Plan v2 (2026-07-16, จาก Loop Engineering PM pass)

Phase map ปรับใหม่ — เพิ่ม Phase 1.5 เป็น blocking gate:

| Phase | ชื่อ | สถานะ | ขึ้นกับ |
|---|---|---|---|
| 1 | Foundation | **เสร็จ, verified** | — |
| 1.5 | Compliance & Schema Gate | **เสร็จ (2026-07-16)** — schema migrate แล้ว, copyright gate service + tests, seed provisional defaults; เหลือ Meta App Review submission (ค้าง admin) | Phase 1 |
| 2 | Content CMS + Ranking v1 + Manual Publish (FB+YouTube) | **เสร็จ (2026-07-18)** — backend QC APPROVED + QA SIGNED OFF (225 tests); frontend Pass C1 (CMS UI, `c5195a1`) + Pass C2 (Scheduler/Publish/Posts UI, `910e4b1`), verified end-to-end บน Docker stack | Phase 1.5 |
| 3 | Dashboard v1 (revenue/reach) | **เสร็จ (2026-07-18)** — metric ingestion (mock/live adapter fetchMetrics, append-only) + dashboard read model + UI, verified end-to-end. KPI target/alert ยัง defer (ดู §9.7) | Phase 2 |
| 4 | Comment Aggregation (+SLA/escalation) | ยังไม่เริ่ม — **PDPA gate**: ต้องมี DPA กับ sentiment vendor + retention policy ก่อน ship | Phase 2 (ขนานกับ 3 ได้) |
| 5 | TikTok/LINE + Ranking v2 + Export | ยังไม่เริ่ม | Phase 3+4 |
| 6 | Optimization Backlog (A/B test, competitor benchmark) | backlog, ยังไม่ commit | Phase 5 |
| — | Ads/Paid Module | **ตัดสินแล้ว (2026-07-16): B-lite** — แยกนอกระบบ, ใช้ Ads Manager ตรงๆ ช่วง Phase 2-5, revisit เป็น Phase 7 candidate ตอน Phase 5 จบ | revisit หลัง Phase 5 |

**Phase 1.5 สิ่งที่ส่งมอบแล้ว**: enum 6 ตัว, `Content` +5 fields (`content_pillar` nullable/fail-closed, `target_age_segment` nullable รอยืนยัน, `copyright_cleared` 3-state, `copyright_notes`, `copyright_evidence_url`), ตารางใหม่ `content_assets`/`pillar_ratio_policies`/`platform_cadence_targets`, `CopyrightGateService.canMarkCopyrightCleared()` (comedy ผ่านเลย, drama/product ต้องมี evidence URL), seed provisional (40/30/30, FB 7/wk, YT 3/wk — `is_provisional=true` ทุกแถว)

**System Analyst conditions (9 ข้อ, gate phase ถัดไป)**: strip PII ก่อนส่ง sentiment vendor + DPA + retention 12 เดือน (gate Phase 4), Meta scope justification matrix (gate Phase 2-4 review), `copyright_evidence_url` บังคับ drama/product (ทำแล้วใน 1.5), manual metric append-only (gate Phase 3), step-up re-auth publish/revenue/reply + CSRF ทุก mutating route ใหม่ + audit_log รวมศูนย์ (gate Phase 2-4), publish idempotency + server-side recompute `was_override` (gate Phase 2), alert dedup (gate Phase 3/4), PlatformAdapter contract tests (gate Phase 5), PROVISIONAL badge ใน UI (gate Phase 2)

## 9.6 Phase 2 Frontend (Pass C) — เสร็จ 2026-07-18

Stack: Next.js 14 App Router + Bootstrap 5 (ตาม frontend เดิม Phase 1). ทุกหน้า client component, auth ผ่าน session cookie + CSRF header (api-client wrapper).

**Pass C1 — CMS UI** (`c5195a1`): หน้า Content library (`/content` list+filter+archive), Content editor (`/content/new`, `/content/[id]/edit`) — สร้าง/แก้ content, upload media, จัดการ per-platform asset, copyright gate enforcement ฝั่ง UI (ต้องมี evidence URL ก่อน mark cleared สำหรับ drama/product; logic shared ใน `copyright-gate.ts` + test)

**Pass C2 — Scheduler + Publish + Posts UI** (`910e4b1`):
- **`/scheduler`** — cadence progress cards ต่อ platform (published/target ต่อ period + pace badge on_pace/under_target/target_met), ตาราง ready-to-publish backlog พร้อม latest ranking scores + recommended platform, ปุ่ม Rank/Re-rank (เรียก `POST /contents/:id/rank`)
- **`PublishConfirmModal`** — เลือก platform (default = recommended), แสดง score + explainable factor breakdown (`ScoreReasoning` component, ตาราง weight/value/contribution/inputs), บังคับกรอก override reason เมื่อเลือก platform ≠ recommended, บังคับ step-up password. Client-side logic (`publish-logic.ts` + test 12 เคส) mirror backend แต่ backend ยังเป็น source of truth ของ `wasOverride`
- **`/posts`** — ตาราง post ทั้งหมด + status filter, map content title, ปุ่ม Retry (เฉพาะ draft/failed, step-up password modal), resolution ของ `posted_unconfirmed`: "Mark posted" (กรอก external post ID) / "Not posted" (reopen เป็น failed)
- Nav เพิ่ม link Scheduler + Posts

**Verify (browser จริงบน Docker stack)**: login → rank content (score เปลี่ยน, recommended flip YouTube 0.625) → publish override เป็น Facebook (server ตอบ `wasOverride=true`, override reason persisted) → retry dispatch 200 → resolve-not-posted (post กลับเป็น failed, version bump ใน DB). typecheck + lint + jest 24/24 ผ่าน, ไม่มี console error. ดู [errorlog.md](errorlog.md) §Phase 2 Frontend

## 9.7 Phase 3 — Dashboard v1 (เสร็จ 2026-07-18)

Exit criteria (§5 Phase 3) บรรลุ: admin เห็นรายได้จริงต่อ content/platform ใน dashboard.

**Metric ingestion model**: append-only (System Analyst condition #3). ทุก reading = insert row ใหม่ (source `api` หรือ `manual`), ไม่มี update/overwrite. Dashboard "current" ต่อ post = reading ล่าสุด (max collectedAt); totals/breakdown sum latest-per-post; trend replay reading เรียงเวลาแล้ว snapshot cumulative ต่อวัน.

**3A Backend** (`5a2aeb7`):
- `PlatformAdapter.fetchMetrics(args)` เปลี่ยนจาก stub → คืน `MetricSnapshot {reach, engagement, revenue}`. Mock/live gated ด้วย `PUBLISHER_IMPL_*` เหมือน publish: mock = synthetic deterministic (seed จาก post.id, scale ตามจำนวนวัน live → trend ขึ้น), live = FB Graph `/insights` (`post_impressions_unique`, `post_engaged_users`, `content_monetization_earnings`) / YouTube Analytics API `reports.query` (`views`, `likes+comments+shares`, `estimatedRevenue`). Token check faithful ทั้ง mock/live
- **MetricsModule**: `MetricIngestionService.syncApiMetrics` (loop post ที่ status posted/posted_unconfirmed + platform FB/YT, resolve connected account + token ผ่าน `getValidToken`, append api row; per-post failure isolated รายงานเป็น skipped/failed ไม่ล้ม batch), `MetricsService` (manual append + history). Endpoints: `POST /api/metrics/sync`, `POST /api/posts/:id/metrics`, `GET /api/posts/:id/metrics`. Admin + CSRF, ไม่มี PATCH/DELETE
- **DashboardModule**: `GET /api/dashboard/overview` (totals reach/engagement/revenue + postsWithMetrics/contentsWithMetrics, byPlatform, trend), `GET /api/dashboard/revenue` (byContent, byPlatform, totalRevenue). Read-only, pure JS aggregation
- reuse: export `PlatformAdapterRegistry` จาก PublishModule (single source of truth mock/live), `toAssetPlatform` reverse map เพิ่มใน platform-map util

**3B Frontend** (`98f6cf1`): หน้า `/dashboard` (KPI cards, SVG cumulative-revenue trend chart แบบ dependency-free, revenue-by-platform/content tables, ปุ่ม Sync metrics), Add-metric modal ใน `/posts` (manual append-only entry, reach/engagement/revenue THB/collectedAt). api-client + labels + THB/count formatter, nav เพิ่ม Dashboard

**Verify (browser จริงบน Docker)**: Sync (1 synced ผ่าน mock adapter), manual entry (201), history append-only (2 manual + 1 api row เก็บครบ ไม่ทับ), dashboard totals = latest-per-post (ไม่ sum ซ้ำ), trend cumulative ต่อวัน. 236 backend + 24 frontend tests. ดู [errorlog.md](errorlog.md) §Phase 3

**Defer จาก Phase 3 (ยกไป Phase 3.5/5)**: (1) cron auto-sync — ตอนนี้ trigger ผ่านปุ่ม Sync manual (BullMQ repeatable job ทำได้ทีหลัง, infra พร้อม); (2) KPI target/threshold + alert (gap §10 Analytics/Growth) — dashboard ตอนนี้แสดงผลอย่างเดียว ยังไม่มี target/alert; (3) TikTok/LINE manual revenue form — endpoint manual รองรับแล้ว แต่ platform ยังไม่ publish (Phase 5)

## 10. Gap Analysis (2026-07-16) — ยังไม่อยู่ใน scope ปัจจุบัน

Current build = Phase 1 เท่านั้น (infra/auth/DB/FB OAuth/queue, ดู README.md). ด้านล่างคือ gap นอกเหนือ §1-9 เดิม, แยกตามหมวด — ยังไม่ได้ตัดสินใจว่าจะเพิ่มเข้า scope program นี้หรือแยกระบบ:

### Content Strategy
- Content cadence/frequency target ต่อ platform (ยังไม่มีใน Scheduler screen §2 — ตอนนี้แค่ calendar view ว่างเปล่า ไม่มี target)
- Content pillar ratio (product/drama/comedy) ต่อ platform — ป้องกัน content ผิด mix จาก algorithm bias แต่ละช่อง
- Platform-native format adaptation — ตอนนี้ data model `content.media_url` เป็นตัวเดียว (§3) ยิงทุก platform ใช้ asset เดียวกัน ไม่ crop/aspect ratio ต่างกัน (TikTok 9:16 vs FB feed vs YouTube Shorts)
- A/B creative test (caption/thumbnail variant) ก่อนเลือกยิงจริง — ไม่มีใน flow ปัจจุบัน

### Ads/Paid (ยังไม่มี module เลย)
- ระบบปัจจุบัน = **organic distribution only**. ถ้าต้องการ "ยิง Ads" จริง (ตามชื่อ role ที่ user ระบุ) ต้องเพิ่ม module ใหม่ทั้งก้อน: ad account connect (Meta Ads API/TikTok Ads API แยกจาก organic OAuth ที่มีอยู่), budget allocation ต่อ platform, campaign objective, spend vs revenue ROI dashboard
- Revenue modelที่ confirm แล้ว (§6) เป็น monetization payout เท่านั้น ไม่ใช่ ad-spend ROI — ต้องเปิด decision ใหม่ถ้าจะรวม ads spend เข้า metric schema

### Customer Engagement (Phase 4 comment aggregator ยัง thin)
- Response SLA / priority tag (complaint vs question vs spam) — ไม่มีใน §1.3 comment aggregator เดิม
- Escalation rule (negative sentiment spike → alert)
- Canned reply template
- Audience sub-segment (23-30 vs 31-45) — ถูก flag ใน suggestion.md แต่ยังไม่เข้า data model

### Compliance/Legal
- Copyright/license clearance workflow ผูกเข้า Content Editor (เช่น required field ก่อน publish) — ยัง flag ใน suggestion.md เฉยๆ ไม่เข้า schema
- `docs/meta-app-review-status.md` ยัง blank — ต้อง admin กรอกก่อนใช้ OAuth นอก local dev

### Analytics/Growth
- Competitor benchmark tracking — ไม่มีใน scope
- KPI target/threshold + alert — dashboard เดิม (§2, §5 Phase 3) แค่แสดงผล ไม่มี target/alert
- Ranking engine v1 (§8) ใช้ organic engagement/earnings เท่านั้น — ถ้าเพิ่ม ads module ทีหลังต้องรวม paid signal เข้า ranking ด้วย

**Next step**: ต้องตัดสินใจจาก admin ว่าข้อไหนเข้า scope program นี้ (เพิ่มเป็น Phase 6+) หรือแยกเป็นระบบ/project ต่างหาก — โดยเฉพาะ ads/paid module เพราะกระทบ data model และ tech stack ใหม่ (ad account OAuth, spend tracking) ไม่ใช่แค่ UI เพิ่ม

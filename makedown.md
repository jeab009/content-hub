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

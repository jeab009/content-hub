# Suggestions & Comments

## Design suggestions

- เริ่ม pilot แค่ 1-2 platform ก่อน (เช่น TikTok + Facebook) แทนที่จะต่อทุกช่องพร้อมกัน — ลด risk API/rate-limit
- Revenue tracking ควร integrate UTM/affiliate link ตั้งแต่ Phase 2 ไม่งั้นข้อมูลรายได้จะขาด attribution ต่อ content
- Comment sentiment ควรใช้ off-the-shelf model (เช่น Thai sentiment classifier) ไม่ต้อง train เอง ช่วงแรก
- Content ที่เป็นละครสั้น/โฆษณาสินค้า ต้องเช็ค copyright/ใบอนุญาตเพลงประกอบ ก่อนยิงจริง — เป็นความเสี่ยง legal
- Age-target 23-45 กว้าง อาจแบ่ง sub-segment (23-30, 31-45) เพื่อ tailor content style ต่างกัน

## Revenue research findings (2026-07-15)

- **Facebook/Meta**: มี Graph API metric `content_monetization_earnings` ระดับ page/post — integrate ตรงได้เลย
- **YouTube**: YouTube Reporting API มี monetary metric (`estimated_partner_ad_auction_revenue` ฯลฯ) ต้องใช้ OAuth scope `yt-analytics-monetary.readonly`
- **TikTok**: Creator Rewards Program จ่ายตาม view แต่ไม่พบ public earnings API — ต้อง manual export จาก Creator Studio หรือรอ TikTok เปิด API
- **LINE OA**: ไม่มี revenue-share API สำหรับ OA ทั่วไป (มีแค่ LINE Creators Market แยกต่างหาก) — ถ้าใช้ LINE ขายของต้อง track revenue จากระบบขายเอง ไม่ใช่จาก LINE

## Suggestion จากผล research

- Pilot เริ่ม FB + YouTube ก่อน เพราะ earnings sync อัตโนมัติได้จริง ลด manual work
- ออกแบบ `metric` table ให้รองรับ `source: api | manual` แยกชัด เพราะ TikTok/LINE ต้องกรอกมือ
- ติดตาม TikTok Business API changelog เผื่อเปิด earnings endpoint ในอนาคต

## Resolved

- Revenue model: confirmed เป็น platform monetization payout
- Ownership: admin คนเดียวดูแลทั้งหมด
- Platform/priority: ระบบจัดให้อัตโนมัติ, admin แค่กดยิง

## Suggestion เพิ่มจาก platform/priority decision

- ranking engine v1 ควรเป็น rule-based/transparent (weighted score) ก่อน ไม่ใช่ black-box ML — admin ต้องเห็นเหตุผลว่าทำไมแนะนำ platform นี้ เพื่อ trust การกดยิง
- ต้องมี "override" ทางเลือกให้ admin ยิง platform อื่นนอกคำแนะนำได้เสมอ (edge case: sale ด่วน, ปัญหา compliance เฉพาะ platform)
- เก็บ log ว่า admin กดยิงตามคำแนะนำ หรือ override — ใช้ปรับ ranking model ทีหลัง

## ยังเปิดอยู่

- Budget/timeline ยังไม่ระบุตัวเลขจาก admin

## Suggestion จาก gap analysis (2026-07-16)

- ล็อค content pillar ratio + platform format spec เข้า data model **ก่อน** เริ่ม Phase 2 (CMS) — แก้ schema ทีหลังแพงกว่าตอนนี้เยอะ (ตอนนี้ `content.media_url` เป็น field เดียว ไม่รองรับ per-platform variant)
- Ads/paid module (ad spend, ROI, ad account OAuth) เป็น scope ใหม่ทั้งก้อน ไม่ใช่แค่ UI เสริม — แนะนำแยกตัดสินใจชัดว่าจะรวมเข้า Content Hub นี้ หรือทำเป็นระบบแยก เพราะกระทบ data model (`metric` table ต้องแยก organic vs paid) และต้อง ad account permission ต่างหากจาก organic OAuth ที่มีอยู่
- Comment aggregator (Phase 4 เดิม) ควรเพิ่ม SLA/escalation rule ตั้งแต่ design ไม่ใช่แค่ sentiment tag เฉยๆ — ไม่งั้น negative comment สะสมไม่มีคนตอบทัน
- Copyright clearance ควรเป็น required checkbox/field ใน Content Editor ก่อน publish จริง ไม่ใช่แค่ checklist ภายนอก (ลด risk คนลืมเช็ค)

## Suggestion จาก Loop iteration Phase 1.5 (2026-07-16)

- **จาก System Analyst (ต้องทำก่อน phase ที่เกี่ยว)**: DPA กับ Thai sentiment vendor + strip user identifier ก่อนส่ง text + retention policy ~12 เดือน (gate Phase 4); manual revenue entry ต้อง append-only ห้าม UPDATE (gate Phase 3); step-up re-auth บน publish/revenue/reply (gate Phase 2)
- **จาก QA**: เพิ่ม DB UNIQUE constraint บน `pillar_ratio_policies.content_pillar` และ `platform_cadence_targets.platform` ก่อน Phase 3 (ตอนนี้ idempotency เป็น app-layer เท่านั้น)
- **จาก QA**: sync `bussiness_rule.md` กับ `TargetAgeSegment` enum ที่ ship จริง (มี `18-22`/`46+` เกินจากที่ doc ระบุ)
- ~~**Provisional values ต้องถาม admin ยืนยัน**~~ — ยืนยันแล้ว 2026-07-16: ใช้ค่า recommend เป็น final (40/30/30, FB 7/wk, YT 3/wk), flip `is_provisional=false` แล้ว — badge PROVISIONAL ใน UI Phase 2 ไม่จำเป็นแล้ว

## Suggestion จาก Phase 2 backend QC/QA (2026-07-18) — non-blocking, ทำทีหลังได้

- **QC-M1**: `SchedulerService.cadenceOverview()` ยิง 1 query ต่อ platform (N+1) — 4 platform ยังโอเค, refactor เป็น `groupBy` ตอน Phase 3
- **QA note**: Redis db1 แชร์ระหว่าง throttle keys กับ session keys — `FLUSHDB` ล้าง throttle จะ log out sessions ทั้งหมดด้วย. แนะนำแยก namespace/DB (operational, ไม่ใช่ bug)
- **API contract สำหรับ Pass C frontend** (จาก QC): Post response shape (status enum: draft/scheduled/posted/posted_unconfirmed/failed), 401 (wrong password step-up) vs 403 (not admin) แยก retry logic, ranking reasoning jsonb shape `{engineVersion,factors[],total}`, overrideReason max 2000 chars, publish state transitions (posted_unconfirmed ยิงซ้ำไม่ได้ ต้อง resolve ก่อน)

## Ads/Paid Module — ข้อดี/ข้อเสีย แยก vs รวม (2026-07-16, ตอบคำถาม admin)

### ทางเลือก A: รวมเข้า Content Hub (Phase 7+)

ข้อดี:
- **ข้อมูล organic + paid อยู่จอเดียว** — เห็น ROI รวมต่อ content ชิ้นเดียวกัน (organic payout + ad spend + boosted reach) ตัดสินใจ boost content ที่ organic ดีอยู่แล้วได้จากหน้าเดียว
- **Ranking engine ฉลาดขึ้น** — v2/v3 ใช้ paid signal ร่วมจัด priority ได้ (content ไหนคุ้ม boost)
- **ใช้ infra เดิม** — auth, ConnectedAccount, queue, dashboard skeleton, PlatformAdapter seam ใช้ซ้ำได้ ประหยัดกว่าเริ่มระบบใหม่จากศูนย์
- Admin คนเดียว ใช้ระบบเดียว ไม่ต้องสลับเครื่องมือ

ข้อเสีย:
- **Scope ใหญ่** — OAuth ชุดใหม่ทั้งก้อน (Meta Ads API / TikTok Ads API แยกจาก organic Graph API), `metric` table ต้อง split organic/paid, dashboard ROI ใหม่ — ประเมินคร่าว = ขนาดเท่า Phase 2 อีกรอบ
- **เลื่อน timeline ทุกอย่าง** — ถ้าแทรกก่อน Phase 5 จบ จะดัน dashboard/comment/multi-platform ออกไป
- **Compliance surface โต** — ads_management scope ทำให้ Meta review เข้มขึ้น (ตอนนี้ Dev Mode พออยู่เพราะ organic scope เท่านั้น — เพิ่ม ads scope อาจบังคับ review + Business Verification)
- **เงินจริงเข้ามาในระบบ** — budget allocation ผิด = เสียเงินจริง ต้องมี guard/limit เข้มกว่า organic publish ที่แค่โพสต์ผิด

### ทางเลือก B: แยกเป็น project/ระบบต่างหาก

ข้อดี:
- **Content Hub จบ Phase 5 ได้ตามแผนไม่สะดุด** — scope ปัจจุบัน stable, ไม่มี rework `metric`/ranking กลางทาง
- **Risk แยกขาด** — ระบบ ads พังหรือ token หลุด ไม่กระทบ publish/dashboard organic; เงินจริงอยู่คนละระบบ blast radius เล็กกว่า
- ตัดสินใจ build/buy ได้อิสระ — อาจใช้ Meta Ads Manager ตรงๆ ไปก่อน (ฟรี ไม่ต้องเขียนเลย) แล้วค่อยประเมินว่าคุ้มสร้างเองไหม
- Meta App Review ของ Content Hub อยู่ branch Dev Mode ต่อได้

ข้อเสีย:
- **ข้อมูล ROI แตกสองระบบ** — เทียบ organic payout กับ ad spend ต่อ content ต้อง export มารวมมือ หรือสร้าง integration เพิ่มทีหลัง (ซึ่งก็คืองาน integration อีกก้อน)
- Ranking engine ไม่เห็น paid signal — คำแนะนำ platform ไม่รู้ว่า content ไหนกำลัง boost อยู่
- Login/จัดการ 2 ระบบ, duplicate concept (content list, platform account) ในระยะยาว

### คำแนะนำ

**เริ่มแบบ B-lite ก่อน**: ใช้ Meta Ads Manager / TikTok Ads ตรงๆ (ไม่เขียนโค้ด) ระหว่าง build Phase 2-5 ให้จบ → เก็บ requirement จริงจากการใช้งาน → ตัดสิน A (รวมเป็น Phase 7) ตอน Phase 5 จบ เมื่อมี data ว่า ads workflow ไหนทำซ้ำบ่อยพอที่จะคุ้ม automate. เหตุผล: ตอนนี้ยังไม่เคยยิง ads ผ่านระบบเลย requirement เป็นการเดา — build ก่อนใช้เสี่ยง build ผิด, และ scope A ใหญ่พอจะดัน Phase 3-5 (dashboard/comment ที่ยืนยันต้องการแล้ว) ออกไปหลายเดือน

**✓ Admin ตัดสินตาม B-lite แล้ว (2026-07-16)** — บันทึกเป็น business rule ใน [bussiness_rule.md](bussiness_rule.md). ระหว่าง Phase 2-5 แนะนำ admin จดบันทึกทุกครั้งที่ยิง ads ด้วยมือ: content ไหน, platform, budget, ผลลัพธ์ — จะเป็น requirement input ตรงๆ ตอน revisit Phase 7

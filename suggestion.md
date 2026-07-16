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
- **Provisional values ต้องถาม admin ยืนยัน**: pillar ratio 40/30/30 กับ cadence FB 7/wk, YT 3/wk เป็น placeholder — UI Phase 2 ต้องแสดง badge "PROVISIONAL" จนกว่าจะยืนยัน

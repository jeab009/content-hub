# Business Rules — Content Hub

Confirmed business rules only (not tech/design detail — see `makedown.md` for that). Each rule links back to where it was decided.

## Revenue

- Revenue = payout/monetization ที่แต่ละ platform ส่งเข้าช่องเรา (ad-share/creator monetization) — **ไม่ใช่** ยอดขายตรงหรือ affiliate. (confirmed 2026-07-15, memory.md)
- Facebook, YouTube: มี API ดึง earnings อัตโนมัติ (Graph API `content_monetization_earnings`, YouTube Reporting API monetary metrics) — sync ผ่านระบบได้จริง
- TikTok, LINE OA: ไม่มี public revenue-share API — ต้อง manual input/export จนกว่า platform จะเปิด API
- `metric` table ต้องแยก `source: api | manual` ชัดเจนตาม platform (suggestion.md)

## Ownership & Access

- Admin คนเดียวดูแลทั้งหมด — platform priority, budget, compliance. ไม่มี multi-approval role ช่วงแรก (confirmed 2026-07-15)

## Publish Authority

- ระบบจัด priority + เลือก platform ให้อัตโนมัติ (rule-based ranking, ดู makedown.md §8) แต่**ห้าม auto-publish** — admin ต้องกด "ยิง" confirm ทุกครั้ง ป้องกัน content ผิดพลาด/ละเมิดที่ยิงออกไปเองโดยไม่มีคนเช็ค
- ต้อง log ว่า admin ยิงตามคำแนะนำระบบ หรือ override เลือกเอง — ใช้ปรับ ranking model ทีหลัง (suggestion.md)
- Admin ต้องมีทางเลือก override platform นอกคำแนะนำได้เสมอ (edge case: sale ด่วน, compliance เฉพาะ platform)

## Content Policy (confirmed 2026-07-16)

- **Pillar ratio**: product 40% / drama 30% / comedy 30% — admin ยืนยันใช้ตามค่า recommend, ไม่ provisional แล้ว
- **Posting cadence**: Facebook 7 โพสต์/สัปดาห์, YouTube 3 โพสต์/สัปดาห์ — ยืนยันแล้ว. **TikTok 14/สัปดาห์, LINE OA 3/สัปดาห์** — ยืนยัน 2026-07-19 ตอนเข้า Phase 5 (TikTok = short-video volume ~2/วัน, LINE = broadcast ถี่มากกวน follower)

## TikTok/LINE OA Publish (decided 2026-07-19, Phase 5)

- **วิธี publish: mock adapter + manual-external-record** — ไม่ทำ live integration. เหตุผล: ไม่มี API credential จริง, TikTok Content Posting API ต้อง app audit, LINE Messaging API เป็น broadcast ไม่ใช่ feed post, และ FB/YT live path เองก็ verify แค่ mock
- Primary path: admin โพสต์เองบน platform จริง → บันทึก `external_post_id` + URL เข้า Content Hub (reuse posted_unconfirmed "Mark posted" flow) → ใช้ track + แนบ metric (revenue manual อยู่แล้ว)
- Live adapter path ship แบบ flagged ไม่ verify (posture เดียวกับ FB/YT) — revisit เมื่อมี cred จริง
- **Copyright gate บังคับบน manual-external-record ด้วย** (ยืนยัน 2026-07-19): admin ต้อง clear copyright ก่อนบันทึก post ที่โพสต์เองบน platform. เหตุผล: ถ้าไม่บังคับ "โพสต์เอง แล้วมาบันทึกทีหลัง" กลายเป็นช่องทางหลบ copyright gate ทั้งหมด. gate นี้ห้าม publish ไม่ได้ (post live ไปแล้ว) แต่รักษา audit trail + legal-risk rule

## Budget/Timeline (decided 2026-07-16)

- Admin เลื่อนการกำหนดตัวเลข budget/timeline ไป**กำหนดตอน phase UAT** — plan ปัจจุบันเรียงตาม dependency order (S/M/L) ไม่ใช่ calendar date, แปลงเป็น dated schedule ได้ทันทีเมื่อได้ตัวเลข

## Meta App Review (decided 2026-07-16)

- Facebook Page ที่ connect = **Page ของ admin เองเท่านั้น** → เข้า branch "Dev Mode sufficient" ตาม decision rule ใน docs/meta-app-review-status.md — **ไม่ต้อง submit App Review** ตอนนี้
- ต้อง revisit ทันทีถ้ามี Page ของคนอื่นต้อง connect ในอนาคต
- ค้างกรอก: Meta App ID + Business Manager ID จริงจาก Meta dashboard (ตอนสร้าง App จริง)

## Target Audience

- Target age 23-45 ปี (ตั้งต้น) — พิจารณาแบ่ง sub-segment 23-30 / 31-45 เพื่อ tailor content style (ยัง open, suggestion.md)

## Compliance/Legal

- Content ประเภทละครสั้น/โฆษณาสินค้า ต้องเช็ค copyright/ใบอนุญาตเพลงประกอบ **ก่อน**ยิงจริงเสมอ — ความเสี่ยงด้านกฎหมาย (suggestion.md)
- Facebook OAuth ใช้งานนอก local dev ต้องผ่าน Meta App Review ก่อน — ดู `docs/meta-app-review-status.md` (ยัง blank, ต้อง admin กรอก)

## Security (จาก security-decisions.md — rule ระดับ business impact)

- Token ที่ disconnect แล้วต้อง null ทิ้งเสมอ (ไม่เก็บ token ที่ไม่ใช้งานแล้ว) — บังคับให้ schema ต้อง nullable แม้ spec เดิมระบุ non-nullable (documented deviation)
- Production ต้องรันผ่าน HTTPS เท่านั้น (`NODE_ENV=production` บังคับ `Secure` cookie)

## Ads/Paid Module (decided 2026-07-16)

- **ตัดสินใจ: B-lite** — Ads/Paid **ไม่รวม**เข้า Content Hub ช่วง Phase 2-5. ระหว่างนี้ admin ยิง ads ผ่าน Meta Ads Manager / TikTok Ads โดยตรง (ไม่เขียนโค้ด, ไม่มี integration)
- เก็บ requirement จากการใช้งานจริงระหว่าง Phase 2-5 → **ตัดสินใหม่ตอน Phase 5 จบ** ว่าคุ้มสร้างเป็น Phase 7 หรือไม่ (ดู pros/cons ใน suggestion.md)
- ผลพวง: Meta App อยู่ branch Dev Mode ต่อได้ (ไม่ต้องขอ ads_management scope), `metric` table ไม่ต้อง split organic/paid ตอนนี้, ranking engine v1/v2 ใช้ organic signal เท่านั้นตามแผนเดิม

## Commerce / Affiliate (decided 2026-07-20, Phase 6)

ขอบเขตใหม่: ส่ง video เข้า Shopee, affiliate, ปักตะกร้า (product anchor) บน TikTok + Shopee

- **Revenue model เดิมไม่แก้** — `Revenue = platform payout เท่านั้น` ยังคงเดิมทุกตัวอักษร. Affiliate/commerce เป็น **stream แยกคนละก้อน** ไม่ผสมกับ payout
  - Dashboard แสดงแยกส่วน ไม่รวมยอดกัน
  - **Ranking engine ไม่กิน commerce signal** (v1/v2 ใช้ payout + engagement + override ตามเดิม) — ถ้าจะให้กินต้องตัดสินใจใหม่ต่างหาก
  - เหตุผล: รวมยอดแล้ว rollback ยาก และกระทบ ranking ที่เพิ่งเปิด v2 ไป
- **ยังไม่มีสิทธิ์ API ใดๆ** (ยืนยัน 2026-07-20): ไม่ได้เป็น Shopee managed seller (ไม่มี KAM) และไม่ได้เป็น TikTok Shop Creator Affiliate
  - → **posture เดียวกับ TikTok/LINE: mock adapter + manual record** เป็น path หลัก
  - live path เขียนแบบ flagged ไม่ verify จนกว่าจะมีสิทธิ์จริง

### สิ่งที่ต้องไปขอสิทธิ์เอง (ก่อน live)

- **Shopee**: ต้องเป็น managed seller (มี Key Account Manager) → สมัคร partner ที่ `open.shopee.com` ได้ `partner_id` + `partner_key`
- **TikTok Shop**: บัญชีต้องเป็น Creator Affiliate (มีไอคอน Showcase) แล้ว authorize partner
- ข้อจำกัดที่รู้แล้ว: Shopee video ต้องยาว **10–60 วินาที**

## Ranking Engine v2 (enabled 2026-07-20)

- **v2 เป็น engine เริ่มต้นแล้ว** (`RANKING_ENGINE` default = `v2`). ยืนยันโดย admin ตอนปิด Phase 5D หลัง BUG-P5-02 ถูกแก้ (score reads แยกตาม engine แล้ว) และ 5-factor panel ผ่าน visual QA
- v2 ต่างจาก v1: ให้คะแนนครบ 4 platform (v1 ให้แค่ FB/YT), engagement factor ผสม revenue เข้าไปด้วย, และเพิ่ม factor `override_feedback` ที่เรียนจากประวัติ override จริงของ admin
- **v2 เปลี่ยนคำแนะนำจริง** — comedy pillar พลิกจาก Facebook เป็น TikTok เพราะ override history. นี่คือ factor ทำงานตามที่ออกแบบ ไม่ใช่ bug
- **Rollback**: ตั้ง `RANKING_ENGINE=v1` — reads แยก engine ทั้งสองทาง ดังนั้น rollback จะ**ไม่สนใจ**แถว v2 (ไม่ผสมกัน) แต่ต้อง re-rank content ที่ต้องการคะแนน v1 ใหม่
- **ทุกครั้งที่สลับ engine ต้อง re-rank** — content ที่ไม่เคยถูก rank ด้วย engine ปัจจุบันจะอ่านเป็น unranked (ตั้งใจ — ปลอดภัยกว่าเสิร์ฟคะแนนข้าม engine)

## Scope Boundary (rules ว่า "ไม่ทำ" ในแต่ละ phase)

- Phase 1: ไม่มี CMS, ranking, dashboard UI, publish logic, platform อื่นนอก Facebook
- ระบบทั้งหมดถึง Phase 5 = **organic distribution only** — ads/paid ตัดสินแล้วว่าแยกไว้นอกระบบ (B-lite ด้านบน) จนกว่าจะ revisit หลัง Phase 5

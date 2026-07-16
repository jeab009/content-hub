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
- **Posting cadence**: Facebook 7 โพสต์/สัปดาห์, YouTube 3 โพสต์/สัปดาห์ — ยืนยันแล้ว (TikTok/LINE จะกำหนดเมื่อเข้า Phase 5)

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

## Scope Boundary (rules ว่า "ไม่ทำ" ในแต่ละ phase)

- Phase 1: ไม่มี CMS, ranking, dashboard UI, publish logic, platform อื่นนอก Facebook
- ระบบทั้งหมดถึง Phase 5 = **organic distribution only** — ads/paid ตัดสินแล้วว่าแยกไว้นอกระบบ (B-lite ด้านบน) จนกว่าจะ revisit หลัง Phase 5

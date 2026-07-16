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

## Target Audience

- Target age 23-45 ปี (ตั้งต้น) — พิจารณาแบ่ง sub-segment 23-30 / 31-45 เพื่อ tailor content style (ยัง open, suggestion.md)

## Compliance/Legal

- Content ประเภทละครสั้น/โฆษณาสินค้า ต้องเช็ค copyright/ใบอนุญาตเพลงประกอบ **ก่อน**ยิงจริงเสมอ — ความเสี่ยงด้านกฎหมาย (suggestion.md)
- Facebook OAuth ใช้งานนอก local dev ต้องผ่าน Meta App Review ก่อน — ดู `docs/meta-app-review-status.md` (ยัง blank, ต้อง admin กรอก)

## Security (จาก security-decisions.md — rule ระดับ business impact)

- Token ที่ disconnect แล้วต้อง null ทิ้งเสมอ (ไม่เก็บ token ที่ไม่ใช้งานแล้ว) — บังคับให้ schema ต้อง nullable แม้ spec เดิมระบุ non-nullable (documented deviation)
- Production ต้องรันผ่าน HTTPS เท่านั้น (`NODE_ENV=production` บังคับ `Secure` cookie)

## Scope Boundary (rules ว่า "ไม่ทำ" ในแต่ละ phase)

- Phase 1: ไม่มี CMS, ranking, dashboard UI, publish logic, platform อื่นนอก Facebook
- ระบบปัจจุบันทั้งหมด = **organic distribution only** — ไม่มี ads/paid spend module (gap, ยังไม่ตัดสินใจว่าจะเพิ่ม — ดู makedown.md §10)

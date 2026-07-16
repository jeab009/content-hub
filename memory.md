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

## Remaining open decision

- **Ads/Paid module**: admin ขอดูข้อดี-ข้อเสีย แยก vs รวม ก่อนตัดสิน (ส่งให้แล้ว 2026-07-16 — ดู [suggestion.md](suggestion.md), รอคำตอบ)
- Gap analysis อื่นๆ (ดู [makedown.md](makedown.md) §10): comment SLA/escalation, copyright workflow — จัดเข้า Phase 4/1.5 แล้วใน plan v2

## Build status (2026-07-16)

- **Implemented**: Phase 1 (foundation) + **Phase 1.5 (Compliance & Schema Gate)** — schema amendment (copyright gate fields, `content_assets`, `pillar_ratio_policies`, `platform_cadence_targets`), `CopyrightGateService` fail-closed, seed provisional defaults. QA signed off 39/39 tests บน Postgres จริง. ดู [makedown.md](makedown.md) §9.5
- **Not implemented**: Content CMS, ranking engine, publish flow, dashboard UI, comment aggregation, YouTube/TikTok/LINE platforms (Phase 2-5). มี Phase 2 WIP บางส่วน commit แยกไว้ (ยังไม่ผ่าน QA — content.service, upload-validation, admin.guard, publish orchestration config/audit hooks, migration `20260716054701`)
- Phase 1.5 ค้าง: Meta App Review submission (admin ต้องกรอก docs/meta-app-review-status.md), ยืนยันตัวเลข pillar ratio + cadence target จริง (ตอนนี้ provisional 40/30/30, FB 7/wk, YT 3/wk)
- Known bugs BUG-001~004 (Nest DI, dotenv, circular import, queue name) — ทั้งหมด fixed แล้ว ดู [errorlog.md](errorlog.md)

## Reference files

- [errorlog.md](errorlog.md) — test failures/error ที่เจอระหว่าง build
- [bussiness_rule.md](bussiness_rule.md) — business rule ที่ confirm แล้ว (แยกจาก design/tech detail)

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

## Remaining open decision

- Budget/timeline ยังไม่ระบุตัวเลขจาก admin

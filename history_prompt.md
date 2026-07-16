# Prompt History

## 2026-07-15 — Initial request

> ทีมงานคุณภาพทุกท่าน ผมต้องการสร้างโปรแกรมสำหรับการยิง content เกี่ยวกับการขายสินค้า, ละครสั้น, คลิปตลกๆ, ไปยัง social media ทุกช่องทาง โดย content เหมาะสำหรับคนช่วงอายุตั้งแต่ 23 - 45 ปี โดยโปรแกรมนี้ต้องการเป็น source สำหรับยิง content และ dashboard monitor ผู้เข้ามาใช้งาน และ monitor รายได้ที่ได้จากแต่ละ content และ social media ต่างๆด้วย เก็บ comment ต่างๆเพื่อมาปรับปรุง ลองออกแบบหน้าจอ และ ทำ implement plan ส่งมาให้ดูหน่อย และ เก็บทั้งหมดลงใน memory.md, พร้อมทั้งการทำงานลงใน makedown.md และ prompt ลงใน history_prompt.md, suggestion และ comment ลงใน suggestion.md ด้วย

**Output**: ออกแบบ screen + data model + tech stack + phase plan ใน [makedown.md](makedown.md), สร้าง [memory.md](memory.md) index, บันทึก [suggestion.md](suggestion.md).

## 2026-07-15 — Revenue model answer

> ตอบ revenue model เข้าใจว่ามาจาก social ในแต่ละ platform ส่งเข้าหาเราเป็นรายได้จากช่องที่เราทำ (ฝากหาข้อมูลเพิ่มเติมด้วย) ข้อ 2 - 4 เรามี admin เป็นคนดูแลทั้งหมด

**Output**: research revenue/monetization API ของ FB, YouTube, TikTok, LINE OA — พบ FB/YouTube มี API earnings จริง, TikTok/LINE ไม่มี public API ต้อง manual. อัพเดท [makedown.md](makedown.md) §6-8, [memory.md](memory.md), [suggestion.md](suggestion.md).

## 2026-07-15 — Platform/priority ownership

> ส่วนนี้ให้ระบบจัด priority และ platform ในการยิง content ส่วนการยิงจะให้ admin เป็นคนดำเนินการ

**Output**: เพิ่ม §8 Platform/Priority Engine ใน [makedown.md](makedown.md) — ระบบ rank platform+priority (rule-based, ดู revenue/engagement/API availability), admin execute publish เอง ไม่ auto-publish. อัพเดท data model (`post.priority_score`, `executed_by`) + Phase 2 plan.

## 2026-07-15 — ขอ implement plan step by step

> ขอ implement plan step by step หรือแบ่ง phase implement

**Output**: ขยาย §5 ใน [makedown.md](makedown.md) เป็น step-by-step ละเอียด 5 phase (Foundation, Content+Ranking+Publish, Dashboard, Comment, Multi-platform expansion) พร้อม exit criteria แต่ละ phase.

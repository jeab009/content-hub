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

## 2026-07-16 — Gap analysis: content plan/ads/engagement ที่ยังขาด

> ในฐานะผู้เชี่ยวชาญ content management + ยิง Ads ไปยัง platform ต่างๆ จากประสบการณ์ใน program นี้ยังมีอะไรที่ต้องทำเพิ่มอีกหรือเปล่า อย่างเช่น content plan, customer engagement, หรืออื่นๆ

**Output**: สำรวจ scope ปัจจุบัน (Phase 1 built only — infra/auth/DB/FB OAuth/queue, ดู [README.md](README.md)) เทียบ full plan ใน [makedown.md](makedown.md) พบ gap ที่ยังไม่อยู่ใน scope เลย: content pillar/cadence strategy, platform-native format adaptation, A/B creative test, **ads/paid module ทั้งก้อน (ระบบปัจจุบัน organic distribution only, ไม่มี ad spend/ROI)**, community management workflow (SLA/escalation/canned reply), audience sub-segment, copyright clearance workflow, KPI target/competitor benchmark. เพิ่มเป็น §10 ใน [makedown.md](makedown.md), บันทึก suggestion ใน [suggestion.md](suggestion.md), สร้าง [errorlog.md](errorlog.md) และ [bussiness_rule.md](bussiness_rule.md) ใหม่ตามคำขอ.

## 2026-07-16 — /loop: implementation plan + แบ่ง phase + Phase 1.5 build

> /loop สร้าง implementation plan และแบ่ง phase ในการทำงานออกมาด้วย

**Output**: รัน Loop Engineering pipeline เต็มรอบ:
1. **PM** — Project Plan v2: เพิ่ม Phase 1.5 (Compliance & Schema Gate) เป็น blocking gate ก่อน Phase 2, ปรับ Phase 2-5 เดิม, เพิ่ม Phase 6 backlog (A/B test, competitor benchmark), Ads/Paid module แยกเป็น pending stakeholder decision ชัดเจน, risk register 9 ข้อ
2. **App Designer** — Architecture Design: schema amendment (`content_asset`, `pillar_ratio_policy`, `platform_cadence_target`, copyright gate fields, `ranking_score`), 6 screens spec, 7 NestJS modules ใหม่ + `PlatformAdapterInterface`
3. **System Analyst** — APPROVED WITH CONDITIONS (9 additive controls: PDPA/DPA สำหรับ sentiment vendor, scope justification matrix, `copyright_evidence_url` บังคับ drama/product, manual metric append-only, step-up re-auth, publish idempotency, alert dedup, adapter contract tests, PROVISIONAL badge)
4. **Developer** — implement **Phase 1.5 เท่านั้น**: migration `20260716110019`, 3 ตารางใหม่ + 5 fields บน Content, `CopyrightGateService` (fail-closed), seed provisional defaults, 39/39 tests
5. **QC** — REJECTED (tree hygiene: Phase 2 WIP ปนใน tree) / **QA** — SIGNED OFF (verify ทุกอย่างบน Postgres จริง, zero bugs)
6. Admin ตัดสิน: เก็บ Phase 2 WIP + commit แยกก้อน (ไม่ revert)

## 2026-07-16 — ตอบ 4 open decisions

> 1. ยังไม่ได้กำหนดขอไปทำใน phase UAT 2.ใช้ตามที่ recommend 3. ขอข้อดีและข้อเสียระหว่างแยกกับรวมกัน 4. ยืนยันตามที่กรอก

**Output**: (1) budget/timeline เลื่อนไปกำหนดตอน phase UAT — บันทึกใน [bussiness_rule.md](bussiness_rule.md); (2) pillar ratio 40/30/30 + cadence FB 7/wk, YT 3/wk ยืนยันเป็น final — flip `is_provisional=false` ทั้ง seed.ts และ live DB, tests 39/39 ผ่าน; (3) เขียนข้อดี-ข้อเสีย Ads/Paid แยก vs รวม + คำแนะนำ B-lite (ใช้ Ads Manager ตรงๆ ก่อน, ตัดสินรวมเป็น Phase 7 ตอน Phase 5 จบ) ใน [suggestion.md](suggestion.md) — รอ admin ตัดสิน; (4) Meta doc ยังเป็น template เปล่า — admin ยืนยันว่า connect Page ตัวเองเท่านั้น → กรอก branch "Dev Mode sufficient" ใน [docs/meta-app-review-status.md](docs/meta-app-review-status.md), ไม่ต้อง submit App Review, ค้างแค่ App ID/Business Manager จริง

## 2026-07-16 — Ads/Paid: ตัดสินตาม B-lite

> ทำตามแนะนำได้เลยครับ

**Output**: บันทึก Ads/Paid = **B-lite** เป็น business rule ใน [bussiness_rule.md](bussiness_rule.md) — แยกนอกระบบช่วง Phase 2-5 (ใช้ Meta Ads Manager/TikTok Ads ตรงๆ), เก็บ requirement จริง, revisit เป็น Phase 7 candidate ตอน Phase 5 จบ. อัพเดท phase map ใน [makedown.md](makedown.md) §9.5, ปิด open decision ใน [memory.md](memory.md) — **ไม่มี decision ค้างก่อน Phase 2 แล้ว**

## 2026-07-17..18 — Phase 2 backend build + QC/QA

> (ดำเนินการต่อ Phase 2)

**Output**: build Phase 2 backend เต็ม — CMS (ContentController CRUD+upload+asset, copyright gate), Ranking v1 (explainable 4-factor, ranking_scores), Publish flow (step-up re-auth, server-side was_override, idempotency, posted_unconfirmed resolution), FB+YouTube adapters, Google OAuth, Scheduler overview. commits `ce524ac`+`4516195`. QC APPROVED, QA เจอ 3 bug (dup-publish critical, ready-gate bypass high, tie-break medium) → แก้หมด `9a75424`, QA SIGNED OFF. 225 tests. ดู [errorlog.md](errorlog.md) §Phase 2

## 2026-07-18 — Phase 2 frontend Pass C1 (CMS UI)

> (ดำเนินการต่อ frontend)

**Output**: Pass C1 CMS UI (`c5195a1`) — Content library (list/filter/archive), Content editor (create/edit, media upload, per-platform asset), copyright gate ฝั่ง UI (evidence URL required drama/product, shared logic + test)

## 2026-07-18 — ดำเนินการต่อที่ค้างไว้ (Pass C2 Scheduler/Publish UI)

> ดำเนินการต่อที่ค้างไว้

**Output**: จบ Phase 2 frontend — สร้างหน้า `/scheduler` (cadence cards, ready-to-publish table, rank/re-rank, PublishConfirmModal พร้อม explainable score reasoning + override reason + step-up password) และ `/posts` (status filter, Retry modal, posted_unconfirmed resolution). commit `910e4b1`. Verify end-to-end บน Docker stack ผ่าน browser: rank, publish override (server wasOverride=true), retry 200, resolve-not-posted. typecheck+lint+jest 24/24 ผ่าน. Dev-env issue: reset admin password ใน demo DB ให้ตรง backend/.env (ดู [errorlog.md](errorlog.md) P2F-OBS-1)

## 2026-07-18 — เก็บงานลง doc files

> เก็บทั้งหมดลงใน memory.md, การทำงานลง makedown.md, prompt ลง history_prompt.md, suggestion/comment ลง suggestion.md, issue/error ลง errorlog.md, business rule ลง bussiness_rule.md

**Output**: sync ทุก doc file กับงาน Phase 2 backend + frontend Pass C1/C2 — [memory.md](memory.md) build status, [makedown.md](makedown.md) §9.5 table + §9.6 frontend detail, [history_prompt.md](history_prompt.md) prompt log, [errorlog.md](errorlog.md) §Phase 2 Frontend (P2F-OBS-1/2), [suggestion.md](suggestion.md) frontend note. ไม่มี business rule ใหม่ (Pass C = UI implement ตาม rule เดิม)

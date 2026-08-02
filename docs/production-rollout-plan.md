# Production rollout plan — server provisioning → UAT → go-live

เครื่องเดียวใช้ทั้ง UAT (จำลองทดสอบ) และ production จริง (คนละช่วงเวลา ไม่ใช่คนละเครื่อง) — ลำดับด้านล่างออกแบบมาให้ UAT เป็น dry-run เต็มรูปแบบของขั้นตอน production จริงทุกขั้น ก่อนเปิดใช้งานจริง

## คำแนะนำ OS

**Ubuntu Server 24.04 LTS** — เหตุผล:

- Docker Engine รองรับเป็น first-class (repo/package ทางการ, ไม่ต้องงมทำเอง)
- ตรงกับ `ubuntu-latest` ที่ `.github/workflows/ci.yml` ใช้อยู่แล้ว → พฤติกรรม build เหมือนกับที่ CI เคย verify มา ลดโอกาส "ผ่าน CI แต่พังบน server"
- LTS = security patch ยาว (support ถึงปี 2029), เอกสาร/ชุมชนเยอะที่สุดในกลุ่ม cloud VPS ทุกเจ้า (DigitalOcean, Linode, Vultr, Hetzner, AWS EC2, GCP)

ทางเลือกรอง: **Debian 12** (เบากว่าเล็กน้อย, เสถียรกว่าในเชิง "เปลี่ยนช้า") — ใช้ได้เหมือนกันถ้าคุ้นเคยอยู่แล้ว ไม่มีเหตุผลต้องเปลี่ยนถ้าไม่มีข้อจำกัดอื่น

**สเปกขั้นต่ำที่แนะนำ**: 2 vCPU / 4GB RAM / 50GB SSD — แต่ `next build` (ขั้นตอน build frontend image) กิน RAM สูง ถ้าเครื่องมี RAM แค่ 4GB ให้เปิด swap ไว้กันสร้าง image ล้ม (`docker compose build` ค้าง/ถูก OOM-kill). ถ้างบไหว แนะนำ 4 vCPU / 8GB สบายกว่า

---

## Phase 0 — จัดหาเครื่อง (ทำครั้งเดียว)

- [ ] เช่า/จัดเตรียม VPS หรือ bare-metal ตาม OS ด้านบน
- [ ] ตั้ง firewall เปิดแค่ port ที่จำเป็น: `22` (SSH), `80`/`443` (HTTP/HTTPS) — ปิดทุก port อื่นรวม `4000`/`3000`/`5432`/`6379` จากภายนอก (Docker network คุยกันภายในพอ)
- [ ] SSH: ปิด password login เหลือแค่ key-based, เปลี่ยน default port ถ้าอยากลด bot scan (ไม่บังคับ)
- [ ] สร้าง user แยกจาก `root` สำหรับ deploy, ใส่ใน group `docker`

## Phase 1 — ติดตั้ง Docker

- [ ] ติดตั้ง Docker Engine + Docker Compose plugin ตาม [official Docker docs สำหรับ Ubuntu](https://docs.docker.com/engine/install/ubuntu/) (อย่าใช้ `apt install docker.io` — เวอร์ชันเก่ากว่ามาก)
- [ ] `docker compose version` ต้องขึ้น v2.x

## Phase 2 — Clone + secrets (ชุดใหม่ ไม่ใช่ของ dev)

- [ ] `git clone https://github.com/jeab009/content-hub.git`
- [ ] Generate secret ชุดใหม่ (**ห้ามใช้ชุดเดียวกับ dev/local**):
  ```bash
  openssl rand -hex 32      # SESSION_SECRET
  openssl rand -base64 32   # APP_ENCRYPTION_KEY
  ```
- [ ] สร้าง `.env` (root) + `backend/.env` จาก `.env.example`/`backend/.env.example` ใส่ค่าจริงทั้งหมด (DB password ใหม่ด้วย ไม่ใช่ `content_hub`/`content_hub` ของ demo)
- [ ] ยืนยัน `.env` ทั้งสองไฟล์ `SESSION_SECRET`/`APP_ENCRYPTION_KEY` **ตรงกัน** (เคยมี drift จริงมาก่อนตอน dev — ดู [SETUP-CHECKLIST.md ส่วนที่ 1](../SETUP-CHECKLIST.md))

## Phase 3 — HTTPS + Domain (SETUP-CHECKLIST §5.1, §5.2)

- [ ] ชี้ DNS ของ domain (หรือ subdomain สำหรับ UAT เช่น `uat.yourdomain.com`) มาที่ IP เครื่อง
- [ ] วาง reverse proxy terminate TLS — แนะนำ **Caddy** (auto HTTPS ผ่าน Let's Encrypt, config ไม่กี่บรรทัด) หรือ nginx + certbot ถ้าคุ้นเคยอยู่แล้ว
- [ ] ตั้ง `NODE_ENV=production` ใน `backend/.env` (เปิด `Secure` flag บน session cookie — **ถ้าไม่มี HTTPS พร้อมจริง login จะไม่ได้เลย** เพราะ cookie ไม่ถูกส่งผ่าน HTTP)
- [ ] ตั้ง `CORS_ORIGIN=https://<domain-จริง>` ใน `backend/.env`
- [ ] Build frontend image ใหม่ด้วย `NEXT_PUBLIC_API_BASE_URL=https://<api-domain>` (build-time, ไม่ใช่ runtime — เปลี่ยน env แล้วไม่ rebuild ไม่มีผล)
- [ ] `docker compose up -d`, เช็ค `GET /api/health` ผ่าน HTTPS จริงได้ `200`

## Phase 4 — Database backup (SETUP-CHECKLIST §5.3)

- [ ] ตั้ง cron/systemd timer รัน `pg_dump` อัตโนมัติ (แนะนำรายวัน อย่างน้อย) เก็บไว้นอกเครื่องด้วย (S3/object storage หรือ scp ไปอีกเครื่อง — backup ที่อยู่เครื่องเดียวกับ DB ไม่ต่างจากไม่มี backup ถ้า disk พัง)
- [ ] **ทดสอบ restore จริงอย่างน้อย 1 ครั้ง** ก่อนไป Phase 6 (UAT) — restore ลง DB ชื่อทดสอบ เช็คว่าข้อมูล/schema ครบ

## Phase 5 — Monitoring (SETUP-CHECKLIST §5.5)

- [ ] ติดตั้ง error tracking (Sentry ฟรี tier พอสำหรับ scale นี้) เชื่อมทั้ง backend/frontend
- [ ] ติดตั้ง metrics พื้นฐาน (Prometheus+Grafana หรือใช้ managed alternative ถ้าไม่อยากดูแลเอง)
- [ ] หลังมี monitoring แล้ว ลด log level ของ 401 ปกติจาก ERROR → WARN (ไม่งั้น alert จะดังตลอดจาก failed-login ปกติ)

---

## Phase 6 — UAT (ใช้เครื่องนี้จำลองก่อนเปิดจริง)

ถึงจุดนี้ Phase 0-5 ทำครบแล้วบนเครื่องนี้ = **UAT environment พร้อม** (โครงสร้างเดียวกับ production เป๊ะ ต่างแค่ domain/data)

- [ ] Seed ข้อมูลทดสอบ (ไม่ใช่ข้อมูลลูกค้าจริง) — สร้าง admin account จริงสำหรับ UAT (อย่าใช้ `SEED_ADMIN_PASSWORD` ของ demo)
- [ ] เดินครบทุก golden path จริงบน domain UAT (ไม่ใช่ localhost): login, content CRUD, publish flow, ranking, comments, commerce, paid, dashboard, PDPA retention job รันจริง, `/api/health` ผ่าน load balancer/monitoring จริง
- [ ] เปิด platform ทีละตัว (Facebook ก่อน, ทดสอบด้วย Page ทดสอบ — ดู [SETUP-CHECKLIST.md ลำดับที่แนะนำ](../SETUP-CHECKLIST.md))
- [ ] ตรวจ audit log บันทึกครบ (`GET /api/audit-logs`)
- [ ] ให้ stakeholder/ผู้ใช้จริงทดสอบ ไม่ใช่แค่ทีมพัฒนา
- [ ] เก็บ bug ที่เจอ, แก้, วน retest จนผ่าน sign-off

## Phase 7 — Go-live (เปลี่ยนเครื่องเดิมจาก UAT → production)

- [ ] เปลี่ยน DNS จาก `uat.yourdomain.com` → `yourdomain.com` จริง (หรือถ้า UAT ใช้ domain จริงอยู่แล้ว ข้ามข้อนี้)
- [ ] **ลบข้อมูลทดสอบทั้งหมดออกจาก DB** ก่อนรับข้อมูลจริง (หรือ restore DB ใหม่จาก migration เปล่า) — ห้ามปนข้อมูลทดสอบกับข้อมูลจริง
- [ ] Generate secret ชุดใหม่อีกรอบ (ชุดที่ใช้ตอน UAT ถือว่า "ใช้แล้ว" ไม่ควรพกไปใช้ต่อ production จริง) — ทำตาม Phase 2 ซ้ำ
- [ ] เชื่อม platform จริง (ไม่ใช่ test Page/channel) ทีละตัวตามลำดับใน SETUP-CHECKLIST
- [ ] `npm audit --prefix frontend` + `npm audit --prefix backend --omit=dev` รอบสุดท้ายก่อน build image จริง (SETUP-CHECKLIST §7.4)
- [ ] เปิดระบบให้ผู้ใช้จริงเข้าถึง

## Phase 8 — หลังเปิดใช้งาน (ต่อเนื่อง ไม่ใช่ทำครั้งเดียว)

- [ ] เช็ค backup restore ซ้ำเป็นระยะ (ไม่ใช่เชื่อว่า backup ทำงานตลอดไปเพราะเคย test ผ่านครั้งเดียว)
- [ ] `npm audit` ก่อน build ทุกครั้ง (§7.4 — standing reminder ไม่มีวันเสร็จ)
- [ ] ทุก PR เข้า `main` ต้องผ่าน CI 4 job ตาม branch protection ที่ตั้งไว้แล้ว (ดู SETUP-CHECKLIST §8) — deploy บน production ควร trigger จาก merge เข้า `main` เท่านั้น ไม่ deploy จาก branch อื่น

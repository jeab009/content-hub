# Setup Checklist — สิ่งที่ต้องดำเนินการเอง

สิ่งที่ **ระบบทำแทนไม่ได้** — ต้องมีคนไปสมัคร กรอก หรือตัดสินใจ

สถานะปัจจุบัน: demo/local บน Docker Compose ทำงานครบทุก feature แต่ **ค่าทั้งหมดเป็นค่า demo** และ **ยังไม่เคยชี้ไปที่ platform จริง**

เรียงตามลำดับที่ควรทำ — แต่ละหัวข้อบอกว่า *ทำไมต้องทำ* และ *ถ้าไม่ทำจะเกิดอะไร*

---

## ส่วนที่ 0 — ตรวจสถานะปัจจุบันก่อน (5 นาที)

```bash
cd /Users/uthorn.y/Desktop/Content/content-hub
docker compose ps                    # ควรเห็น 4 service เป็น healthy
docker compose exec backend npx prisma migrate status   # ควรขึ้น "up to date", 11 migrations
```

เข้า http://localhost:3000 → login ด้วย `admin@example.com` / ค่าใน `backend/.env` (`SEED_ADMIN_PASSWORD`)

- [ ] เข้าระบบได้ เห็นหน้า Dashboard

---

## ส่วนที่ 1 — Secrets

> ✅ **1.1 + 1.2 ทำให้แล้ว (2026-07-20)** — generate `SESSION_SECRET` (64 hex) + `APP_ENCRYPTION_KEY` (32 bytes base64) ใหม่ ใส่ลงทั้ง `.env` (root) และ `backend/.env` ให้ตรงกัน
> token ที่มีอยู่ถูก **re-encrypt ด้วย key ใหม่** แล้ว (decrypt ด้วย key เก่า → encrypt ด้วย key ใหม่) จึงไม่ต้อง reconnect — ยืนยันแล้ว metric sync 6/6 ผ่าน
> **พบ drift จริงระหว่างทาง**: `.env` กับ `backend/.env` มี `APP_ENCRYPTION_KEY` คนละตัวอยู่ก่อนแล้ว (container ใช้ root) — แก้ให้ตรงกันแล้ว
> ค่าเก่าสำรองไว้ที่ scratchpad (`env.root.bak`, `env.backend.bak`) เผื่อต้อง rollback
> ⚠️ ยังต้องทำเองตอนขึ้น production: **generate ชุดใหม่อีกครั้งสำหรับ production** อย่าใช้ชุดเดียวกับ dev

### 1.1 สร้าง SESSION_SECRET

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- [ ] ใส่ค่าที่ได้ลง `SESSION_SECRET` (ทั้ง `backend/.env` และ `.env` ที่ root ถ้าใช้ Docker)

### 1.2 สร้าง APP_ENCRYPTION_KEY

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

- [ ] ใส่ค่าที่ได้ลง `APP_ENCRYPTION_KEY`

> ⚠️ **คำเตือนสำคัญ** — key นี้ใช้เข้ารหัส access token ของทุก platform
> **เปลี่ยน key = token เดิมถอดรหัสไม่ได้ทั้งหมด** ต้อง disconnect แล้ว connect ใหม่ทุกบัญชี
> เรื่องนี้เกิดขึ้นจริงในช่วง demo 2 ครั้ง (ดู `errorlog.md` P2-OBS-1, P3-OBS-1)
> ถ้าสงสัยว่า key รั่ว → มี runbook ใน `docs/security-decisions.md` §10

### 1.3 ตั้งรหัส admin

seed script บังคับ: **ยาว ≥ 12 ตัวอักษร** และ **zxcvbn score ≥ 3/4** (รหัสเดาง่ายจะถูกปฏิเสธตั้งแต่ตอน seed)

- [ ] ตั้ง `SEED_ADMIN_PASSWORD` ใน `.env` (root — ตัวที่ docker-compose อ่าน) **และ** `backend/.env`

> ถ้าปล่อยว่าง seed จะสุ่มรหัสให้แล้ว **print ครั้งเดียว** ใน log ตอน boot แรก
> ระหว่าง demo รหัสนี้หายไป 2 ครั้งเพราะ log ถูก rotate — ตั้งเองดีกว่า
>
> ⚠️ `.env` (root) กับ `backend/.env` เป็นคนละไฟล์ **container อ่านเฉพาะ root** — ค่าต้องตรงกัน ไม่งั้น fresh volume จะได้รหัสคนละตัวกับที่คิดไว้

### 1.4 เปลี่ยน Postgres credentials

- [ ] เปลี่ยน `POSTGRES_PASSWORD` จาก `content_hub` เป็นค่าจริง
- [ ] แก้ `DATABASE_URL` ให้ตรงกัน

---

## ส่วนที่ 2 — Facebook / Meta

จำเป็นถ้าจะโพสต์ FB จริง (ตอนนี้ `PUBLISHER_IMPL_FACEBOOK=mock` — โพสต์ปลอม ไม่ออกไปข้างนอก)

### 2.1 สร้าง Meta App

1. ไป https://developers.facebook.com/apps → **Create App**
2. เลือกประเภท **Business**
3. เพิ่ม product **Facebook Login**

- [ ] ได้ App ID + App Secret แล้ว

### 2.2 ลงทะเบียน Redirect URI

ใน Meta App Dashboard → Facebook Login → Settings → **Valid OAuth Redirect URIs**

ต้องตรง**เป๊ะทุกตัวอักษร**กับค่าใน `.env`:
```
http://localhost:4000/api/connected-accounts/facebook/callback     # local
https://<domain-จริง>/api/connected-accounts/facebook/callback     # production
```

- [ ] ลงทะเบียน URI ครบทุก environment ที่จะใช้

### 2.3 ใส่ค่าลง .env

```bash
FACEBOOK_APP_ID=<app id จริง>
FACEBOOK_APP_SECRET=<app secret จริง>
FACEBOOK_REDIRECT_URI=<ต้องตรงกับที่ลงทะเบียนไว้ข้อ 2.2>
```

- [ ] ใส่ครบ 3 ค่า

### 2.4 กรอกเอกสาร Meta

เปิด [`docs/meta-app-review-status.md`](docs/meta-app-review-status.md) — ยังว่าง 5 ช่อง:

- [ ] Meta App ID จริง
- [ ] Business Manager ที่เป็นเจ้าของ Page
- [ ] Redirect URI ที่ลงทะเบียนไว้จริง
- [ ] Data Use Checkup — สถานะ + **วันครบกำหนดต่ออายุ** (Meta บังคับ re-attest เป็นระยะ ถ้าไม่ทำ OAuth จะพัง)
- [ ] ผู้รับผิดชอบ (ใครแก้เวลา OAuth ล่มตอนตี 3)

> **ไม่ต้องส่ง App Review** — ตัดสินใจไว้แล้วว่า connect เฉพาะ Page ของตัวเอง จึงอยู่ใน branch "Dev Mode sufficient"
> **ต้องกลับมาทบทวนทันที** ถ้าวันหนึ่งต้อง connect Page ของคนอื่น — ตอนนั้นต้องส่ง App Review ก่อน ใช้เวลาเป็นสัปดาห์

### 2.5 เปิดใช้จริง

- [ ] เปลี่ยน `PUBLISHER_IMPL_FACEBOOK=mock` → `facebook`

> ระบบมี guard: ถ้าตั้งค่า live ขณะ `NODE_ENV≠production` **จะปฏิเสธ boot ทันที** พร้อมข้อความอธิบาย (กันโพสต์จริงหลุดออกไปตอนเทส) — ไม่ใช่ bug

---

## ส่วนที่ 3 — YouTube / Google

ตอนนี้ `GOOGLE_CLIENT_ID` และ `GOOGLE_CLIENT_SECRET` **ว่างเปล่า** — ปุ่ม connect YouTube จะใช้ไม่ได้เลย

### 3.1 สร้าง Google Cloud project

1. https://console.cloud.google.com → สร้าง project
2. **APIs & Services → Library** → เปิดใช้ **YouTube Data API v3**
3. **OAuth consent screen** → ตั้งค่า (External ถ้าไม่ได้ใช้ Google Workspace)
4. **Credentials → Create Credentials → OAuth client ID → Web application**

- [ ] ได้ Client ID + Client Secret

### 3.2 ลงทะเบียน Redirect URI

**Authorized redirect URIs** ต้องมี:
```
http://localhost:4000/api/connected-accounts/google/callback
https://<domain-จริง>/api/connected-accounts/google/callback
```

- [ ] ลงทะเบียนครบ

### 3.3 ใส่ค่าลง .env

```bash
GOOGLE_CLIENT_ID=<client id>
GOOGLE_CLIENT_SECRET=<client secret>
```

scope ที่ระบบขอ (ตั้งไว้แล้ว ไม่ต้องแก้):
`youtube.upload` + `youtube.readonly`

- [ ] ใส่ครบ

### 3.4 เปิดใช้จริง

- [ ] เปลี่ยน `PUBLISHER_IMPL_YOUTUBE=mock` → `youtube`

> ⚠️ YouTube live path **ยังไม่เคยรันกับ credential จริง** เขียนตาม API spec แต่ไม่มีใครทดสอบได้เพราะไม่มี key
> ครั้งแรกที่เปิดใช้ **ให้ทดสอบกับ channel ทดสอบก่อน** อย่าเพิ่งใช้ channel หลัก

---

## ส่วนที่ 4 — TikTok / LINE OA

**ไม่ต้องทำอะไร** — ตัดสินใจไว้แล้ว (ดู `bussiness_rule.md`)

วิธีใช้งานจริง:
1. โพสต์เองบน TikTok / LINE OA ตามปกติ
2. เข้า Content Hub → หน้า **Scheduler** → กด **"Record external…"**
3. กรอก post ID / URL + รหัสผ่าน
4. โพสต์นั้นกลายเป็น tracked post — นับ cadence, แนบ metric, เข้า ranking ได้

- [ ] อ่านเข้าใจว่าสองช่องทางนี้เป็น manual (ไม่ใช่ bug)

> ต้องผ่าน copyright gate เหมือนกัน (ยืนยันไว้แล้ว) — ถ้าไม่บังคับ "โพสต์เองแล้วมาบันทึกทีหลัง" จะกลายเป็นช่องหลบ gate ทั้งหมด

---

## ส่วนที่ 5 — Production infrastructure (ยังไม่มีเลยสักอย่าง)

ตอนนี้คือ Docker Compose บนเครื่องเดียว

### 5.1 HTTPS (บังคับ)

- [ ] ตั้ง `NODE_ENV=production`
- [ ] วาง reverse proxy / load balancer ที่ terminate TLS

> `NODE_ENV=production` เปิด flag `Secure` บน session cookie → **ถ้าไม่มี HTTPS จะ login ไม่ได้เลย** (cookie ไม่ถูกส่ง)

### 5.2 Domain + CORS

- [ ] ตั้ง `CORS_ORIGIN=https://<domain-จริง>`
- [ ] build frontend ใหม่ด้วย `NEXT_PUBLIC_API_BASE_URL=https://<api-domain>`

> ⚠️ `NEXT_PUBLIC_*` ของ Next.js เป็น **build-time** ไม่ใช่ runtime — เปลี่ยน env เฉยๆ ไม่พอ **ต้อง rebuild image**

### 5.3 Database backup

- [ ] ตั้ง backup อัตโนมัติของ Postgres
- [ ] **ทดสอบ restore จริง** อย่างน้อย 1 ครั้ง (backup ที่ restore ไม่ได้ = ไม่มี backup)

### 5.4 CI

- [ ] สร้าง git remote (GitHub) แล้ว push

> `.github/workflows/ci.yml` เขียนไว้เรียบร้อย spin up Postgres + Redis จริง รัน lint/typecheck/test/build ทั้งสอง app
> แต่ **ไม่เคยรันบน GitHub Actions จริงสักครั้ง** เพราะยังไม่มี remote

### 5.5 Monitoring

- [ ] ติดตั้ง error tracking (Sentry) + metrics (Prometheus/Grafana)
- [ ] หลังมี monitoring แล้ว → ลด log level ของ 401 ที่เป็นเรื่องปกติ จาก ERROR เป็น WARN (ไม่งั้น alert จะดังตลอด)

---

## ส่วนที่ 5.6 — เปิด git hook (ทำครั้งเดียวต่อ clone)

hook อยู่ใน `.githooks/` แต่ git ไม่ใช้อัตโนมัติ ต้องชี้เอง:

```bash
git config core.hooksPath .githooks
```

- [ ] รันคำสั่งนี้ (ตั้งให้แล้วใน clone ปัจจุบัน — แต่ clone ใหม่ต้องตั้งซ้ำ)

> ป้องกัน commit ที่เอาเอกสาร review มารวมกับโค้ดที่มัน review — ดู `errorlog.md` P6-PROC-1
> CI ก็ตรวจซ้ำอีกชั้น (job `review-authorship`) เผื่อ hook ไม่ได้เปิด

---

## ส่วนที่ 6 — ตัดสินใจเชิงนโยบาย

### 6.1 Audit retention — ✅ ตัดสินใจ + implement แล้ว (2026-07-20)

**นโยบาย: anonymize PII เก็บแถวถาวร** (ไม่ใช่ลบแถวแบบ comment retention)

- แถว audit **ไม่ถูกลบเลย** — เป็นหลักฐานที่ค้ำ copyright gate ข้อพิพาทลิขสิทธิ์โผล่ได้หลังหลายปี
- หลัง **90 วัน** → ล้างเฉพาะ `actor` ของ `auth.login.failure` (email ที่คนพิมพ์เข้ามา อาจไม่ใช่ user เราด้วยซ้ำ) แทนด้วย `[anonymized]`
- action อื่น `actor` เป็น user id ภายใน ไม่ใช่ PII และจำเป็นต่อการระบุผู้กระทำ → ไม่แตะ

**รันยังไง**: `POST /api/audit-logs/retention/anonymize` (admin + CSRF, ไม่ต้อง step-up เพราะมีแต่ *ลด* ข้อมูลส่วนบุคคล)

- [x] ตั้ง cron ให้รันอัตโนมัติ — ✅ ทำแล้ว (2026-08-02) ดู §7.2 (`PdpaRetentionModule`, ทุกวัน 03:15)

### 6.2 Sentiment model

ตอนนี้ `SENTIMENT_IMPL=rule_based` — ทำงานในเครื่อง **ไม่มีข้อมูลออกไปข้างนอก**

ถ้าจะเปลี่ยนเป็น `model` ที่เรียก vendor ภายนอก:
- [ ] ทำ DPA (Data Processing Agreement) กับ vendor ก่อน
- [ ] ตัด author/identifier ออกก่อนส่ง — ส่งแค่ข้อความ
- [ ] ตรวจว่า vendor อยู่ประเทศไหน (PDPA cross-border transfer)

### 6.3 Ads/Paid

ตัดสินใจไว้: ใช้ Meta Ads Manager / TikTok Ads โดยตรงไปก่อน

- [ ] **จดบันทึกทุกครั้งที่ยิง ads ด้วยมือ**: content ไหน / platform / budget / ผลลัพธ์
- [ ] หลังใช้งานจริง ~8 สัปดาห์ → กลับมาทบทวนว่าคุ้มสร้างเข้าระบบไหม

> เงื่อนไขเดิมคือ "เก็บ requirement ระหว่าง Phase 2-5" แต่ build เร็วกว่าปฏิทิน (~3 วัน) จึงยังไม่มีข้อมูลจริงเลย — ต้องผูกกับ**การใช้งานจริง** ไม่ใช่ phase

### 6.4 Meta Ads MCP Server — ทำเป็นขั้นตอนสุดท้ายก่อน production

ตรวจสอบแล้ว 2026-07-20: Meta เปิด **Meta Ads AI Connectors** (MCP server + CLI) ประกาศ 29 เม.ย. 2026 สถานะ **open beta** (ยังไม่ GA) — เปิดให้ "businesses of all sizes across regions" ไม่มี waitlist

- Endpoint: `https://mcp.facebook.com/ads` (ยืนยันแล้ว ตอบ HTTP 401 = remote MCP จริง ต้อง OAuth)
- Auth: **Meta Business OAuth ตรง — ไม่ต้องมี Developer App, ไม่ต้อง App Review, ไม่ต้องเขียนโค้ด**
- ~29 tools: reporting/insights, campaign management (สร้าง/แก้ campaign-adset-ad ด้วยภาษาธรรมชาติ), catalog, account diagnostics, dataset ops

**ขั้นตอน (ทำท้ายสุด ก่อนขึ้น production):**

- [ ] เพิ่ม MCP server จาก terminal: `claude mcp add --transport http meta-ads https://mcp.facebook.com/ads`
- [ ] เปิด `claude` interactive → `/mcp` → authenticate ผ่าน Meta Business OAuth, เลือก ad account ที่จะให้เข้าถึง
- [ ] ทดสอบด้วย **ad account ทดสอบ / budget เล็ก** ก่อนเสมอ
- [ ] ตรวจว่าใช้เป็นเครื่องมือ**ของ admin ข้างนอกระบบ** — ห้ามผูก Content Hub ให้ call MCP นี้เป็น dependency (ดูเหตุผลด้านล่าง)

**ข้อควรระวัง:**

- campaign ที่ MCP สร้างจะเป็น **paused status เสมอ ไม่มี override flag** — สอดคล้องกับ business rule เดิม (ห้าม auto-publish, admin ต้อง confirm) แต่ tool ยังแก้ campaign ที่ active อยู่ได้ (budget/targeting/status) = **เงินจริง**
- ยัง open beta: ฟรีช่วง beta แต่ **ไม่มี pricing commitment / ไม่มี SLA / ไม่ประกาศวันจบ beta** → อย่าให้ระบบ production พึ่งพา
- เข้าไม่ถึง Advantage+ optimization, bidding algorithm, audience expansion, lead form
- MCP session กิน ~55k token แค่ tool descriptions
- Meta developer docs (`developers.facebook.com/documentation/mcp`) ตอนนี้ list ละเอียดแค่ Devtools MCP — ตัว Ads ยังไม่มี doc เต็ม (สอดคล้องสถานะ beta). รายละเอียด 29 tools / paused-only / 55k token มาจาก third-party blog **ยังไม่ยืนยันจาก doc ทางการ** — ต้องตรวจซ้ำตอนจะใช้จริง

**ผลต่อการตัดสินใจ Phase 7 (Ads revisit):** เหตุผลเดิมที่ไม่รวม ads เข้าระบบคือต้องสร้าง ad account OAuth + Ads API integration ใหม่ทั้งก้อน — **ต้นทุนนั้นหายไปแล้ว** (ไม่ต้องเขียน integration เลย). แต่ยังไม่ควรผูกเข้าระบบจนกว่าจะ GA + รู้ราคา. B-lite เดิมยังถูก แค่เครื่องมือดีขึ้น

---

## ส่วนที่ 7 — Pre-production security review (`docs/pre-production-security-review-2.md`, 2026-08-02)

Full-system STRIDE/OWASP pass รันไป 2 รอบ (ครั้งแรก + fresh re-run หลังแก้). สรุปสถานะ:

> ✅ **ทุก finding ระดับ Critical/High/Medium ปิดหมดแล้ว** (H-1, M-1, M-2, M-3, M-4) — verify ด้วยตัวเองทุกจุด (curl ต่อ live stack, npm audit สด, ไม่ใช่แค่เชื่อ commit) — READY FOR UAT
> รายละเอียด fix: Next.js 14→15.5.22 + React 18→19 (H-1), `AdminGuard` บน `ConnectedAccountsController` (M-1), security headers บน frontend (M-2), NestJS v10→v11 ทั้งชุด (M-3), date-range guard ที่ `CommerceConversionService` (M-4) + shared helper ป้องกันเกิดซ้ำครั้งที่ 4

**เหลือแค่ Low/Informational — ไม่ block UAT แต่ควรทำก่อนขึ้น production จริง:**

### 7.1 `/api/health` HTTP endpoint (L-1, ค้างมาตั้งแต่ DEVOPS-3) — ✅ ทำแล้ว (2026-08-02)

- [x] เพิ่ม `GET /api/health` — เช็ค Postgres + Redis จริง (ไม่ใช่แค่ process ตอบ), timeout 2 วิ ต่อ dependency, คืน `200` ถ้าทุกอย่าง ok หรือ `503` พร้อม `{database, redis}` แยกกันถ้ามีตัวไหน error. ไม่ต้อง login (load balancer ไม่มี session)
- [ ] ต่อ load balancer / orchestrator health check เข้ากับ endpoint นี้แทนการเช็คแค่ TCP port

> Verify แล้วด้วย live fault-injection จริง: หยุด container Redis → ได้ `503 {"database":"ok","redis":"error"}` ทันที, restart Redis → กลับ `200` เองโดยไม่ต้อง restart backend

### 7.2 ตั้ง cron ให้ PDPA retention endpoint ทำงานอัตโนมัติ (L-2) — ✅ ทำแล้ว (2026-08-02)

- [x] ตั้ง scheduled job เรียก logic เดียวกับ `POST /api/comments/retention/purge` (comment 12 เดือน)
- [x] ตั้ง scheduled job เรียก logic เดียวกับ `POST /api/audit-logs/retention/anonymize` (audit 90 วัน — ดู 6.1)

> ทำเป็น `PdpaRetentionModule` ใหม่ — BullMQ repeatable job (`upsertJobScheduler`, idempotent ข้าม restart) รันทุกวัน 03:15 เรียก `CommentRetentionService.purgeExpired` + `AuditRetentionService.anonymizeExpiredActors` ตรงๆ (function เดียวกับที่ endpoint เรียก ไม่ใช่ copy) ผ่าน actor `system:pdpa-retention-job`. Verify แล้วด้วย: 738/738 test ผ่าน, docker rebuild boot สะอาด, เช็ค Redis จริงผ่าน `queue.getJobSchedulers()` เห็น next run ตรง `2026-08-02T03:15:00.000Z`, trigger job manual บน container จริงแล้วเห็น log ประมวลผลสำเร็จ

### 7.3 พิจารณา global `APP_GUARD` (L-3, defense-in-depth, ไม่บังคับ)

- [ ] ทางเลือก: ใส่ `SessionAuthGuard` เป็น default ทั้งระบบผ่าน `APP_GUARD` provider แล้วเปิดเฉพาะ route สาธารณะ (เช่น login) ด้วย `@Public()` decorator แทนที่จะพึ่งทุก controller ประกาศ guard เอง

> ตอนนี้ sweep ทุก controller (17 ตัว) ผ่านหมดแล้ว แต่ไม่มี structural backstop ถ้า controller ใหม่ในอนาคตลืมใส่ guard — นี่คือสิ่งที่ทำให้ M-1 (ConnectedAccountsController ลืมใส่ AdminGuard) เกิดขึ้นได้ตั้งแต่แรก

### 7.4 Re-run `npm audit` ก่อน production build ทุกครั้ง

- [ ] `npm audit --prefix frontend` และ `npm audit --prefix backend --omit=dev` ก่อน build image จริง

> Next.js bundle `postcss`/`sharp` เวอร์ชันของตัวเองข้างใน — เปลี่ยนได้อิสระจาก `package.json` ของเรา ตอนนี้ accept เป็นความเสี่ยงต่ำ (ไม่ใช้ `next/image` เลย) แต่ควรเช็คซ้ำทุกครั้งก่อน build จริงเผื่อ Next.js ปล่อย patch ใหม่

### 7.5 (ไม่บังคับ) พิจารณา `helmet` middleware บน backend

- [ ] backend ยังไม่มี `helmet` — frontend มี security headers แล้ว (M-2) แต่ backend response header ยังเป็นค่า default ของ Express

---

## ลำดับที่แนะนำ

**ถ้าจะใช้ต่อในเครื่องตัวเอง (ไม่เปิดสาธารณะ):**
→ ทำแค่ ส่วนที่ 1 (secrets) + 2 (Facebook) พอ

**ถ้าจะขึ้น production จริง:**
→ 1 → 2 → 3 → 5.1 → 5.2 → 5.3 → 5.4 → 5.5 → 6 → 7 (7.4 ทำซ้ำทุกครั้งก่อน build)

**ทดสอบก่อนของจริงเสมอ:**
1. เปิด live ทีละ platform อย่าเปิดพร้อมกัน
2. ใช้ Page / channel ทดสอบก่อน
3. ดู audit log ว่าบันทึกครบ (`GET /api/audit-logs`)
4. ค่อยเปลี่ยนไปใช้ของจริง

---

## สิ่งที่ไม่ต้องทำ (ทำเสร็จแล้ว)

- ✅ Database schema + migrations (11 migrations)
- ✅ Ranking engine v2 (เปิดใช้แล้ว)
- ✅ Audit trail ลง DB (รอด restart)
- ✅ Copyright gate, PDPA controls, CSV export
- ✅ Commerce/Affiliate (Phase 6) + Paid/Ads visibility (Phase 7) — ปิดสมบูรณ์ทั้งคู่ พร้อม separation guarantee (payout/commerce/paid แยกกันจริง byte-identity proof)
- ✅ 727 backend tests + 169 frontend tests + 59 separation tests + 28 e2e tests
- ✅ Visual QA ครบทุกหน้า
- ✅ Next.js 14→15.5.22 + React 18→19 (H-1 — ปิด 6 CVE ระดับ High)
- ✅ NestJS 10→11 ทั้งชุด (M-3 — ปิด production vulnerability 12 ตัวเหลือ 0)
- ✅ `AdminGuard` ครบทุก controller (M-1) + security headers บน frontend (M-2)
- ✅ Pre-production security review ผ่าน 2 รอบ, ปิด finding ระดับ Critical/High/Medium ครบหมด — ดูส่วนที่ 7 สำหรับ Low/Informational ที่เหลือ

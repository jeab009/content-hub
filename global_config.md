# Global Config — Design Tokens & Shared UI Conventions

ค่ากลางที่ใช้ร่วมกันทั้งระบบ: font, สี, ขนาด, spacing และกฎการใช้งาน

**ทุกค่าในไฟล์นี้ดึงมาจากโค้ดจริง ไม่ใช่ค่าที่ตั้งขึ้นใหม่** — ถ้าแก้โค้ดต้องอัปเดตที่นี่ด้วย ไม่งั้นเอกสารจะโกหก

---

## 1. Font

### 1.1 Font family — ใช้ของ Bootstrap ทั้งหมด

โปรเจกต์ **ไม่ได้ import font จากที่ไหนเลย** (ไม่มี Google Fonts, ไม่มี `next/font`) — ใช้ native font stack ของ Bootstrap 5 ที่มากับ `bootstrap.min.css`

```
system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue",
"Noto Sans", "Liberation Sans", Arial, sans-serif,
"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"
```

**เหตุผลที่ยังไม่เปลี่ยน**: system stack เรนเดอร์ภาษาไทยได้ถูกต้องบนทุก OS โดยไม่ต้องโหลดอะไรเพิ่ม (macOS → Thonburi/Sarabun, Windows → Leelawadee UI, Android → Noto Sans Thai) และไม่มี FOUT/layout shift

> ⚠️ **ถ้าจะเปลี่ยนเป็น font ไทยเฉพาะ** (เช่น Sarabun, IBM Plex Sans Thai) ต้องทดสอบ:
> - ตาราง comment ที่มีข้อความไทยยาว — ความสูงแถวเปลี่ยน
> - `AXIS_CHAR_WIDTH` ในกราฟ (ดู §4) เป็นค่าประมาณจาก font ปัจจุบัน เปลี่ยน font แล้วต้องวัดใหม่

จุดที่ import: [`frontend/src/app/layout.tsx`](frontend/src/app/layout.tsx) — `import 'bootstrap/dist/css/bootstrap.min.css'`

### 1.2 Font size

ใช้ utility ของ Bootstrap ไม่มี custom size

| ที่ใช้ | class | ขนาดจริง | ใช้ตรงไหน |
|---|---|---|---|
| หัวข้อหน้า | `h1` | 2.5rem / 40px | ชื่อหน้า (Dashboard, Scheduler) |
| หัวข้อ section | `h2` | 2rem / 32px | บล็อกหลักในหน้า |
| หัวข้อย่อย | `h3` / `h5` / `h6` | 1.75 / 1.25 / 1rem | ตาราง, การ์ด, modal |
| ตัวเลข KPI | `fs-4` | 1.5rem / 24px | ตัวเลขบนการ์ด |
| เนื้อความ | (default) | 1rem / 16px | ทั่วไป |
| รอง / คำอธิบาย | `small` | 0.875rem / 14px | **ใช้บ่อยสุด (52 จุด)** — helper text, meta |

### 1.3 Font weight

| class | ใช้ตรงไหน |
|---|---|
| `fw-semibold` | เน้นในตาราง/การ์ด (17 จุด) — ตัวเลือกหลักของการเน้น |
| `fw-bold` | เน้นหนักจริงๆ เท่านั้น (2 จุด) |
| default | ทั่วไป |

### 1.4 สีตัวอักษร

| class | ใช้ตรงไหน |
|---|---|
| `text-muted` | คำอธิบาย/meta (52 จุด — คู่กับ `small`) |
| `text-dark` | **บังคับ**คู่กับพื้นสีอ่อน (ดู §2.2) |
| default | ทั่วไป |

---

## 2. สี (Color)

### 2.1 Palette — Bootstrap 5 semantic colors

ไม่มีการ override สี Bootstrap และ**ไม่มี custom hex** ยกเว้นกราฟ (§4)

| Token | Hex | ความหมายในระบบนี้ |
|---|---|---|
| `primary` | `#0d6efd` | ทำได้ตามเป้า / action หลัก / ทั่วไป |
| `success` | `#198754` | สำเร็จ, พร้อม, ผ่าน, positive |
| `danger` | `#dc3545` | ล้มเหลว, ถูกบล็อก, เกินกำหนด, negative |
| `warning` | `#ffc107` | ต้องระวัง, ต่ำกว่าเป้า, ยังไม่ยืนยัน |
| `info` | `#0dcaf0` | อยู่ระหว่างดำเนินการ, ข้อมูลเพิ่มเติม |
| `secondary` | `#6c757d` | ยังไม่เริ่ม, กลาง, ไม่มีข้อมูล |
| `dark` | `#212529` | จบแล้ว/เก็บถาวร (archived, cancelled) |

### 2.2 กฎบังคับ: พื้นอ่อนต้องคู่กับ `text-dark`

`bg-warning` และ `bg-info` มีค่า contrast ต่ำเมื่อใช้ตัวอักษรขาว **ต้องเขียนคู่กันเสมอ**:

```
'bg-warning text-dark'   ✅
'bg-info text-dark'      ✅
'bg-warning'             ❌ อ่านไม่ออก
```

ทำไว้แล้วทุกจุดใน `content-labels.ts` / `comment-labels.ts`

### 2.3 การจับคู่ state → สี (ที่ใช้จริง)

**Content status**
```
draft → secondary   ready → success   archived → dark
```

**Copyright clearance**
```
not_checked → secondary   cleared → success   blocked → danger
```

**Post status**
```
draft → secondary        scheduled → info
posted → success         posted_unconfirmed → warning+dark
failed → danger          cancelled → dark
```

**Publish method**
```
adapter → info+dark      manual_external → secondary
```

**Cadence pace**
```
on_pace → success   under_target → warning+dark   target_met → primary
```

**Sentiment**
```
positive → success   neutral → secondary   negative → danger
```

**Comment priority**
```
complaint → danger   question → info+dark   spam → secondary   general → primary
```

**SLA**
```
SLA breached → danger   Replied → success   Due <date> → info+dark   No SLA → secondary
```

### 2.4 กฎ Accessibility — สีห้ามสื่อความหมายเดี่ยวๆ

**ทุก badge ต้องมีข้อความกำกับเสมอ** ห้ามใช้สีอย่างเดียว

```
<span className="badge bg-danger">SLA breached</span>   ✅
<span className="badge bg-danger" />                     ❌
```

บังคับตั้งแต่ Phase 2 และ QC/QA ตรวจทุกรอบ — เหตุผล: คนตาบอดสี, screen reader, และการปริ้นขาวดำ

ที่มา: [`content-labels.ts`](frontend/src/lib/content-labels.ts), [`comment-labels.ts`](frontend/src/lib/comment-labels.ts)

---

## 3. Layout & Spacing

### 3.1 โครงหน้า

ทุกหน้าอยู่ใน container เดียวกัน กำหนดที่ `layout.tsx`:

```tsx
<div className="container py-4">{children}</div>
```

### 3.2 Spacing scale (Bootstrap: 1=4px, 2=8px, 3=16px, 4=24px, 5=48px)

| class | ใช้ตรงไหน |
|---|---|
| `mb-3` | ระยะห่างมาตรฐานระหว่าง element (40 จุด — ค่า default ที่ควรใช้) |
| `mb-4` | ระหว่าง section ใหญ่ (18 จุด) |
| `mb-1` / `mb-2` | ชิดกัน เช่น label กับ input |
| `mb-0` | ตัวสุดท้ายในกล่อง — กัน margin เกิน |
| `py-2` | padding ในแถว/การ์ด |
| `py-5` | empty state / หน้า login |
| `g-2` | gap ใน grid row |

### 3.3 Grid ที่ใช้จริง

| pattern | ใช้ตรงไหน |
|---|---|
| `col-md-3` | การ์ด KPI 4 ใบเรียงกัน |
| `col-md-4` | การ์ด 3 ใบ / cadence cards |
| `row` + `col-*` | ทุก layout |

### 3.4 ตาราง — บังคับ `table-responsive`

**ตารางทุกอันต้องห่อด้วย `table-responsive`** (ใช้แล้ว 9 จุด)

```tsx
<div className="table-responsive">
  <table className="table">...</table>
</div>
```

เหตุผล: ตาราง `/posts` กว้าง ~908px แต่ viewport แคบสุดที่ทดสอบคือ 375px — ถ้าไม่ห่อ ทั้งหน้าจะ scroll แนวนอน (visual QA ตรวจข้อนี้)

---

## 4. Chart (SVG — เขียนเอง ไม่มี lib)

กราฟทำเองด้วย SVG ล้วน ไม่พึ่ง Recharts/Chart.js — ค่าคงที่อยู่ใน [`trend-chart-layout.ts`](frontend/src/lib/trend-chart-layout.ts)

| ค่า | ตัวเลข | หมายเหตุ |
|---|---|---|
| `CHART_WIDTH` | 640 | viewBox |
| `CHART_HEIGHT` | 200 | viewBox |
| `AXIS_FONT_SIZE` | 11 | px |
| `AXIS_CHAR_WIDTH` | 6.2 | **ความกว้างประมาณของอักษร 1 ตัว** ที่ font size ด้านบน |
| `Y_LABEL_GAP` | 6 | ระยะจาก label ถึงแกน |
| `MIN_LEFT_PADDING` | 48 | ค่าต่ำสุด กัน label สั้นทำแกนชิดเกิน |

**สีเส้น/จุด**: `#0d6efd` (= Bootstrap `primary`) — hex ตรงเพียงจุดเดียวในระบบ

> ⚠️ **บทเรียนจาก BUG-P5-01**: เดิม padding เป็นค่าคงที่ 48px แต่ความกว้าง label ขึ้นกับขนาดตัวเลข (`THB 7.90` vs `THB 1,234,567.00`) ทำให้ตัว "T" โดนตัดเป็น `HB 7.90` — bug นี้ ship ตั้งแต่ Phase 3B และรอด QA มา 3 รอบเพราะไม่มีใครเปิดดูด้วยตา
>
> ตอนนี้คำนวณ padding จาก label จริง **ห้ามเปลี่ยนกลับเป็นค่าคงที่** และถ้าเปลี่ยน font ต้องวัด `AXIS_CHAR_WIDTH` ใหม่

---

## 5. Component patterns ที่ใช้ซ้ำ

| pattern | ไฟล์อ้างอิง | กฎ |
|---|---|---|
| **Step-up modal** | `PublishConfirmModal`, `ManualExternalRecordModal`, `CommentReplyModal` | 401 = ล้าง**เฉพาะ**ช่องรหัสผ่าน เก็บ field อื่นไว้, modal ไม่ปิด; 403/409/429 = ข้อความต่างกันชัดเจน |
| **Protected page** | `scheduler/page.tsx`, `dashboard/page.tsx` | `'use client'` → โหลด `me()`+`csrf()`+data ขนานกัน → 401 redirect `/login` → มี loading/empty/error state ครบ |
| **Badge + label map** | `content-labels.ts`, `comment-labels.ts` | สี+ข้อความมาคู่กันเสมอ (§2.4) |
| **Export CSV** | `ExportCsvButton` | `<a target="_blank">` ไม่ใช่ fetch+blob — เพื่อให้ session cookie ติดไปกับ top-level navigation |
| **API client** | `api-client.ts` | `credentials:'include'`, CSRF header เฉพาะ mutation, `ApiError(message, status)` |

---

## 6. ความกว้างที่ต้องทดสอบ (visual QA)

| ขนาด | ทำไมต้องตรวจ |
|---|---|
| **375 × 812** | มือถือ — ตารางต้อง scroll ในกรอบตัวเอง ไม่ใช่ทั้งหน้า |
| **768 × 1024** | แท็บเล็ต — **จุดที่ grid มักจะวางของ 2 อย่างข้างกันโดยไม่ตั้งใจ** |
| **1280 × 800** | เดสก์ท็อป — ค่ามาตรฐาน |

---

## 7. สิ่งที่ตั้งใจ *ไม่* ทำ

- **ไม่มี custom CSS file** — ไม่มี `.css`/`.scss` ในโปรเจกต์เลย ใช้ Bootstrap utility ล้วน
- **ไม่มี CSS-in-JS / Tailwind** — เลือก Bootstrap ตั้งแต่ Phase 1 (ระบุใน `makedown.md` §4)
- **ไม่มี dark mode**
- **ไม่มี design system / component library ของตัวเอง** — เป็น internal admin tool ไม่ใช่ product ที่ต้องคุม brand
- **ไม่มี chart library** — SVG เขียนเองเพราะต้องการแค่ trend line เดียว (เหตุผลเดียวกับที่เลือก `pdfkit` แทน headless Chromium)

ถ้าจะเพิ่มอย่างใดอย่างหนึ่ง ควรเป็นการตัดสินใจที่บันทึกไว้ ไม่ใช่ค่อยๆ ไหลเข้ามา

---

## 8. เวลาแก้ไฟล์นี้

อัปเดตเมื่อ:
- เพิ่ม/เปลี่ยนการจับคู่ state → สี
- เปลี่ยน font หรือเพิ่ม custom CSS
- เพิ่มค่าคงที่ของกราฟ หรือแก้ layout constant
- เพิ่ม component pattern ที่ใช้ซ้ำหลายที่

**ห้ามเขียนค่าที่ยังไม่มีในโค้ด** — ไฟล์นี้บันทึกสิ่งที่เป็นจริง ไม่ใช่สิ่งที่อยากให้เป็น ถ้าอยากเสนอค่าใหม่ให้เขียนใน `suggestion.md`

# Phase 6 — Commerce / Affiliate · PDPA & Separation Policy

**Work package:** 6.0.6
**Status:** Locked at the 6.0 Schema & Separation Gate
**Authority:** System Analyst conditions A1–A6, B1–B7, C1–C7 (`docs/phase6-system-analysis.md`)
**Applies to:** `commerce_products`, `affiliate_links`, `product_anchors`, `commerce_placements`, `commerce_conversions`
**Date:** 2026-07-20

This document is a **policy**, not a design note. Everything in it is either
enforced by a database constraint, a lint rule or a test *today*, or is listed
in §7 as an explicitly deferred item with the phase that owns it. Nothing here
is aspirational.

---

## 1. PDPA posture — the statement that is actually defensible

The design offered a stronger claim than the schema supports: *"no column in
the five commerce tables is capable of holding buyer or order data."* That is
not literally true, and the System Analyst declined to sign it as written. The
signed formulation is:

> Commerce introduces **no new data subject** and **no structural capacity**
> for buyer or order data. Two free-text fields remain capable of holding
> personal data if an admin deliberately types it; both are format- or
> length-constrained, neither is exported or audited, both are clearable in
> place, and the ingestion seam applies the same constraint as the HTTP seam.

Three things carry that statement:

1. **No new data subject.** The only personal data commerce introduces is
   `created_by` / `recorded_by` — the single admin, already a data subject of
   the existing system. This is the strongest part of the PDPA case.
2. **No buyer-shaped column.** There is no `buyer_*`, `order_id`, `recipient`,
   `address`, `phone`, `email` or per-transaction identifier. `orders_count`
   and `items_sold` are `Int` aggregate counters and cannot hold an identifier.
   Frozen by `COMMERCE_TABLE_COLUMNS` and asserted twice — against the
   generated Prisma client in the unit suite, and against
   `information_schema.columns` in the e2e suite.
3. **Two residual free-text columns, named and bounded.** They are
   `commerce_conversions.statement_ref` and `commerce_placements.note`. There
   are exactly two, and §2–§4 below govern them.

---

## 2. `statement_ref` — format constraint (condition A1)

**Decided pattern:**

```
^[A-Za-z0-9][A-Za-z0-9._\-/]{0,63}$
```

Exported as `COMMERCE_STATEMENT_REF_PATTERN` in
`backend/src/modules/commerce/commerce.constants.ts`.

**The space is gone, and that is the whole point.** The design proposed
`/^[A-Za-z0-9._\-\/ ]+$/`, justified as *"a pasted name, address, phone or
email fails validation."* The class included a space, so `John Smith`,
`Somchai P` and `Ratchada Rd 42` all passed. What it actually blocked was Thai
script, `@`, `+`, `(` and `,` — emails and Thai-language names, but not
Latin-script ones. A partial control described as a complete one is worse than
a control everyone knows is partial.

| Property | Value | Why |
|---|---|---|
| Anchored | `^…$` | An unanchored pattern accepts `Somchai SHP-2026` by matching the tail. |
| First char | alphanumeric | Stops leading punctuation and CSV-formula-shaped values. |
| Length | 64, bounded **in the pattern** | Matches `COMMERCE_STATEMENT_REF_MAX_LENGTH` and the DB CHECK `commerce_conversions_statement_ref_len_chk`. Three places, one number. |
| Digits | accepted | `0812345678` is indistinguishable from a statement id by regex. **Accepted residual** — this is precisely why §4's erasure procedure exists. |

**Where it must be enforced (condition A2/A3 — code lands in 6A.7, not in the
6.0 gate):** an exported `assertStatementRefShape(value)` called by **the
service**, and again at the adapter ingestion seam. The DTO decorator is the
redundant second layer, never the primary one. `ConversionSnapshot.statementRef`
flows from a future live adapter into the column through the service, and
class-validator decorators only ever run on HTTP request bodies — a control
living only on the DTO is absent from the exact path it was written to guard.

---

## 3. `note` — length cap (condition A4)

**200 characters**, reduced from the design's 500, enforced in the migration by
`commerce_placements_note_len_chk` and mirrored by
`COMMERCE_PLACEMENT_NOTE_MAX_LENGTH`.

No regex. A note has genuine prose value — *"reshot vertical, approved by admin
07-14"* is 41 characters — and a regex on prose would be theatre. 500
characters was an invitation; 200 holds every legitimate note the team has
written and does not comfortably hold a name, an address and a phone number.

---

## 4. Retention and erasure (condition A5) — **the PDPA gate item**

### 4.1 Position

**Commerce rows are financial records and are NEVER deleted.**

Commerce falls into neither existing regime, and forcing it into either would
be wrong:

| Existing regime | Rule | Why commerce is not this |
|---|---|---|
| Audit (`audit-log.constants.ts`) | Rows permanent; `actor` anonymized in place after 90 days (`AUDIT_ACTOR_ANONYMIZE_AFTER_DAYS`) | Right *shape*, wrong trigger — commerce has no 90-day expiry. |
| Comments (`comments.constants.ts`) | Hard delete at `RETENTION_MONTHS = 12` | Deleting a conversion row destroys a financial record and silently orphans its reversal. |

Commerce takes **audit's anonymize-in-place, keep-the-row pattern** — the same
model as `AuditRetentionService.anonymizeExpiredActors` — with an **admin
erasure request**, not elapsed time, as the trigger. Financial records have a
legitimate long-retention basis under Thai accounting practice; the free text
attached to them does not.

### 4.2 The erasure surface is exactly two columns

Frozen as `COMMERCE_ERASABLE_FREE_TEXT_COLUMNS`:

| Table | Column |
|---|---|
| `commerce_conversions` | `statement_ref` |
| `commerce_placements` | `note` |

No other commerce column can hold personal data. This is asserted by the
column allow-list test, so the list cannot silently fall out of date: a new
column fails the test until someone updates the allow-list, and that diff is
the review moment.

### 4.3 The procedure (DB-level, available now)

A UI is **not** required this phase. The *procedure* is, because "we have no
way to comply with an erasure request" is not an acceptable answer at a PDPA
gate. Run inside a transaction, as the database owner:

```sql
BEGIN;

-- 1. Identify. Never erase blind; the reviewed row list is the audit record
--    of what was erased and why.
SELECT id, channel, period_start, period_end, statement_ref
FROM commerce_conversions
WHERE statement_ref IS NOT NULL
  AND statement_ref ILIKE '%<the reported value>%';

SELECT id, content_id, channel, note
FROM commerce_placements
WHERE note IS NOT NULL
  AND note ILIKE '%<the reported value>%';

-- 2. Anonymize IN PLACE. NULL, never DELETE: the financial row survives, the
--    free text does not. Idempotent — re-running changes nothing.
UPDATE commerce_conversions SET statement_ref = NULL WHERE id = ANY($1::uuid[]);
UPDATE commerce_placements  SET note         = NULL WHERE id = ANY($1::uuid[]);

-- 3. Record the erasure itself in audit_logs (action: 'commerce_conversion_added'
--    is NOT correct here — use the operator runbook entry; a dedicated
--    audit action is a 6A item, see §7).

COMMIT;
```

**Invariants this procedure must never break, and why:**

- `DELETE` is prohibited. A deleted conversion orphans any row whose
  `reversal_of_id` points at it, and the FK is `ON DELETE RESTRICT`, so the
  attempt fails loudly — which is the correct behaviour, not an obstacle to
  route around.
- Both columns are nullable, so `NULL` is always a legal value. No CHECK is
  violated by erasure — verified: `commerce_placements_note_len_chk` and
  `commerce_conversions_statement_ref_len_chk` are both `IS NULL OR …`.
- Erasure is **idempotent**, mirroring `anonymizeExpiredActors`. Re-running a
  request that was already satisfied is a no-op, not an error.

---

## 5. Audit meta exclusion (condition SA-4)

These fields must **never** appear in `audit_logs.meta`, on any commerce
action:

| Field | Reason |
|---|---|
| `commerce_conversions.statement_ref` | Free text, highest PII residual |
| `commerce_placements.note` | Free text |
| `commerce_products.name` | Not PII, excluded for consistency of the rule |
| `affiliate_links.url` | May carry sub-ids / tracking params |

`AuditLogService.record()` redacts once and reuses the same object for both
sinks, so there is no code path that persists raw meta — omitting these keys at
the call site is therefore sufficient.

**Decided, so QA does not file it as a bug:** `redactSensitive` matches
`SENSITIVE_FIELD_PATTERNS` by case-insensitive **substring** and the list
includes `'code'` (for OAuth authorization codes). A `trackingCode` key in meta
would therefore be written as `[REDACTED]`. A tracking code has no value in the
audit trail, so it is simply never put in meta. The redaction is a harmless
no-op we rely on, not a defect.

---

## 6. Currency (condition SA-9 / C1)

- **Store as received; never convert.** No exchange rate is applied anywhere in
  the codebase, in any phase.
- **The column ships now.** `currency CHAR(3) NOT NULL DEFAULT 'THB'` on both
  money-bearing tables (`commerce_products`, `commerce_conversions`), each with
  `CHECK (currency ~ '^[A-Z]{3}$')`. `@db.Char(3)` alone is blank-padded and
  would accept `'xx '`, `'123'` or lowercase; a `'thb'`/`'THB'` split would
  silently fragment every `GROUP BY currency` into two half-totals that each
  look plausible. Adding a column later is expensive and irreversible; relaxing
  a service guard later is free.
- **v1 rejects non-THB on write**, in the service, from
  `COMMERCE_SUPPORTED_CURRENCIES`. This removes the open admin question from
  the critical path without weakening the control — the admin's answer can
  arrive during 6A.
- **The summary must never produce a total across currencies**, even if the
  guard is relaxed. It groups by currency and emits no scalar grand total.
  Asserted in 6A by a test seeding one THB and one non-THB row.

Note for the record: the System Analyst's text says "all three money-bearing
tables". There are **two** — `commerce_products` (`list_price`) and
`commerce_conversions` (`gross_sales_amount`, `commission_amount`).
`affiliate_links`, `product_anchors` and `commerce_placements` carry no money
column, so a `currency` column on them would be meaningless. Both money-bearing
tables have the column and the CHECK; the constraint is verified live against
Postgres by the e2e suite.

---

## 7. The non-summation rule, and what enforces it

**The rule:** payout revenue and commerce commission are two streams with two
totals. **No combined total anywhere** — not in a service, not in a CSV, not in
a JSX expression. A combined figure is a new admin decision
(`phase6-project-plan.md` C-A/C-B/C-C), not a refactor.

| Layer | Mechanism | Where |
|---|---|---|
| 1 | No Prisma relation from any commerce model into `Post`/`Content`/`ContentAsset`/`User`; FKs are hand-written `ALTER TABLE`. The traversal is **unspellable**, not merely discouraged. | `prisma/schema.prisma`, `migrations/20260721000000_phase6_commerce` |
| 2 | ESLint `no-restricted-imports` zones, **both directions**, system-wide | `backend/.eslintrc.cjs`, `frontend/.eslintrc.js` |
| 3 | Static boundary scan — text, not AST, comments stripped, no exemptions | `src/testing/separation/commerce-boundary.spec.ts` |
| 4 | Byte-identity proof against a real Postgres | `test/payout-unaffected-by-commerce.e2e-spec.ts` |
| 5 | Disjoint vocabulary + frozen CSV headers | `src/testing/separation/csv-header-freeze.spec.ts` |

**The one sanctioned bridge:** `reports.controller.ts` is exempt from the
import ban so it can mount the commerce CSV (6A.9). The exemption is correct —
forcing the commerce export into the payout service would be worse — and its
price is paid by (a) the frozen-header test on all three existing CSVs, and (b)
the boundary scan, which covers the whole of `reports/` with no exemption at
all.

---

## 8. Rollback (§5.6)

`20260721000000_phase6_commerce` is additive-only: three enums, five tables,
one nullable column. To roll back:

1. Drop the five tables, children first: `commerce_conversions`,
   `product_anchors`, `affiliate_links`, `commerce_placements`,
   `commerce_products`.
2. Drop the three enums: `CommercePlacementStatus`, `CommerceSource`,
   `CommerceChannel`.
3. **Leave `content_assets.duration_seconds`.** It is additive, nullable and
   harmless, and dropping it discards durations already parsed at upload.

No existing table is altered and no existing enum gains a value, so a rollback
cannot corrupt Phase 1–5 data. `Platform` and `AssetPlatform` are untouched —
proven by the enum-freeze test, not by inspection — which matters because
Postgres enum additions are irreversible and appending `shopee` to
`AssetPlatform` would have enrolled commerce into v2 ranking on the spot.

---

## 9. Deferred, with the phase that owns each

| Item | Deferred to | Reason |
|---|---|---|
| `assertStatementRefShape()` in the service + adapter seam (A2/A3) | 6A.7 / 6A.1 | Needs the service and the adapter seam, neither of which exists at the 6.0 gate. The **pattern** is frozen here; only its call sites are deferred. |
| Non-THB rejection in the service (SA-9) | 6A.7 | Same — the allow-list is frozen here, the guard needs a write path. |
| A dedicated `commerce_pii_erased` audit action | 6A | The erasure procedure works today via the operator runbook; a typed action is better but is not what makes compliance possible. |
| Erasure UI | Post-6B, if ever | Explicitly not required. The procedure is the deliverable. |
| `GET /api/commerce/summary/:contentId` surface (B7) | 6A.8 / 6B | Ship the endpoint; do **not** render it on `/dashboard/revenue/[contentId]`. Surface it on placement/post detail — commerce surfaces with no payout total in the same viewport. |
| Per-credential step-up failure counter (SA-6 second order) | 6C | Non-blocking; recorded as tech debt. |
| `prisma migrate diff` drift check in CI (§5.3) | 6C | Non-blocking. The e2e suite's `information_schema` allow-list check is a partial standing substitute. |
| Archived-content behaviour for placements/summary (§5.5) | 6A | Needs an admin decision, not code. |

---

**Prepared by:** Senior App Developer, Loop Engineering Position #4
**Gate:** 6.0 Schema & Separation — closes conditions A1, A4, A5, SA-4, SA-9/C1
**Next:** Quality Control review, then QA

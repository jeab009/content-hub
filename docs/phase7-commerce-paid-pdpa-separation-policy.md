# Phase 7 — Paid/Ads Visibility · PDPA & Separation Policy

**Work package:** 7.0.4
**Status:** Locked at the 7.0 Schema & Separation Gate
**Authority:** System Analyst conditions P-A1–P-A4, P-B1–P-B4, SA-P1–SA-P7
(`docs/phase7-system-analyst-signoff.md`)
**Applies to:** `ad_campaigns`, `ad_performance_entries`
**Date:** 2026-07-31
**Template:** `docs/phase6-commerce-pdpa-separation-policy.md` (Phase 6.0 gate) — this
document mirrors its structure and rigor for the third stream.

This document is a **policy**, not a design note. Everything in it is either
enforced by a database constraint, a lint rule or a test *today*, or is listed
in §8 as an explicitly deferred item with the sub-phase that owns it. Nothing
here is aspirational.

---

## 1. PDPA posture — the statement that is actually defensible

The architecture design offered language suggesting a stronger claim than
necessary was defensible as written on one specific control (the `sourceRef`
regex, see §2). Corrected per the System Analyst sign-off, the honest and
signed formulation is:

> Paid-visibility introduces **no new data subject** and **no structural
> capacity** for audience-targeting, custom-audience, or individual
> click/impression-level data — the schema has no column that could hold any
> of it. Two free-text fields remain capable of holding personal data if an
> admin deliberately types it; `sourceRef` is format- and length-constrained
> in the service with the same pattern Commerce shipped (not the one
> Commerce's design draft proposed and rejected); `objective` is
> length-constrained only. Both are clearable in place under the retention
> policy below.

Three things carry that statement:

1. **No new data subject.** The only personal data paid introduces is
   `created_by` / `recorded_by` — the single admin, already a data subject of
   the existing system.
2. **No audience-shaped column.** There is no `audience_*`, `segment_id`,
   `pixel_id`, `recipient`, `custom_audience_ref` or per-click/impression
   identifier. `reach`, `impressions`, `clicks` and `result_count` are `Int`
   aggregate counters and are structurally incapable of holding an
   identifier. Frozen by `PAID_TABLE_COLUMNS`
   (`backend/src/modules/paid/paid.constants.ts`) and asserted against the
   generated Prisma client in the unit suite (7.0.5).
3. **Two residual free-text columns, named and bounded.** They are
   `ad_campaigns.objective` and `ad_performance_entries.source_ref`. There are
   exactly two, and §2–§4 below govern them.

---

## 2. `sourceRef` — format constraint (condition P-A1 / finding SA-P1)

**Decided pattern:**

```
^[A-Za-z0-9][A-Za-z0-9._\-/]{0,63}$
```

Exported as `PAID_SOURCE_REF_PATTERN` in
`backend/src/modules/paid/paid.constants.ts`.

**This is `COMMERCE_STATEMENT_REF_PATTERN`, copied verbatim in shape — not
the regex the architecture design quoted.** The design draft's §1.5 stated
this control "follows Commerce's shipped resolution of its own equivalent
finding" and quoted `^[A-Za-z0-9._\-\/ ]+$`. That is the exact PRE-FIX
pattern Commerce's own SA-1 already found defective and rejected, reused here
by mistake, not the pattern that actually shipped. The character class
contains a space: with it present, `John Smith`, `Somchai P` and
`Ratchada Rd 42` all pass validation, so a pasted Latin-script personal name
is **not** blocked — the opposite of the stated purpose. Left as written, 7A
would have shipped the exact regex Phase 6 already proved defective, under
the belief it was reusing the fix. The System Analyst sign-off (§1, P-A-i)
caught this before any code was written against it.

| Property | Value | Why |
|---|---|---|
| Anchored | `^…$` | An unanchored pattern accepts a trailing appended value by matching only the head or tail. |
| First char | alphanumeric | Stops leading punctuation and CSV-formula-shaped values. |
| Length | 64, bounded **in the pattern** | Matches `PAID_SOURCE_REF_MAX_LENGTH`. |
| Digits | accepted | `0812345678` is indistinguishable from a source reference id by regex. **Accepted residual** — this is precisely why §4's erasure procedure exists. |
| Space | **absent** | The defect the design draft reused from the pre-fix Commerce regex; its absence is the entire point of this control. |

**Where it must be enforced (condition P-A1 — code lands in 7A.2, not the 7.0
gate):** an exported shape-assertion helper called by **the service**, and
again at any future adapter ingestion seam (7D). The DTO decorator is the
redundant second layer, never the primary one: a future live-sync path would
otherwise bypass class-validator exactly as `ConversionSnapshot.statementRef`
did in Commerce, since class-validator decorators only ever run on HTTP
request bodies.

---

## 3. `objective` — length cap, no format regex (SA-P4 context)

**100 characters**, enforced in 7A by a DTO length validator and a DB CHECK
(mirroring `commerce_placements_note_len_chk`'s reasoning). `PAID_OBJECTIVE_
MAX_LENGTH` in `paid.constants.ts` freezes the number.

No regex. `objective` is a short categorical label ("Traffic", "Conversions",
"Brand awareness"), not a business-reconciliation reference an admin might pad
with extra identifying detail — a regex here would be theatre, exactly as
Commerce's `note` field reasoning established.

---

## 4. Retention and erasure (condition P-A4 / §5.2) — **the PDPA gate item**

### 4.1 Position

**Paid campaign and performance rows are business/marketing-spend records and
are NEVER deleted.**

The architecture design did not mention retention or erasure once, for either
table — the single most significant omission the System Analyst sign-off
found (§5.2), structurally identical to Phase 6's own A5 gap in the Commerce
design. Paid falls into neither existing regime, and forcing it into either
would be wrong, for the identical reasons Commerce's A5 established:

| Existing regime | Rule | Why paid is not this |
|---|---|---|
| Audit (`audit-log.constants.ts`) | Rows permanent; `actor` anonymized in place after 90 days (`AUDIT_ACTOR_ANONYMIZE_AFTER_DAYS`) | Right *shape*, wrong trigger — paid has no 90-day expiry. |
| Comments (`comments.constants.ts`) | Hard delete at `RETENTION_MONTHS = 12` | Deleting a performance entry destroys a business record and could orphan a correction that names it. |

Paid takes **audit's anonymize-in-place, keep-the-row pattern** — the same
model as `AuditRetentionService.anonymizeExpiredActors` and Commerce's own
`COMMERCE_ERASABLE_FREE_TEXT_COLUMNS` — with an **admin erasure request**, not
elapsed time, as the trigger. An admin should be able to see "what we spent
last quarter" indefinitely, the same way payout and commerce history persists;
the free text attached to a campaign or entry does not need that same
permanence.

### 4.2 The erasure surface is exactly two columns

Frozen as `PAID_ERASABLE_FREE_TEXT_COLUMNS`:

| Table | Column |
|---|---|
| `ad_campaigns` | `objective` |
| `ad_performance_entries` | `source_ref` |

No other paid column can hold personal data. This is asserted by the column
allow-list test (7.0.5), so the list cannot silently fall out of date: a new
column fails the test until someone updates the allow-list, and that diff is
the review moment.

### 4.3 The procedure (DB-level, available now)

A UI is **not** required this phase, mirroring Commerce's A5 acceptance. The
*procedure* is, because "we have no way to comply with an erasure request" is
not an acceptable answer at a PDPA gate a second time. Run inside a
transaction, as the database owner:

```sql
BEGIN;

-- 1. Identify. Never erase blind; the reviewed row list is the record of
--    what was erased and why.
SELECT id, channel, external_campaign_name, objective
FROM ad_campaigns
WHERE objective IS NOT NULL
  AND objective ILIKE '%<the reported value>%';

SELECT id, campaign_id, period_start, period_end, source_ref
FROM ad_performance_entries
WHERE source_ref IS NOT NULL
  AND source_ref ILIKE '%<the reported value>%';

-- 2. Anonymize IN PLACE. NULL, never DELETE: the business record survives,
--    the free text does not. Idempotent — re-running changes nothing.
UPDATE ad_campaigns            SET objective  = NULL WHERE id = ANY($1::uuid[]);
UPDATE ad_performance_entries  SET source_ref = NULL WHERE id = ANY($1::uuid[]);

-- 3. Record the erasure itself in audit_logs (none of the five paid actions
--    is correct here — use the operator runbook entry; a dedicated audit
--    action, mirroring commerce's deferred equivalent, is a 7A item).

COMMIT;
```

**Invariants this procedure must never break, and why:**

- `DELETE` is prohibited. A deleted performance entry could orphan a row whose
  `corrects_entry_id` points at it; the FK is `ON DELETE SET NULL`
  (deliberately more permissive than Commerce's `reversal_of_id ON DELETE
  RESTRICT` — see the migration comment — but `DELETE` on these rows is still
  not a supported operation this phase; there is no route that performs one).
- Both columns are nullable, so `NULL` is always a legal value. No CHECK is
  violated by erasure.
- Erasure is **idempotent**, mirroring `anonymizeExpiredActors`. Re-running a
  request that was already satisfied is a no-op, not an error.

---

## 5. Audit meta exclusion (condition SA-P4)

These fields must **never** appear in `audit_logs.meta`, on any of the five
paid actions (`ad_campaign_created`, `ad_campaign_updated`,
`ad_campaign_retired`, `ad_performance_entry_added`, `paid_report_exported`):

| Field | Reason |
|---|---|
| `ad_campaigns.objective` | Free text |
| `ad_campaigns.external_campaign_name` | Free text identifier |
| `ad_campaigns.external_campaign_id` | Free text identifier |
| `ad_performance_entries.source_ref` | Free text, highest PII residual |

**All four, not only `sourceRef`.** The architecture design proposed
excluding only `sourceRef` and left the other three open, contrasting this
with Commerce's "blanket exclusion... despite it not being PII" precedent for
`commerce_products.name`. The System Analyst ruled for consistency: applying
the same blanket exclusion Commerce used, for the same reason — the audit
trail does not need business-descriptive free text to do its job (the row
itself, queryable via the normal campaign/performance-entry read paths,
already retains the full value); the audit log's job is to prove *that* a
mutation happened and *who* did it, not to duplicate the row's content.
Narrowing the exclusion to "only the field with genuine residual PII risk"
would create an inconsistency with the shipped precedent for no functional
benefit.

`AuditLogService.record()` redacts once and reuses the same object for both
sinks, so there is no code path that persists raw meta — omitting these keys
at the call site is therefore sufficient.

**Checked and confirmed clean (System Analyst §5.3):** none of the paid
field names (`channel`, `externalCampaignName`, `externalCampaignId`,
`objective`, `contentId`, `startDate`, `endDate`, `plannedBudget`,
`currency`, `status`, `spend`, `reach`, `impressions`, `clicks`,
`resultType`, `resultCount`, `periodStart`, `periodEnd`, `sourceRef`,
`correctsEntryId`) collides with `redactSensitive`'s case-insensitive
substring match on `SENSITIVE_FIELD_PATTERNS` (`password`, `token`, `secret`,
`authorization`, `cookie`, `session`, `client_secret`, `app_secret`, `code`,
`encryption_key`). No collision — worth stating explicitly since §5's
exclusion list already removes the descriptive fields from meta anyway, but
the numeric/structural fields that do remain in meta are unaffected.

---

## 6. Currency (condition SA-P6)

- **Store as received; never convert.** No exchange rate is applied anywhere
  in the codebase, in any phase.
- **The column ships now.** `currency CHAR(3) NOT NULL DEFAULT 'THB'` on both
  `ad_campaigns` and `ad_performance_entries`, each with
  `CHECK (currency ~ '^[A-Z]{3}$')`. `@db.Char(3)` alone is blank-padded and
  would accept `'xx '`, `'123'` or lowercase; a `'thb'`/`'THB'` split would
  silently fragment every `GROUP BY currency` into two half-totals that each
  look plausible. Adding a column later is expensive and irreversible;
  relaxing a service guard later is free.
- **The admin's OQ-4 answer is on record**
  (`bussiness_rule.md`, "Phase 7 OQ-4 answer (2026-07-21): currency = THB
  only" — เหมือน Commerce เป๊ะ): **THB only for v1.** The System Analyst
  sign-off flagged this as the one open, schedule-blocking question and it is
  now resolved before this migration shipped, per the design's own stated
  deadline.
- **v1 rejects non-THB on write**, in the service (7A), from
  `PAID_SUPPORTED_CURRENCIES` in `paid.constants.ts`.
- **The paid summary must never produce a total across currencies**, even if
  the guard is relaxed later. It groups by currency and emits no scalar grand
  total, mirroring Commerce's NFR-6.12 (this phase: NFR-7.10). Asserted in 7A
  by a test seeding a second currency once one exists.

---

## 7. The non-summation rule, and what enforces it

**The rule:** payout revenue, commerce commission, and paid spend are THREE
independent streams with three totals. **No combined total anywhere** — not
in a service, not in a CSV, not in a JSX expression. A combined figure is a
new admin decision, not a refactor.

| Layer | Mechanism | Where |
|---|---|---|
| 1 | No Prisma relation from `AdCampaign`/`AdPerformanceEntry` into `Content`/`User`; FKs are hand-written `ALTER TABLE`. The traversal is **unspellable**, not merely discouraged. | `prisma/schema.prisma`, `migrations/20260721091512_phase7_paid_visibility` |
| 2 | ESLint `no-restricted-imports` zones, now **three-way** (payout/ranking ⇄ commerce ⇄ paid) | `backend/.eslintrc.cjs`, `frontend/.eslintrc.js` |
| 3 | Static boundary scan — text, not AST, comments stripped, no exemptions, extending the EXISTING `PAYOUT_AND_RANKING_DIRS`/`COMMERCE_SIDE_DIRS` constants (System Analyst condition P-B1 — a hand-derived directory list from the design doc's prose under-scopes it) | `src/testing/separation/commerce-boundary.spec.ts` |
| 4 | Byte-identity proof against a real Postgres | `src/testing/e2e/*` (7A.5) |
| 5 | Disjoint vocabulary + frozen CSV headers | `src/testing/separation/commerce-vocabulary-freeze.spec.ts`, `csv-header-freeze.spec.ts` (7A.5) |

**Every new separation test must be proven to fail first** (condition P-B2,
restating Phase 6's own B1 discipline) — an unexecuted or trivially-passing
separation test is worse than no test.

---

## 8. Deferred, with the sub-phase that owns each

| Item | Deferred to | Reason |
|---|---|---|
| `sourceRef` shape-assertion helper in the service + adapter seam (P-A1) | 7A.2 | Needs the service, which does not exist at the 7.0 gate. The **pattern** is frozen here; only its call sites are deferred. |
| Non-THB rejection in the service (SA-P6) | 7A.2 | Same — the allow-list is frozen here, the guard needs a write path. |
| Performance-entry idempotency window (§4.2 finding, `PAID_PERFORMANCE_ENTRY_IDEMPOTENCY_WINDOW_MS`) | 7A.2 | Needs the append endpoint. |
| Same-campaign validation for `correctsEntryId` (P-A3) | 7A.2 | Needs the service; the DB-level self-reference CHECK ships now. |
| A dedicated paid PII-erasure audit action | 7A | The erasure procedure works today via the operator runbook; a typed action is better but is not what makes compliance possible. |
| Erasure UI | Post-7B, if ever | Explicitly not required. The procedure is the deliverable. |
| Byte-identity e2e fixture, vocabulary-freeze extension, CSV header freeze | 7.0.5 / 7A.5 | The DTOs/endpoints these reference are 7A work; a test that cannot currently fail meaningfully is not written prematurely (System Analyst condition P-B2). |
| `PaidModule`'s import graph verification (`{ContentModule, common/*}` only) | 7A.1, ongoing | The module does not exist yet at the 7.0 gate; the boundary scan constant extension (7.0.5) is the enforcement mechanism once it does. |

---

**Prepared by:** Senior App Developer, Loop Engineering Position #4
**Gate:** 7.0 Schema & Separation — closes conditions P-A1, P-A2, P-A3, P-A4,
SA-P4, SA-P6, P-B1, P-B2
**Next:** Quality Control review, then QA

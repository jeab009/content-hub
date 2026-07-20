# Phase 6.0 — Schema & Separation Gate · QA Test Report

- **Author**: Senior QA Test Engineer, Loop Engineering Position #6
- **Date**: 2026-07-20
- **Scope under test**: 6.0 Schema & Separation Gate only — schema, hand-written DDL,
  separation guards (5 layers), PDPA controls, test infrastructure. No commerce
  endpoints exist yet (6A builds those); no HTTP/API testing was in scope.
- **Environment**: Docker Compose demo stack (`postgres:16-alpine` via
  `content-hub-postgres-1`), backend run **outside** the container against
  `DATABASE_URL=postgresql://content_hub:content_hub@localhost:5432/content_hub`
  (same physical Postgres the compose backend container uses).
- **Verdict: SIGNED OFF — ready for DevOps.** Zero Critical/High bugs found.
  Every developer claim checked in the brief was independently reproduced
  against the live database or a genuine test-red/test-green cycle. Three
  Low-severity findings and two dev-environment observations are recorded
  below; none blocks the 6.0 gate.

---

## 1. Test execution summary

| Layer | Method | Result |
|---|---|---|
| Migration status | `npx prisma migrate status` | "Database schema is up to date!" — 10 migrations, `20260721000000_phase6_commerce` applied |
| Unit suite | `npx jest` | **457/457 passed, 44 suites**, 16.8–21.2s (claim was "~100s"; see OBS-1) |
| Separation specs (subset of the above) | `npx jest src/testing/separation` | **27/27 passed**, 4 suites — genuinely collected under `rootDir: 'src'` |
| Real-DB e2e suite | `npm run test:e2e` (`jest.e2e.config.js`, live Postgres) | **14/14 passed**, 1 suite, ~5.6–6.3s |
| TypeScript | `npx tsc --noEmit -p tsconfig.json` | Clean, exit 0 |
| Lint | `npm run lint` (`--max-warnings 0`) | Clean, exit 0 |
| DB constraints | Direct `psql`, independent of Prisma/Jest | All 5 targeted constraints confirmed live (§2) |
| Guard fail-first reproduction | Break → observe red → restore → verify `git diff` clean | 3/3 independently reproduced (§3) |
| Byte-identity e2e | Read of `payout-unaffected-by-commerce.e2e-spec.ts` + live run | Confirmed real (real Postgres, seeds commerce, re-ranks, compares buffers) |
| Working tree integrity | `git status` / `git diff --stat` before vs. after | **Identical** — no residue from any probe |

No Critical or High severity bugs. Deployment-readiness criteria met.

---

## 2. DB constraints — verified live against Postgres, independent of the test suite

I did not rely on the developer's own jest e2e suite to certify these (though it also passes,
14/14 — see §1). I additionally ran raw `psql` transactions (`BEGIN … ROLLBACK`) directly
against the running Postgres container, bypassing Prisma and Jest entirely.

| Claim | Live psql result |
|---|---|
| A4 — `commerce_placements.note` > 200 chars rejected by DB CHECK | `ERROR: … violates check constraint "commerce_placements_note_len_chk"` — confirmed, 201-char value rejected |
| SA-9/C1 — `currency = 'thb'` rejected | `ERROR: … violates check constraint "commerce_conversions_currency_chk"` |
| SA-9/C1 — `currency = 'THBB'` rejected | `ERROR: value too long for type character(3)` (rejected at the column-type level before the CHECK even runs — still a hard rejection) |
| SA-9/C1 — `currency = ''` rejected | Blank-padded to `'   '` by `CHAR(3)`, then rejected by the regex CHECK |
| SA-9/C1 — `currency = 'THB'` (valid) accepted | Insert succeeds |
| SA-2/C2 — `reversal_of_id = id` rejected | `ERROR: … violates check constraint "commerce_conversions_no_self_reversal_chk"` |
| **Which tables are money-bearing** | Confirmed by `\d+` on all 5 tables: only `commerce_products` and `commerce_conversions` have a `currency` CHECK. `affiliate_links`, `product_anchors`, `commerce_placements` have no money column and correctly carry none. **The developer's claim of 2 tables is correct; the System Analyst's report text saying "three" is the one that is wrong** (the SA's own §6 already self-corrects this in the policy doc, and the migration matches the policy doc, not the older report prose). |
| Layer 1 — hand-written FKs are real, crossing into `posts`/`contents`/`content_assets`/`users` | `pg_constraint` introspection lists 18 foreign keys on the 5 commerce tables, including `product_anchors_post_id_fkey → posts`, `commerce_placements_content_id_fkey → contents`, `commerce_placements_source_asset_id_fkey → content_assets`, and 5 separate `*_created_by_fkey`/`*_recorded_by_fkey → users`. All are real Postgres FKs (`ON DELETE RESTRICT`/`SET NULL`). |
| Layer 1 — no Prisma relation crosses into `Post`/`Content`/`ContentAsset`/`User` | Inspected the **generated Prisma client's own `Prisma.dmmf`** (not schema.prisma text) via a one-off Node script: `Post`, `Content`, `ContentAsset`, `User` each list only their pre-existing Phase 1–5 relation fields — no commerce field anywhere. Confirms the client type graph genuinely has no edge, which is the property Layer 1 depends on. |

---

## 3. Guards independently broken and restored (fail-first proof)

Per the task's requirement to reproduce at least 3 of the developer's fail-first claims myself
rather than trust their assertion, I broke and restored the following three, in this order.
Each was confirmed **red on break**, then **reverted and confirmed green**, then confirmed by
`git diff --stat` that the working tree returned to byte-identical to its pre-probe state.

1. **CSV header freeze (Layer 5 / condition B5).** Appended `'commission_thb'` to
   `REVENUE_CSV_HEADERS` in `backend/src/modules/reports/report-export.service.ts`.
   `npx jest src/testing/separation/csv-header-freeze.spec.ts` went from 4/4 green to
   **2 failing** (`revenue.csv headers are frozen` and `no payout export header uses commerce
   vocabulary`, the latter correctly flagging the word `commission`). Reverted; re-ran green;
   `git diff --stat` on the file matched the pre-probe developer diff exactly (98 lines changed,
   same as before my edit).

2. **Static boundary scan (Layer 3).** First added the string `commerce_conversions` **inside a
   comment** in `dashboard.service.ts` — confirmed this correctly did **not** fail the scan
   (comment-stripping works as documented, ruling out the false-positive class G3c warned about).
   Then replaced it with a real code token: `private readonly qaProbeTableName =
   'commerce_conversions';`. `npx jest src/testing/separation/commerce-boundary.spec.ts` went red
   with the exact expected message: `src/modules/dashboard/dashboard.service.ts → commerce_conversions`.
   Reverted; `git diff backend/src/modules/dashboard/dashboard.service.ts` returned empty (file was
   never part of the developer's delivery, confirmed clean).

3. **Layer 1 — Prisma relation into `Post` (the most important guard).** Declared a real Prisma
   relation field on `CommerceConversion` (`qaProbePost Post? @relation(...)`) plus its mandatory
   back-relation on `Post` (`qaProbeCommerceConversions CommerceConversion[]`), then ran
   `npx prisma generate` to actually regenerate the client (a comment-only or schema-text change
   would not have exercised this guard, since the freeze test reads `Prisma.dmmf` off the
   generated client, not the `.prisma` source). `npx jest src/testing/separation/commerce-schema-freeze.spec.ts`
   went from 17/17 green to **3 failing**: `CommerceConversion declares no Prisma relation to
   Post…`, `Post gains no back-relation from any commerce model`, and `no payout-side model
   declares a relation to a commerce model at all` — all three pinpointing the exact injected
   field. Reverted schema.prisma and re-ran `npx prisma generate`; `git diff --stat
   backend/prisma/schema.prisma` returned to the original 308-line diff (302 insertions / 6
   deletions), identical to the pre-probe state; full unit suite (457/457) and e2e suite (14/14)
   re-confirmed green afterward.

All three guards are genuinely load-bearing tests, not decorative ones — none of them can be
silently defeated by adding an exception, and none produced a false positive on an innocuous
change (the comment case in #2 is direct proof of that).

---

## 4. Test collection / topology (condition B1, the SA's most important finding)

- `backend/jest.config.js` is `rootDir: 'src'`, and the 4 separation specs
  (`enum-freeze.spec.ts`, `commerce-schema-freeze.spec.ts`, `commerce-boundary.spec.ts`,
  `csv-header-freeze.spec.ts`) live at `src/testing/separation/*.spec.ts` — confirmed collected
  and run as part of the normal `npx jest` invocation (27 tests, counted in the 457 total, not a
  separate opt-in step).
- `backend/test/payout-unaffected-by-commerce.e2e-spec.ts` is correctly **outside** `rootDir:
  'src'` and named `*.e2e-spec.ts`, so it is invisible to the unit config on both counts (by
  design) and is instead picked up only by `jest.e2e.config.js` (`rootDir: '.'`,
  `testRegex: '\.e2e-spec\.ts$'`). Ran it directly: 14/14 passed against the live compose Postgres.
- The `*.spec.ts` exclusion the System Analyst flagged (G3b/B3) is gone: the boundary scan has no
  exemptions, and fixture helpers live in `src/testing/e2e/` and `src/testing/separation/`, both
  outside the four scanned module directories (`ranking`, `metrics`, `dashboard`, `reports`).
- CI (`.github/workflows/ci.yml`) now has a dedicated `separation-e2e` job against its own
  `content_hub_e2e` Postgres database, provisions and migrates it, then runs `npm run test:e2e` —
  matching condition B2 (its own work package, not a line item).

Condition B1 is closed: nothing here reports green by never having executed.

---

## 5. Byte-identity e2e (exit criterion #6)

Read `backend/test/payout-unaffected-by-commerce.e2e-spec.ts` in full and ran it live. It:
seeds a deterministic payout fixture, captures a baseline (`/dashboard/overview`,
`revenue.csv`, `override-log.csv`, `content/:id/revenue`, `ranking_scores`), seeds an
**adversarial** commerce fixture (commission >10x payout revenue, includes a negative reversal),
re-ranks **after** commerce exists, and asserts `Buffer.compare(...) === 0` / `.equals()` on
every artefact. All comparisons passed. It also asserts the fixture is non-trivial before
comparing (guards against the "empty fixture passes everything" failure mode) and that no byte
of `revenue.csv` contains commerce vocabulary even with commerce rows present in the DB. This is
a real proof, not a decorative one.

---

## 6. C7 — CSV formula-prefix / numeric-cell fix

`csv.util.ts`'s `escapeCsvField` now skips the formula-prefix guard for any value matching
`SAFE_NUMERIC` (`^-?\d+(\.\d+)?$`), so `-240.00` / `-5` / `-250` export as summable numeric text,
while `-1+1`, `=cmd`, and leading-tab/CR payloads are still defanged — verified in
`csv.util.spec.ts` (`escapeCsvField(-240)` → `'-240'`, not `'-240'` quote-prefixed). This is a
broader fix than the SA's literal suggestion (`typeof value === 'number'`) since it works on the
string representation regardless of whether the caller passes a JS number or a numeric string —
which is fine and arguably more robust, since no code path in the DTOs/adapters is fixed yet
(6A). Confirmed existing CSV output is unchanged: the only diff to `report-export.service.ts` is
a mechanical extraction of header arrays to named exported constants (`REVENUE_CSV_HEADERS`
etc.) with identical string content — no row-building logic touched, and `revenue_thb` values
are always non-negative so they were never affected by the old or new prefix rule.

---

## 7. Bugs / findings

No Critical or High severity bugs.

| ID | Severity | Category | Description | Status |
|---|---|---|---|---|
| P6-QA-1 | Low | Documentation | The System Analyst's report (`phase6-system-analysis.md` §3, SA-9) says currency CHECKs belong on "all three money-bearing tables," but there are only 2 (`commerce_products`, `commerce_conversions`). The developer's policy doc (§6) and the actual migration correctly implement 2 and explicitly call out the SA's error. No code defect — the SA report itself is stale on this one line and should be corrected for the record, not re-litigated. | Documented, not blocking |
| P6-QA-2 | Low | Test suite hygiene | `escapeCsvField`'s C7 fix is scoped to `csv.util.ts` only; there is no commerce exporter yet to exercise it end-to-end (correct — that's 6A.9 scope). Flagging only so 6A does not assume the unit test alone proves the future commerce CSV path; the future exporter must also pass amounts through this same function, not re-implement escaping. | Non-blocking, note for 6A |
| P6-QA-3 | Low | Schema note | `product_anchors_link_belongs_to_product_fkey` composite FK plus the `anchor_position` non-uniqueness were both checked as designed (§5 items 4 and 2.2 of the SA report) — confirmed present exactly as documented. No defect, listed for completeness of what was checked. | Confirmed as designed |

### Dev-environment observations (not scored as bugs; precedent: P2F-OBS-1, P3-OBS-1, P4-OBS-1)

- **P6-OBS-1 — Suite runtime.** Developer's claim was "~100s" for the full unit suite; actual
  measured runtime on this machine was 16.8–21.2s across two runs. Faster is not a problem, but
  flagging the discrepancy since the brief asked to check the specific number. Likely a
  difference in CI runner spec vs. local hardware, not a regression.
- **P6-OBS-2 — `npm run test:e2e` truncates the entire application database, including outside
  the tables it created.** `src/testing/e2e/e2e-database.ts`'s `resetDatabase()` runs `TRUNCATE
  TABLE … RESTART IDENTITY CASCADE` across 14 tables — every application table, not just the 5
  commerce ones — and this is by design (documented and safety-checked: it refuses to run unless
  `DATABASE_URL` host is `localhost`/`127.0.0.1`/`postgres`). Running it against the Docker
  Compose **demo** stack, as the task instructed, wiped the demo's seeded users/content/posts
  (verified: `users` and `contents` were empty immediately after my first `test:e2e` run). CI is
  unaffected — it correctly provisions its own throwaway `content_hub_e2e` database — but there
  is no equivalent warning in `README.md`/`SETUP-CHECKLIST.md` telling a developer running this
  locally against the compose stack that it will erase their demo data. I restored the demo stack
  afterward via `npm run prisma:seed` (which recreated the admin user and base policy rows, but
  not any manually-created contents/posts that existed before, since the seed script does not
  cover those). Recommend a one-line note in the developer-facing docs before 6A ships more local
  e2e usage.

---

## 8. Working tree integrity

Confirmed via `git status` and `git diff --stat` before any probe and again after all three
guard reproductions and the reseed: the tracked diff is **byte-identical** to the state at task
start (`10 files changed, 681 insertions(+), 56 deletions(-)`, same per-file line counts), and
the same set of untracked files remains untracked (plus `docs/phase6-qc-review.md`, which
appeared during this session from the parallel QC review and is not mine). No residue from any
probe.

---

## 9. Sign-off

**SIGNED OFF — ready for DevOps.**

All 8 items System Analyst §7 marked as "blocking 6.0 gate closure" were independently verified
live: B1 (test topology fixed and proven — separation specs genuinely collected, e2e suite
genuinely runs against Postgres), B2 (real-DB harness exists as its own CI job), A5 (retention
policy documented with a concrete, tested procedure), A1 (statement_ref pattern correct, no
space), A4 (200-char CHECK confirmed live), SA-9/C1 (currency CHECK confirmed live on the correct
2 tables), SA-2/C2 (self-reversal CHECK confirmed live), and B3/B4/B5/B6 (boundary scan has no
exemption, ESLint zones extended system-wide on both backend and — newly — frontend, CSV headers
frozen and tested). `tsc` and `lint` are clean. 457/457 unit tests and 14/14 e2e tests pass, and
I additionally reproduced 3 of the fail-first guard claims myself (CSV header freeze, boundary
scan, and the Layer 1 Prisma-relation guard) rather than trust the developer's assertion, in each
case observing genuine red-then-green.

# Phase 6.0 Quality Control Review — Schema & Separation Gate

**Reviewer**: Senior Quality Control (Loop position #5)
**Date**: 2026-07-20
**Branch**: `phase6.0-schema-separation-gate`
**Commits under review**: `f0f5705` (main delivery), `60931fb` (e2e truncation guard fix)
**Baseline**: `main`
**Verdict**: **APPROVED WITH CONDITIONS** (4 must-fix items, none blocking the 6.0 gate itself)

---

## 0. Scope and provenance

This document replaces the previous `docs/phase6-qc-review.md`, which was written
by the implementing developer agent in the same commit as the code it assessed
and carried a banner saying so. This is the first independent QC pass. It covers
only the QC deliverable — code review, standards, static analysis, version
control. It does not record a QA, DevOps, or Bug-Fixer verdict; a QA agent is
running independently and speaks for itself.

### Verification performed

| Check | Command | Result |
|---|---|---|
| Backend lint | `npm run lint` (`--max-warnings 0`) | clean |
| Backend typecheck | `npx tsc --noEmit` | clean |
| Backend unit suite | `npx jest` | **467 passed / 45 suites** |
| Separation + commerce + CSV subset | `npx jest src/testing src/common/utils/csv.util.spec.ts src/modules/commerce` | 77 passed / 7 suites |
| Unit-suite collection | `npx jest --listTests` | all 4 separation specs + `e2e-database.spec.ts` collected |
| E2E collection | `npx jest --config jest.e2e.config.js --listTests` | `test/payout-unaffected-by-commerce.e2e-spec.ts` collected |
| Frontend lint | `npx eslint "src/**/*.{ts,tsx}" --max-warnings 0` | clean |

The e2e suite itself was not executed in this review (no disposable Postgres in
the review environment); it was read line by line instead, and one substantive
defect in it is recorded below as MAJOR-1.

---

## 1. Binding requirements — explicit yes/no

| # | Requirement | Met? | Evidence |
|---|---|---|---|
| 1 | `Platform` / `AssetPlatform` byte-unchanged | **YES** | `git diff main..HEAD -- backend/prisma/schema.prisma` touches only comment lines *above* each enum; both bodies are identical. Frozen by `enum-freeze.spec.ts:33-52`, which asserts against the generated Prisma client, not the schema text. |
| 2 | Layer 1 — no Prisma relation into `Post`/`Content`/`ContentAsset`/`User`; FKs hand-written | **YES** | `schema.prisma:595-866` — every cross-boundary column is a plain `String @db.Uuid`. No back-relation was added to `Post`, `Content`, `ContentAsset` or `User`. All 13 cross-namespace FKs are `ALTER TABLE` DDL at `migration.sql:243-300`. |
| 3 | NULL-safe Shopee duration CHECK + `reversal_of_id <> id` | **YES** | `migration.sql:353-358` uses the required `channel <> 'shopee' OR (duration_seconds IS NOT NULL AND duration_seconds BETWEEN 10 AND 60)`. Self-reversal check at `migration.sql:382-384`. Both have negative-insert coverage in the e2e spec. |
| 4 | Every separation test actually collected by a jest project | **YES** | Verified by `--listTests` on both configs (table above). The four static specs are inside `rootDir: 'src'` with `.spec.ts` names; `jest.e2e.config.js` is `rootDir: '.'` + `testRegex: '.*\.e2e-spec\.ts$'` and picks up `backend/test/`. The Analyst's G3a trap is genuinely closed. |
| 5 | CSV distinguishes negative number from formula | **YES** | `csv.util.ts:25` `SAFE_NUMERIC = /^-?\d+(\.\d+)?$/`, applied at line 65. `-250.00` passes through summable; `-1+1`, `-cmd\|/C calc`, `=cmd\|...`, `+66812345678` and leading tab/CR are all still prefixed. Injection tests retained and extended (`csv.util.spec.ts:18-52`). |
| 6 | `statementRef` pattern without space, enforced in the service | **PARTIAL** | Pattern is correct: `commerce.constants.ts:183` ships `/^[A-Za-z0-9][A-Za-z0-9._\-/]{0,63}$/` — anchored, no space, length-bounded in the pattern itself. **But no service enforcement exists, because no commerce service exists.** See MINOR-5. |
| 7 | `CommerceModule` registers its own `ThrottlerModule` | **NO** | **`commerce.module.ts` does not exist.** `find backend -iname "*commerce*"` returns only the constants file, its spec, the migration, and test fixtures. See MAJOR-2. |
| 8 | ESLint zones both directions, `report-export.service.ts` at file granularity, frontend not weakened | **YES** | `.eslintrc.cjs:64-153` — payout zone (9 path globs incl. `src/common/**`), symmetric commerce zone, `src/testing/**` explicitly neutral. `report-export.service.ts:88` restricted at file granularity, not the directory. Frontend `.eslintrc.json` → `.eslintrc.js` **preserves** `extends: 'next/core-web-vitals'` and adds bidirectional zones; frontend lint runs clean. Not weakened. |
| 9 | Boundary scan does not exclude `*.spec.ts`; helpers in `src/testing/` | **YES** | `source-scan.util.ts:34` `listTsFiles` has no exclusion parameter at all, by design. Fixtures live in `src/testing/`, a sibling of `src/modules/`, outside every scanned directory. Scan coverage is total *within the directories it scans* — see MAJOR-3 for which directories those are. |
| 10 | Migration additive-only; commerce revenue not in `metrics`; nothing in `modules/ranking/` reads commerce | **YES** | Migration contains no `DROP`, no `ALTER TYPE`, and no `ALTER TABLE` against any Phase 1–5 table except the additive nullable `content_assets.duration_seconds` (`migration.sql:74`). `grep -rniE "commerce\|affiliate\|shopee\|product_anchor"` across `ranking/ metrics/ dashboard/ reports/` returns exactly one hit — a comment in `report-export.service.ts:16`. |

**Score: 8 YES, 1 PARTIAL, 1 NO.**

---

## 2. Findings by severity

### CRITICAL — none

No finding in this delivery risks data loss, a security breach, or a payout
figure being wrong. The load-bearing control (requirement 2) is genuinely
structural, not conventional: I confirmed by reading the schema that there is no
relation field anywhere on the payout side pointing into commerce, so
`prisma.post.findMany({ include: { productAnchors: true } })` is not merely
discouraged — it does not type-check. That is the claim the phase rests on and
it holds.

---

### MAJOR-1 — the "with commerce rows present" e2e assertion inspects pre-commerce bytes

**File**: `backend/test/payout-unaffected-by-commerce.e2e-spec.ts:117-125`

The test is titled *"no payout CSV byte mentions commerce, even with commerce
rows present"* — but it asserts against `baseline.revenueCsv`, which is captured
in `beforeAll` (line 63) **before** `seedCommerceFixture` runs (line 91):

```ts
it('no payout CSV byte mentions commerce, even with commerce rows present', () => {
  const revenue = baseline.revenueCsv.toString('utf8');   // ← pre-commerce bytes
  for (const token of ['commission', 'shopee', 'affiliate', 'gross_sales', 'orders_count']) {
    expect(revenue.toLowerCase()).not.toContain(token);
  }
});
```

On a database with zero commerce rows, this assertion cannot fail for the reason
it exists. It is the same class of defect the Analyst flagged as G3a — a check
that reports green having never exercised its own claim — reappearing one layer
in. The byte-identity comparison at lines 109-114 does cover the with-commerce
state, so the separation itself is still proven; but *this specific test* is
decorative as written.

**Fix**: hoist the `after` capture to a `describe`-level variable and assert
against `after.revenueCsv`, or re-capture inside this test. One-line change; the
assertion then means what its title says.

---

### MAJOR-2 — `CommerceModule` was not delivered, so requirement 7 is unmet and untestable

**File**: `backend/src/modules/commerce/` (contains only `commerce.constants.ts` + spec)

The handoff describes "CommerceModule skeleton + constants" as delivered. Only
the constants shipped. There is no `commerce.module.ts`, and `app.module.ts`
contains no commerce reference.

This is not itself dangerous — 6.0 is a schema gate with no HTTP surface, so
there is nothing to throttle yet. What makes it a MAJOR rather than a MINOR is
that the codebase now carries a **forward-looking claim about a file that does
not exist**. `commerce.constants.ts:195-198` states:

> `Registered by CommerceModule's OWN ThrottlerModule — throttling is per-importing-module in this codebase, so it is NOT inherited from PublishModule.`

`COMMERCE_STEP_UP_TTL_MS` and `COMMERCE_STEP_UP_LIMIT` are exported and unused.
Nothing fails if 6A wires the commerce controller into an existing module and
inherits no throttler — the constants would simply sit there, and the per-module
throttling footgun this comment was written to prevent would fire exactly as the
comment predicts. This is the failure mode the Analyst's condition targeted.

**Fix (6A entry criterion, not 6.0)**: when `commerce.module.ts` lands it must
`ThrottlerModule.forRoot`/`forFeature` with these two constants, and a spec must
assert the module's `imports` contains a `ThrottlerModule` — the same shape as
whatever guards `publish.module.ts` today. Until then, record in the 6A plan
that requirement 7 is **carried forward unmet**, rather than closed.

---

### MAJOR-3 — the static boundary scan covers four directories; the ESLint zone covers nine

**Files**: `backend/src/testing/separation/commerce-boundary.spec.ts:45-50` vs `backend/.eslintrc.cjs:70-89`

The ESLint config makes an explicit, well-argued decision to be system-wide:

> *"The zones are SYSTEM-WIDE, not four directories. […] a shared helper in `common/utils/` importing both sides would have passed lint while breaking the same rule."* (`.eslintrc.cjs:56-62`)

Its payout zone accordingly covers `ranking`, `metrics`, `dashboard`,
`scheduler`, `content`, `queue`, `publish`, `common/**`, and
`reports/report-export.service.ts`.

The static scan did **not** follow suit. `PAYOUT_AND_RANKING_DIRS` is four
entries: `ranking`, `metrics`, `dashboard`, `reports`.

That leaves a real gap, and it is precisely the gap the scan was written to
close. Layer 2 (ESLint) sees *imports*. Layer 3 (the scan) sees *source text*,
because a physical table name inside a `$queryRaw` tagged template is not an
import and is invisible to ESLint. So a line like:

```ts
await this.prisma.$queryRaw`SELECT SUM(commission_amount) FROM commerce_conversions`;
```

placed in `src/modules/scheduler/`, `src/modules/content/`, `src/modules/queue/`,
`src/modules/publish/` or `src/common/` is caught by **neither** layer — not by
ESLint (no import), not by the scan (directory not walked). The scan's own
docblock argues that "a scan you can opt out of by renaming a file is not
evidence"; the same logic applies to opting out by choosing a directory.

**Fix**: extend `PAYOUT_AND_RANKING_DIRS` to match the ESLint payout zone.
`src/common` will need care — it is scanned for `COMMERCE_TOKENS` only, and
`src/testing/` is a sibling so it is not swept in. Expected to be a green change;
if it is not, the failure is a genuine finding.

---

### MINOR-1 — `resetDatabase` documents a guard it does not have

**File**: `backend/src/testing/e2e/e2e-database.ts:36-39, 151-154`

The `TRUNCATE_ORDER` docblock ends:

> *"If a future commerce table is added and not listed here, the fixture stops being deterministic; that is what the row-count assertion in `resetDatabase` guards."*

There is no row-count assertion in `resetDatabase`. It is three lines: build the
table list, `$executeRaw` the `TRUNCATE`, done. A future maintainer who adds a
commerce table and trusts this comment gets no warning at all — and because the
statement uses `CASCADE`, the new table *will* be emptied silently, so the
non-determinism the comment describes will not surface as a failure either.

**Fix**: either implement the assertion (post-truncate, assert every table in
`information_schema` matching `commerce_%` appears in `TRUNCATE_ORDER`), or
delete the sentence. A comment describing a guard that does not exist is worse
than no comment — it suppresses the check the reader would otherwise make.

---

### MINOR-2 — the e2e host check regexes the raw URL instead of the parsed hostname

**File**: `backend/src/testing/e2e/e2e-database.ts:110`

```ts
const isLocal = /@(localhost|127\.0\.0\.1|postgres):/.test(url);
```

The database-*name* check two lines later parses the URL properly via
`databaseNameOf()`. The host check does not — it substring-matches the raw
string. In a URL, userinfo runs to the **last** `@`, so a password containing
the literal text `@localhost:` satisfies this regex while the real host is
elsewhere:

```
postgresql://user:p%40localhost%3A@db.prod.example.com:5432/reporting_e2e
```

Two mitigations mean this is MINOR and not MAJOR: the database name must still
end in `e2e`, and the scenario needs an adversarially-constructed password that
no one types by accident. But the guard is inconsistent with itself — one half
parses, the other pattern-matches — and the parsing helper is already sitting
in the file.

**Fix**: `const { hostname } = new URL(url.replace(/^[a-z+]+:/i, 'http:'))` and
compare `hostname` against the allow-list exactly. Also removes the current
requirement that the URL carry both credentials and an explicit port for the
regex to match at all.

Separately, the guard is otherwise sound and the `60931fb` fix is the right one.
Checking the database **name** rather than the host is the correct instinct:
`/(^|_)e2e$/` is appropriately conservative (`content_hub_e2e` passes, `mye2e`
does not), the CI job provisions `POSTGRES_DB: content_hub_e2e` to match
(`ci.yml:138`), and the `ALLOW_E2E_TRUNCATE` escape hatch cannot reach a
non-local host because the host check runs first. The original host-only guard
really would have truncated the demo database, and it no longer does.

---

### MINOR-3 — the truncation guard sits on client construction, not on the destructive call

**File**: `backend/src/testing/e2e/e2e-database.ts:138-154`

`assertDisposableDatabase` runs inside `createE2eClient()`. `resetDatabase()`
accepts any `PrismaClient` and truncates unconditionally. Today the only caller
is the e2e spec, which does use `createE2eClient()` — so the guard holds. But
the dangerous function is exported and unguarded, and the safe path is a
convention.

**Fix**: call `assertDisposableDatabase(process.env.DATABASE_URL)` at the top of
`resetDatabase` as well. It is idempotent and cheap, and it puts the check on the
operation that does the damage rather than on the object that happens to
precede it.

---

### MINOR-4 — e2e spec has undeclared inter-test ordering dependencies

**File**: `backend/test/payout-unaffected-by-commerce.e2e-spec.ts:90, 138-213`

The CHECK-constraint tests (lines 143-213) depend on `seedCommerceFixture` having
run in the test at line 90 — e.g. the `product_anchors_one_target_chk` test at
line 204 references `COMMERCE_IDS.product`, which only exists after that seed. Run
in isolation (`-t`, `.only`, or any future `--randomize`), it fails with a foreign
key error instead of the CHECK violation it asserts, and the assertion passes for
the wrong reason — `rejects.toThrow(/product_anchors_one_target_chk/)` would fail,
but a less specific matcher would not have.

The current pattern is safe because Jest runs tests in declaration order within a
file and `maxWorkers: 1` is set. It is still an implicit contract.

**Fix**: move the commerce seed into a `beforeAll` for the constraint `describe`
block, or note the ordering requirement in a comment at the top of that block.

---

### MINOR-5 — `statementRef` format enforcement has no home yet

**File**: `backend/src/modules/commerce/commerce.constants.ts:183`

The pattern shipped is correct and the reasoning in its docblock is exactly
right — the design's `^[A-Za-z0-9._\-\/ ]+$` did include a space, "John Smith"
did pass it, and calling that a PII control was wrong. The delivered pattern
fixes it and is unit-tested (`commerce.constants.spec.ts`).

But the constant is currently referenced by nothing except its own test. The
docblock is candid about this ("NOT built in the 6.0 gate", deferring
`assertStatementRefShape` to 6A.7), which is why this is MINOR and why
requirement 6 is scored PARTIAL rather than NO. The risk is drift: a constant
with no call site is easy to leave behind when the service lands, and the DB
CHECK backstop is **length only** (`migration.sql:390-392`) — it does not enforce
the format. So until 6A.7 ships, a row written by any path can carry
`statement_ref = 'Somchai Prasert'` as long as it is ≤64 characters.

**Fix (6A entry criterion)**: export `assertStatementRefShape(value)` from the
commerce service and call it on both the HTTP and the adapter ingestion paths, as
the docblock specifies. Consider also adding the format as a DB CHECK — the
docblock argues a CHECK cannot produce a helpful 400, which is true, but it can
serve as the fail-closed backstop the same way the Shopee duration CHECK does
behind its service guard.

---

### MINOR-6 — self-reversal CHECK does not prevent two-row cycles

**File**: `backend/prisma/migrations/20260721000000_phase6_commerce/migration.sql:382-384`

`CHECK ("reversal_of_id" <> "id")` blocks `A → A` but not `A → B, B → A`. A
mutual-reversal pair is nonsense in an append-only ledger and would confuse any
future net-commission rollup.

Not fixable with a CHECK (it cannot see other rows), and arguably not worth a
trigger. Worth a service-level guard in 6A when the conversion write path exists:
reject if the target row already has a `reversal_of_id` pointing back. Recording
it here so it is a decision rather than an oversight.

---

### MINOR-7 — magic literal in an e2e assertion

**File**: `backend/test/payout-unaffected-by-commerce.e2e-spec.ts:87`

```ts
expect(baseline.overviewBytes.toString('utf8')).toContain('2296.5');
```

`PAYOUT_TOTAL_REVENUE_THB` is already exported from `payout-fixture.ts` and
imported into this file at line 47. Use it — otherwise a fixture change breaks
this line with an opaque failure, and the reader cannot tell whether `2296.5` is
the expected total or an arbitrary substring.

---

## 3. Code quality and repo conventions

**Standards compliance**: clean. Lint (`--max-warnings 0`), Prettier (via
`plugin:prettier/recommended`), and `tsc --noEmit` all pass. No `any`. No
`$queryRawUnsafe` (the repo-wide `no-restricted-syntax` ban holds; `resetDatabase`
correctly uses `$executeRaw` + `Prisma.raw` over a hardcoded constant list with
no external input).

**Commit hygiene**: both commits follow Conventional Commits
(`feat(backend):`, `fix(testing):`) with substantive bodies. No secrets in the
diff. `f0f5705` is large (~3,000 lines) but coherently scoped to one gate.

**Documentation quality**: unusually high, and I want to be specific about why
rather than just praising it. The comments in this delivery consistently explain
*why* and record the alternative that was rejected — `schema.prisma:595-624`,
`migration.sql:340-352`, `csv.util.ts:29-56`, `jest.e2e.config.js:4-32`,
`.eslintrc.cjs:118-123`. The `.eslintrc.cjs` note that `no-restricted-imports`
matches the specifier *string*, not the resolved path — so `**/modules/metrics/**`
would never fire on the relative `../metrics/metrics.service` that anyone
actually writes — is the kind of detail that makes a rule real instead of
theatrical, and it says it was verified by deliberately breaking it. That is the
right standard.

The `.eslintrc.json` → `.eslintrc.js` frontend swap is justified on exactly this
basis (JSON cannot hold the rationale) and I verified it weakened nothing: the
`next/core-web-vitals` extend is preserved verbatim and frontend lint runs clean.

**Where the documentation over-claims**: MINOR-1 (a guard described but not
implemented) and MAJOR-2 (a module described but not created) are the same
failure in two places — prose written in the voice of completed work, ahead of
the work. Given how much of this delivery's safety rests on its comments being
trustworthy, these are worth correcting promptly.

**Deliberate behaviour change to flag for release notes**: `escapeCsvField(-5)`
now returns `-5` where it previously returned `'-5`. The old test asserting the
old behaviour was correctly updated rather than deleted, and the reasoning is
documented. Payout revenue is never negative, so no existing export changes —
but this is a change to a shared utility used by all three payout CSVs, and it
should appear in `CHANGELOG.md` as such rather than only as a commerce detail.

---

## 4. Assessment: does the byte-identity harness actually prove exit criterion #6?

**Largely yes — the fixture is genuinely adversarial, not decorative.** Checking
the four properties that would make it vacuous:

| Property | Present? | Evidence |
|---|---|---|
| Same post/content ids as the payout fixture | **Yes** | `commerce-fixture.ts:102` placement on `PAYOUT_IDS.contentA`; `:106` `sourceAssetId: PAYOUT_IDS.assetA`; `:123` anchor on `PAYOUT_IDS.postBTiktok`; `:159,178,196` conversions attributed to real payout posts |
| Commission ≫ payout revenue | **Yes** | 48,000 THB gross vs 2,296.50 THB payout — >20×, asserted at spec line 77 |
| ≥1 negative reversal | **Yes** | `-4,500.00` with `reversalOfId` set (`commerce-fixture.ts:189-203`), asserted at spec line 78 |
| Re-rank between captures | **Yes** | `rankAllContent(prisma)` at spec line 105, *after* the commerce seed — the comment at 103-104 correctly identifies that ranking a clean DB proves nothing |

The harness also guards against its own vacuity in the two ways that matter: it
asserts the baseline is non-trivial (spec lines 81-88) and asserts the commerce
seed actually landed before comparing (lines 96-101). Comparison is on `Buffer`
bytes via `Buffer.compare`, not `toEqual` on objects, so a Decimal precision
change or a row reordering would be caught. Exactly one field is normalised
(`generatedAt`), narrowly and in one place.

**The one real gap, and it is disclosed rather than hidden**: `capture-baseline.ts`
calls the read services directly rather than going through HTTP. Its docblock
(lines 21-36) states this plainly, explains the scope reasoning, names what it
leaves open — a controller could inject a commerce service and merge a field —
and names the two controls standing in that gap meanwhile (the `dashboard/**`
ESLint zone and the frozen CSV headers). I agree with both the trade-off and the
decision to record it in the file rather than a commit message. It should be
closed in 6A.10 as stated.

Net: exit criterion #6 is proven at the aggregation-and-serialization layer,
which is where contamination would actually occur, with a disclosed gap at the
controller layer. Subject to MAJOR-1, which affects one auxiliary assertion and
not the byte-identity comparison itself.

---

## 5. Must-fix list (conditions of approval)

Ordered by when they must be done.

**Before this branch merges:**

1. **MAJOR-1** — `payout-unaffected-by-commerce.e2e-spec.ts:117-125`: assert
   against the post-seed capture, not `baseline`, so the test tests its title.
2. **MINOR-1** — `e2e-database.ts:36-39`: implement the row-count assertion or
   delete the sentence claiming it exists.

**Before 6A opens (carry forward as 6A entry criteria):**

3. **MAJOR-3** — extend `PAYOUT_AND_RANKING_DIRS` in `commerce-boundary.spec.ts`
   to match the ESLint payout zone, closing the raw-SQL-in-`scheduler`/`content`/
   `queue`/`publish`/`common` hole.
4. **MAJOR-2** — record requirement 7 as **unmet and carried forward**, not
   closed. When `commerce.module.ts` lands it must register its own
   `ThrottlerModule` using `COMMERCE_STEP_UP_TTL_MS` / `COMMERCE_STEP_UP_LIMIT`,
   with a spec asserting it. Likewise **MINOR-5**: `assertStatementRefShape` must
   exist in the service and be called on both the HTTP and adapter paths.

**Recommended, not blocking:** MINOR-2 (parse the hostname), MINOR-3 (guard
inside `resetDatabase`), MINOR-4 (ordering), MINOR-6 (reversal cycles),
MINOR-7 (magic literal), and a `CHANGELOG.md` entry for the `escapeCsvField`
behaviour change.

---

## 6. Verdict

### APPROVED WITH CONDITIONS

The load-bearing controls are real. Requirement 2 — the one the Analyst
identified as the difference between structural separation and a convention — is
implemented as specified: no Prisma relation crosses the boundary in either
direction, all 13 cross-namespace FKs are hand-written DDL, and the traversal
that would leak commerce revenue into a payout dashboard genuinely does not
type-check. Requirement 3's NULL-safety trap is avoided with the exact correct
form and has negative-insert coverage. Requirement 4's test-topology trap —
tests placed where jest would never collect them, reporting green having never
run — is closed, and I verified collection empirically on both configs rather
than trusting the config comments. Requirement 5's money bug is fixed with the
right boundary and the existing injection tests still pass.

The conditions are four items, none of which undermines those controls.
MAJOR-1 and MINOR-1 are small, local, and should be fixed on this branch.
MAJOR-2 and MAJOR-3 are scope-and-coverage gaps: one is work that was described
as delivered but was not (with no immediate risk, since there is no HTTP surface
to throttle yet), and one is a static scan that stopped four directories short of
the boundary its sibling ESLint config correctly draws system-wide. Both belong
in the 6A entry criteria rather than blocking the 6.0 gate.

The pattern worth naming for the team: this delivery's prose occasionally runs
ahead of its code — a guard described but not implemented, a module described but
not created. Given that so much of the separation's durability depends on the
next engineer trusting these comments, the comments need to be exactly as
accurate as the code. That is the main thing to tighten going into 6A.

**Handoff**: quality-approved for QA, subject to conditions 1 and 2 above being
closed on this branch. The QA agent's verdict is its own and is not recorded here.

---

*Reviewed by Senior Quality Control (Loop position #5), 2026-07-20. This document
must not be committed in the same commit as the code it reviews — see
`scripts/check-review-authorship.sh`.*

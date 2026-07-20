# Phase 6.0 — Commerce Schema & Separation Gate · Bug Fix & Feedback Report

- **Author**: Senior Bug Fixer, Loop Engineering Position #8 (feedback loop closer)
- **Date**: 2026-07-20
- **Iteration under review**: Phase 6.0, commit `f0f5705` — "feat(backend): Phase 6.0
  commerce schema & separation gate"
- **Inputs**: `docs/phase6-deployment-report.md` (DEPLOYED, demo/local),
  `docs/phase6-qa-report.md` (SIGNED OFF, zero Critical/High, 3 Low),
  `docs/phase6-qc-review.md` (APPROVED), `docs/phase6-system-analysis.md` (21
  conditions), `docs/phase6-project-plan.md`,
  `docs/phase6-commerce-pdpa-separation-policy.md`, `memory.md`, `errorlog.md`,
  `SETUP-CHECKLIST.md`
- **Environment caveat, stated once and honoured throughout**: this is a **demo/local
  run**. There is no cloud production environment, no git remote, no APM, no error
  tracker, and no elapsed-time soak. The loop's demo exception applies: the pipeline
  evaluated immediately after deploy, so this report judges **delivered artifacts and
  verification evidence**, not production telemetry. The only observability surfaces
  available were `docker compose ps` / `docker compose logs`, and every number below
  comes from a command actually executed in this session.

---

## 1. Verdict

> ### ✅ **CONTINUE LOOP → next iteration builds Phase 6A (commerce backend).**

**Justification.** The 6.0 gate's own goal — land the commerce schema and prove
structurally that commerce money can never reach the payout/ranking stream — is
**fully met**: all 8 System-Analyst conditions that blocked 6.0 are closed and were
independently re-verified by QA against live Postgres, the migration is applied with no
drift, and 457/457 unit + 14/14 e2e tests were green before I touched anything. But the
gate is by construction an *enabler*, not a deliverable: it ships **zero commerce
endpoints** (DevOps confirmed the live route table contains no `CommerceController`),
and the plan's ten 6A work packages plus 13 of the 21 SA conditions are explicitly
deferred to 6A/6B/6C. Terminating here would leave the phase's entire user-visible
value unbuilt behind a gate that exists precisely to unblock it — so the loop
continues, with a materially reduced risk surface after this iteration's fixes.

---

## 2. Bugs fixed this iteration

| ID | Severity | Layer | Root cause | Status |
|---|---|---|---|---|
| **BUG-P6-01** (DEVOPS-1 / QA P6-OBS-2) | **High** (process risk / data loss, already realised once) | Test infrastructure | Disposability guard validated only the URL *host*, never the database *name* | **FIXED + regression test** |
| **DEVOPS-2** | Low | CI config | Unverified whether the `separation-e2e` job needs a `redis` service | **RESOLVED — verified not needed, documented** |
| **P6-QA-1** | Low | Documentation | Stale "three money-bearing tables" claim in the SA report | **FIXED (doc corrected)** |

### 2.1 BUG-P6-01 — the e2e suite could truncate the persistent demo database

**Post-mortem.**

*Timeline.* Introduced in `f0f5705` (WP 6.0.8). Fired for real during QA: the first
`npm run test:e2e` run against the compose stack emptied `users` and `contents`
(P6-OBS-2); QA restored what the seed script covers via `npm run prisma:seed` — the
admin user and base policy rows — and permanently lost any manually-created
contents/posts, which the seed does not recreate. DevOps independently re-read the
source and escalated it to High (§4 of the deployment report) without a fix.

*Root cause — and why this is a root cause, not a symptom.*
`backend/src/testing/e2e/e2e-database.ts` `resetDatabase()` runs `TRUNCATE TABLE …
RESTART IDENTITY CASCADE` over **all 14 application tables** (`TRUNCATE_ORDER`), not
just the 5 commerce ones. The only thing standing between that statement and an
arbitrary database was:

```ts
const isLocal = /@(localhost|127\.0\.0\.1|postgres):/.test(url);
```

That is a **locality** test being asked to serve as a **disposability** test, and the
two are not the same predicate. The compose demo Postgres is reachable at exactly
`localhost` / `127.0.0.1` / `postgres` and its database is literally named
`content_hub` — so the guard admitted the persistent demo database on precisely the
same evidence it admitted a throwaway CI one. The file's own docblock stated the
correct intent — *"opt in by naming your database, not by remembering to be careful"* —
and the code did not implement it. Adding a `README` warning alone would have treated
the symptom (a human forgot) rather than the cause (the machine could not tell the two
databases apart).

*Fix (minimal, `backend/src/testing/e2e/e2e-database.ts`).* Kept the host check — it
still stops a staging or production URL pasted into `.env` — and added the check the
docblock always promised: the database **name** must match `/(^|_)e2e$/`, i.e. a name a
human deliberately created for this purpose (CI's `content_hub_e2e` already complies,
so **no CI change was required**). A deliberate escape hatch, `ALLOW_E2E_TRUNCATE=1`,
covers a differently-named disposable database; it bypasses the name check only, never
the host check. `assertDisposableDatabase` was exported and given an injectable `env`
parameter purely so it is unit-testable as a pure function — no behavioural change to
the production path. The error message names the offending database and states the
consequence in full.

*Regression test.* New `backend/src/testing/e2e/e2e-database.spec.ts` — **10 cases**,
deliberately placed in the **fast unit suite** (`rootDir: 'src'`), so the guard is
exercised on every `npx jest` run rather than only when someone runs `test:e2e`. It
touches no database. Cases: CI's `content_hub_e2e` accepted; bare `e2e` on the
`postgres` host accepted; **the compose demo `content_hub` refused** (the exact
P6-OBS-2 URL); `e2e_content_hub` refused (contains but does not end in `e2e` — pins the
regex anchor); pathless URL refused; non-local host refused *before* the name is
considered; missing `DATABASE_URL` refused; override accepted; `ALLOW_E2E_TRUNCATE=0`
**not** treated as consent; and the override proven unable to bypass the host check.

*Verification — both directions, run live, not asserted.*

| Check | Command | Result |
|---|---|---|
| Guard **refuses** the demo DB | `DATABASE_URL=…/content_hub npm run test:e2e` | **Refused**, all 14 tests error out with the new message *before* any statement runs |
| Demo DB **survived** that run | `psql -c 'select count(*) from users, contents'` | `users=1, contents=0` — **byte-identical to the pre-fix state**; nothing truncated |
| Suite **still passes** on a correct DB | `CREATE DATABASE content_hub_e2e` → `prisma migrate deploy` → `RANKING_ENGINE=v2 npm run test:e2e` | **14/14 passed**, 1 suite, 3.28s |

*Docs.* `README.md` §"Running tests" gained a `test:e2e` subsection with the exact
`CREATE DATABASE content_hub_e2e` → `migrate deploy` → `test:e2e` recipe, closing QA's
P6-OBS-2 documentation recommendation. (The stale "30 unit tests" line there was
corrected to describe the suite rather than a long-obsolete count.)

### 2.2 DEVOPS-2 — `separation-e2e` has no `redis` service

**Investigated rather than guessed, and the answer is that no redis is needed.** The
e2e suite never boots the Nest application. `backend/test/payout-unaffected-by-commerce
.e2e-spec.ts` imports no `AppModule` and calls no `Test.createTestingModule`;
`backend/src/testing/e2e/capture-baseline.ts` constructs the five services it exercises
by hand over a bare `PrismaClient` (`new RankingEngineV2Service(...)`, `new
RankingFactorsV2Service(...)`, `new AuditLogService(prisma)`, `new
DashboardService(prisma)`, `new ReportExportService(prisma)`). A grep across all five
classes plus `PrismaService` for `bull` / `ioredis` / `Redis` / `@InjectQueue` returns
nothing.

**Decision: do not add the service.** Adding an unused container would be cargo cult —
it would make the job slower and would encode a dependency that does not exist. Instead
the *finding* was recorded where it will be seen: a comment block on the
`separation-e2e` job in `.github/workflows/ci.yml` states the evidence, and states the
condition under which the answer flips (if a future e2e spec ever imports `AppModule`,
add redis then, because the queue module does connect on boot). The same comment now
also pins `POSTGRES_DB` to a `*_e2e` name as a requirement of BUG-P6-01's guard.
Workflow re-parsed as valid YAML after the edit.

### 2.3 P6-QA-1 — "all three money-bearing tables"

`docs/phase6-system-analysis.md` asserted currency CHECKs on "all three money-bearing
tables" (§ SA-9 recommendation, and again in the §7 condition list). There are **two**:
`commerce_products` and `commerce_conversions`. `affiliate_links`, `product_anchors`
and `commerce_placements` carry no money column and correctly carry no CHECK. QA
(`\d+` on all five tables) and DevOps (independent re-run) each confirmed this live,
and the delivered migration matches the policy doc, not the report prose. Both
occurrences in the SA report now carry an inline dated correction rather than a silent
edit — the SA report is a signed artifact, so the record shows what was wrong and who
corrected it, and 6A cannot inherit the stale number.

---

## 3. Verification — full numbers, this session, post-fix

| Gate | Command | Baseline (QA) | Now | Δ |
|---|---|---|---|---|
| TypeScript | `npx tsc --noEmit -p tsconfig.json` | clean, exit 0 | **clean, exit 0** | — |
| Lint | `npm run lint` (`--max-warnings 0`) | clean, exit 0 | **clean, exit 0** | — |
| Unit suite | `npx jest` | 457/457, 44 suites | **467/467, 45 suites**, 12.7s | **+10 tests, +1 suite** |
| Real-DB e2e | `npm run test:e2e` against `content_hub_e2e` | 14/14, 1 suite | **14/14, 1 suite**, 3.28s | — |
| Guard negative case | `npm run test:e2e` against `content_hub` | *(silently truncated)* | **refuses, DB intact** | fixed |
| CI workflow | YAML parse after edit | — | **valid** | — |
| Compose stack | `docker compose ps` | 4 healthy | **4 healthy** (backend, frontend, postgres, redis) | — |

All +10 are the BUG-P6-01 regression suite. No existing test was modified, skipped, or
re-baselined; no production code path changed. The lone lint pass was
`eslint --fix` formatting on the two files I touched.

**Files changed this iteration** (4):

- `backend/src/testing/e2e/e2e-database.ts` — guard hardened, docblock corrected
- `backend/src/testing/e2e/e2e-database.spec.ts` — **new**, 10 regression cases
- `.github/workflows/ci.yml` — DEVOPS-2 finding documented on the `separation-e2e` job
- `README.md` — `test:e2e` throwaway-database procedure
- `docs/phase6-system-analysis.md` — P6-QA-1 correction (2 sites)

**Left as a real environment change**: the `content_hub_e2e` database now exists on the
compose Postgres. It is intentional and is what `README.md` instructs; it holds only
e2e fixtures and is safe to drop.

---

## 4. Risk assessment of the fixes themselves

Per the "if a fix is riskier than the risk it removes, carry it forward instead" rule,
each fix was weighed:

- **BUG-P6-01** — *proceeded.* The change is confined to test infrastructure; no
  application code imports `e2e-database.ts` (it lives under `src/testing/`, outside
  every scanned module directory, so it also cannot perturb the Layer 3 boundary scan).
  Its failure mode is fail-**closed**: a wrongly-refused run costs a developer one
  `CREATE DATABASE`, whereas a wrongly-admitted run costs data. CI needed no change
  because it was already compliant. Both directions were executed live.
- **DEVOPS-2** — *fix deliberately declined, finding documented instead.* Adding a
  redis service to satisfy a dependency that provably does not exist would have been a
  net negative. This is a resolution, not a deferral.
- **P6-QA-1** — documentation only, zero code risk.

Nothing was carried forward on risk grounds this iteration.

---

## 5. Remaining open items

### 5.1 Still open from this phase (none blocking)

| ID | Severity | Item |
|---|---|---|
| **P6-QA-2** | Low | 6A.9's commerce CSV exporter **must route amounts through the existing `escapeCsvField`** in `common/utils/csv.util.ts` (which carries the C7 `SAFE_NUMERIC` fix so `-240.00` exports summable) — it must **not** re-implement escaping. The C7 unit test alone does not prove the future commerce path. |
| **DEVOPS-3** | Informational | No `/api/health` HTTP endpoint exists anywhere in the app; Docker's healthcheck is a raw TCP-connect probe on 4000. **Pre-existing, not a 6.0 regression** — the `404 Cannot GET /api/health` is expected. Worth a real endpoint before any future cloud deploy; out of scope while demo/local. |
| **P6-QA-3** | Low | Not a defect — the composite `product_anchors_link_belongs_to_product_fkey` and `anchor_position` non-uniqueness were confirmed present exactly as designed. Recorded for completeness. |
| **P6-OBS-1** | Informational | Suite runtime was claimed "~100s", measured 12.7–21.2s. Faster than claimed; likely a CI-runner-vs-local hardware difference, not a regression. |
| **CI never executed** | Process | `.github/workflows/ci.yml` has **never run on a real runner** — no git remote is configured. Every CI claim in this phase is static review plus local execution of the same commands. This does not block a demo/local phase, but no one should describe these jobs as "passing in CI" until a remote exists. |

### 5.2 SA conditions gating 6A / 6B (not defects — planned work)

| Condition | Gates | Requirement |
|---|---|---|
| **A2** | 6A.7 | `assertStatementRefShape(value)` as an exported pure function called by **the service**; the DTO decorator is the redundant second layer, not the primary one |
| **A3** | 6A.1 / 6A.7 | Same sanitizer applied at the **adapter ingestion seam**, not only HTTP bodies; `commerce-adapter.contract.spec.ts` must reject an adapter returning `"Order #55123 — Somchai"` |
| **C3** | 6A | `CommerceModule` gets its **own `ThrottlerModule`** |
| **C4** | 6A.5 | Step-up **failure reason** must be surfaced/audited distinctly |
| **C5** | 6A.4 | Anchors **DTO shape** must be settled before 6B consumes it |
| **C6** | 6A.7 | Conversion **idempotency** semantics |
| **C7** | 6A.9 | Exporter **numerics** — see P6-QA-2; reuse `escapeCsvField` |
| **B7** | 6A.8 / 6B | `GET /api/commerce/summary/:contentId` **ships but is not rendered** on `/dashboard/revenue/[contentId]`; surface it on placement/post detail only — SA's ruling, and it is a separation ruling, not a layout preference |

### 5.3 Project-level carry-forward (unchanged, pre-dates Phase 6)

Cron auto-sync (deferred Phase 3.5 bundle; Sync is a manual button today) ·
401-log-noise WARN downgrade · Meta App Review submission (`docs/meta-app-review-status.md`)
· 5C live adapters + PDF export · 4C model-based sentiment · Meta Ads MCP server as a
**pre-production step** per `SETUP-CHECKLIST.md` §6.4 · QC-4B's 3 UX-minor findings ·
QA5B-OBS-1 (manual-external entry point only on `/scheduler`).

---

## 6. Systemic issues — feedback to the other agents

1. **To App Developer & QA — a guard's *predicate* must match its *promise*.**
   BUG-P6-01 is the whole lesson in one function: a well-written docblock said "opt in
   by naming your database", and the regex below it checked the hostname. The guard had
   no test, so the gap between comment and code was invisible until it destroyed data.
   **Any code path that runs `TRUNCATE`, `DROP`, `DELETE FROM` without a `WHERE`, or a
   bulk overwrite must ship with a test proving it *refuses* — the negative case is the
   test that matters.** This phase's separation guards were exemplary about fail-first
   proof (QA broke and restored three of them); the destructive helper that supports
   them received none of that scrutiny. Test infrastructure is production code for the
   developer's machine.
2. **To System Analyst — a numeric claim repeated across documents needs one source of
   truth.** "Three money-bearing tables" survived into the delivered SA report, was
   caught independently by two downstream agents (QA, DevOps), and was correct in the
   policy doc all along. The migration was right; only the prose was wrong. Prefer
   deriving such counts from the artifact (schema/migration) over restating them.
3. **To DevOps — the escalation worked, and that is the finding.** DEVOPS-1 was
   diagnosed precisely, quoted at source, and given a concrete patch sketch rather than
   a vague warning; this report implemented essentially that design. Conversely
   DEVOPS-2 was correctly flagged as *unverified* rather than asserted — and turned out
   to need no change at all. Both are the right behaviour. Keep separating
   "I verified X" from "X is unverified" this explicitly.
4. **To PM — the demo/local ceiling is now the binding constraint on evidence quality.**
   Three consecutive phases have been signed off with no CI runner, no remote, no soak
   window, and (until 5D) no visual QA. That is acceptable for a schema gate; it will
   not be acceptable for 6C or any production cut. Provisioning a git remote so
   `ci.yml` runs at least once is a small, high-leverage item.

---

## 7. Loop termination assessment

| Criterion | Status |
|---|---|
| Zero Critical bugs | ✅ |
| Zero High bugs | ✅ — the one High (DEVOPS-1) is **fixed and regression-tested** this iteration |
| All 6.0 acceptance criteria met | ✅ — all 8 blocking SA conditions closed and independently verified live |
| Performance meets NFR targets | ✅ (n/a for a schema gate; suite runtime well inside budget) |
| Security scan clean | ✅ — lint zones (backend + frontend), no `$executeRawUnsafe`, no PII columns, PDPA retention procedure documented |
| Test coverage thresholds | ✅ — 467/467 unit + 14/14 e2e, and QA broke/restored 3 guards to prove they are load-bearing |
| Deployment successful and stable 24h+ | ⚠️ **Not assessable** — demo/local, no soak window (loop's demo exception). Stack healthy at time of writing. |
| **Iteration goal fully delivered** | ⚠️ **The 6.0 gate is met; Phase 6 is not.** Zero commerce endpoints exist; 10 of 10 6A work packages and 13 of 21 SA conditions remain. |

**The last row is decisive.** Every quality criterion passes — this is a clean
iteration, not a rescued one. But the gate was built to unblock 6A, and 6A is entirely
unbuilt. Stopping now would ship a schema with no product on top of it.

> ## 🔁 **RECOMMENDATION: CONTINUE LOOP**
>
> **Next iteration = Phase 6A, backend only** (frontend 6B follows behind a frozen API
> contract, exactly as Phases 2, 4 and 5 sequenced it).
>
> **Build, in dependency order:** 6A.1 `CommerceModule` + `CommerceAdapterRegistry`
> (parallel to, *not* an extension of, `PlatformAdapterRegistry`) with mock Shopee /
> TikTok Shop adapters → 6A.6 best-effort MP4 `mvhd` duration capture (independent —
> start early; existing upload tests must pass unchanged) → 6A.2/6A.3 product catalog +
> affiliate links (soft-retire only, never hard-delete) → 6A.4 product anchors → 6A.5
> `POST /api/commerce/placements/manual-external` (AdminGuard + CSRF + step-up +
> copyright gate + 409 duplicate + 422 duration gate) → 6A.7 append-only conversions
> (no PATCH/DELETE route may exist) → 6A.8 commerce read model → 6A.9 commerce CSV as a
> **separate** report → **6A.10, the separation proof, which is the phase's definition
> of done, not a final checkbox.**
>
> **Gating conditions to satisfy while building:** **A2** and **A3** (statementRef
> shape enforced at the *service* and at the *adapter seam*, DTO decorator second),
> **C6** (conversion idempotency), **C4** (step-up failure reason), **C3**
> (`CommerceModule` owns its `ThrottlerModule`), **C5** (anchors DTO shape frozen
> before 6B), **C7** + **P6-QA-2** (exporter numerics — reuse `escapeCsvField`, do not
> re-implement), **B7** (ship `summary/:contentId`, do not render it beside a payout
> total).
>
> **Freeze the API contract at the end of 6A** — 6A.2 / 6A.4 / 6A.5 / 6A.7 / 6A.8
> shapes — before 6B starts, per the project plan's own sequencing rule.

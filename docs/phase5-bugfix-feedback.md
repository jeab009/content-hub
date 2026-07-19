# Phase 5 — Bug Fix & Feedback Report + Program Close-Out

- **Author**: Senior Bug Fixer (Loop Engineering, position #8 — feedback-loop closer)
- **Date**: 2026-07-19
- **Scope closed out**: Phase 5.0 gate + 5A backend + 5B frontend — **and the program**, Phase 5 being the final planned phase
- **Commit at close-out**: `8843be0` (was `b8d5d97` on entry; one fix applied this pass)
- **Inputs consumed**: `docs/phase5-project-plan.md`, `makedown.md` (§5 Phase 5, §9.5), `bussiness_rule.md`, `memory.md`, `errorlog.md`, `suggestion.md`, `docs/phase4-bugfix-feedback.md` (format precedent)
- **Demo/local run**: Docker Compose only. No cloud production, no real platform credentials, no elapsed-time monitoring. Per the loop's demo exception, evaluated immediately rather than over a 24h window.

---

## 0. Verdict

**One real bug found and fixed** (BUG-P5-01, Low, frontend rendering). **One genuine latent defect found and deliberately NOT fixed** (BUG-P5-02, Medium, ranking read path) — it gates flipping `RANKING_ENGINE=v2` and is documented below with a recommended fix.

The defining event of this pass: **browser tooling was available to me, and I used it to observe the running UI for the first time in the program's history.** Both the 4B and 5B QA passes substituted API-contract testing and source audit for visual verification. The very first page I looked at contained a rendering defect that had shipped in Phase 3B and survived three subsequent QA passes. That is the finding, more than the bug itself.

**Loop-control recommendation: ➤ CONTINUE LOOP** — one final, tightly-bounded consolidation iteration. See §6. This is *not* because Phase 5 scope is missing; it is because the phase's headline deliverable (ranking v2) ships disabled and cannot be safely enabled today.

---

## 1. Bug triage this iteration

| ID | Severity | Layer | Root cause | Disposition |
|----|----------|-------|-----------|-------------|
| **BUG-P5-01** | Low | Frontend (SVG render) | Fixed axis padding smaller than the labels it had to fit; labels clipped against the viewBox | **FIXED** this pass (§2) |
| **BUG-P5-02** | Medium | Backend (ranking read path) | `getLatestScores` aggregates latest-per-platform with no engine filter, so a v2→v1 rollback leaves stale v2 rows in the recommendation set | **NOT fixed — documented** (§3); gates the v2 flip |
| — | — | — | QC and QA both cleared 5A and 5B after the single 5B fix (`COMMENT_PLATFORMS`). No further code defects found. | Nothing else to fix |

I did not invent work. Beyond the two items above, my audit of the Phase 5 cross-layer contracts (export routes vs. api-client, revenue drill-down, manual-external path, platform-map, tie-break/scoring-set split, CSV cookie/SameSite posture) found the implementation sound and, in several places, unusually well-reasoned — the `RANKED_PLATFORMS` / `PLATFORM_TIE_BREAK_ORDER` / `RANKED_PLATFORMS_V2` split and the `toAssetPlatform` real-map fix are both correct and correctly commented.

---

## 2. Fix applied — BUG-P5-01 (revenue trend chart clipped its axis labels)

### Symptom
On `/dashboard`, the "Cumulative revenue" chart rendered its y-axis as **"HB 7.90" / "HB 3.95" / "HB 0.00"** — the leading "T" of every THB label sliced off — and truncated the right-most date label.

### Root cause
`TrendChart.tsx` hardcoded `PADDING = { left: 48, right: 12 }` against a `viewBox="0 0 640 200"` with `overflow: hidden`. Those are fixed guesses, but the y-axis labels come from `formatTHB`, whose width scales with revenue magnitude. Measured live in the browser:

| Label | Anchor | Drawn at | Actual extent | viewBox bound | Result |
|-------|--------|----------|---------------|---------------|--------|
| `THB 7.90` | `end` | x=42 | starts at **x = −5.8** | 0 | clipped left |
| `THB 3.95` | `end` | x=42 | starts at **x = −7.1** | 0 | clipped left |
| `THB 0.00` | `end` | x=42 | starts at **x = −7.2** | 0 | clipped left |
| `07-19` | `middle` | x=628 | ends at **x = 643.3** | 640 | clipped right |

This is not a "make the number bigger" bug: because `formatTHB` grows unbounded (`THB 1,234,567.89` is twice the width of `THB 7.90`), **any** fixed padding is wrong for some data. The root cause is that padding was a constant where it needed to be a function of content.

### Fix
New pure module `frontend/src/lib/trend-chart-layout.ts` derives the padding from the labels actually being drawn — `left` clears the widest y-label plus its gap, `right` clears half the final x-label. Floors preserve the original 48/12 insets so narrow-label charts are visually unchanged. Chart geometry is otherwise untouched; no API, schema, or backend change.

Logic went into `lib/` deliberately, matching the repo's existing convention (`publish-logic.ts`, `copyright-gate.ts`, `comment-logic.ts`): jsdom has no `getBBox`, so the invariant is only assertable if it lives outside the component.

### Verification (real output)
- `npx tsc --noEmit` → exit 0. `npx eslint src --max-warnings 0` → exit 0.
- Frontend jest: **78 → 88 passed** (5 suites). Backend unchanged and re-run: **378/378 passed** (35 suites).
- `next build` passes; all 11 routes build.
- **Observed in the browser after rebuilding the container**: labels render as full "THB 7.90" / "THB 3.95" / "THB 0.00" with an uncropped "07-19". Measured extents moved from `−7.2 / 643.3` to **`0.8 / 639.3`** — both inside the 0–640 viewBox.

### Regression test
`frontend/src/lib/trend-chart-layout.test.ts` — 10 cases under *"BUG-P5-01: trend chart axis labels must fit inside the viewBox"*, including the exact `THB 7.90` dataset that exposed it and magnitudes from zero to billions, plus a guard that the floors still hold for narrow labels.

### Honest note on how long this survived
The chart shipped in Phase 3B (`98f6cf1`) and was clipped from day one. Phase 3, 4, and 5 QA all passed over it. It was invisible to every verification method in use — API contract tests, source audit, jest, typecheck, lint — because none of them rasterize text.

---

## 3. Found but NOT fixed — BUG-P5-02 (mixed-engine recommendation set)

### The defect
`RankingEngineService.getLatestScores()` builds "latest row per platform" with **no engine-version filter**. v1 writes 2 rows (FB/YT); v2 writes 4. So if `RANKING_ENGINE` is ever rolled back v2 → v1, the `tiktok` and `line_oa` rows written by v2 are **never superseded** — v1 does not write those platforms — and they remain in the set that `pickRecommendedScore` compares.

### It is happening right now, in the demo DB

```
content 3033264c ("Comedy skit teaser"), latest score per platform:
  facebook = 0.4822 (v1)   <- current winner
  tiktok   = 0.4782 (v2)   <- 0.004 behind, computed by a different engine
  youtube  = 0.4583 (v1)
  line_oa  = 0.3823 (v2)
```

The scheduler renders all four side by side, and the publish modal's badge reads **"Engine v1 · 4 factors"** — while two of the four scores in the recommendation set were produced by v2's five-factor weight vector. A v1 score and a v2 score are not on the same scale; comparing them to pick a recommendation is apples-to-oranges, and here it is decided by 0.004.

### Why I did not fix it
The fix touches `getLatestScores` — the **single shared read path** that both the scheduler overview and the publish-time `was_override` recompute depend on. That path exists in its current form specifically to satisfy BUG-QA-003 ("scheduler and per-content recommendation must never disagree"), and risk R1 in the plan is precisely "ranking v2 regression flips recommendations." Changing it at close-out, after QC approval and QA sign-off, without a full QA re-run, would be exactly the reckless move the phase's own risk register warns against. This is a scope call, not an inability.

### Recommended fix (for the next iteration)
Filter the latest-score read to the **active** engine version, or have each recompute supersede all four platforms regardless of engine. Prefer the former — it keeps historical rows attributable, which is why `EngineVersion` exists. Either way it needs a QA pass covering the v1→v2→v1 round trip, which no test currently exercises.

**This is a hard gate on ever setting `RANKING_ENGINE=v2` in an environment that might roll back.**

---

## 4. Independent verification performed this pass

Everything below I ran or observed myself, not inherited from the QA report.

| Check | Result |
|-------|--------|
| Container health / restarts | 4/4 healthy, **RestartCount 0** on every one (re-confirmed after my rebuild) |
| `prisma migrate status` | "Database schema is up to date!" — 8 migrations |
| Backend suite | **378/378 passed**, 35 suites |
| Frontend suite | **88/88 passed**, 5 suites (78 before my fix) |
| Backend typecheck / lint | `tsc --noEmit` exit 0; `eslint --max-warnings 0` exit 0 |
| Frontend typecheck / lint / build | exit 0 / exit 0 / `next build` all 11 routes |
| HTTP 500s in backend logs | **0** |
| **Browser console errors across every page visited** | **0** — `/login`, `/dashboard`, `/scheduler`, `/posts`, `/comments`, `/dashboard/revenue/[contentId]` |
| v2 engine actually run on the stack | **Yes** — 48 persisted `engine_version=v2` rows across all 4 platforms (12 recomputes × 4). Not unit-test-only. |
| Manual-external path exercised | **Yes** — 8 posts with `publish_method=manual_external`, all with `external_post_id`, across tiktok/line/facebook/youtube |
| v2 reasoning payload | Well-formed: 5 factors, contributions sum to the persisted total (0.15+0.10+0.20+0+0.06 = 0.51 ✓), `override_feedback` carries raw counts + `lookbackDays`/`minSampleSize` |
| Neutral flag is real, not inferred | Confirmed independently: `engagement_history` carries `neutral: true` at sampleSize 0, while `override_feedback` at sampleSize 12 shows a **computed** 0.5 with no neutral flag — QA's finding reproduces |
| 4-platform UI | Scheduler renders FB 4/7, YT 2/3, **TikTok 4/14, LINE OA 2/3** — matches the admin-confirmed seed |
| QC5B-M1 fix confirmed visually | Comments platform filter offers **only Facebook and YouTube** — the reverted `COMMENT_PLATFORMS` is correct in the running UI |
| Manual-external modal | Renders correctly; DOM geometry confirms fixed full-viewport dimmed backdrop, dialog within bounds |

### What I could NOT verify
- **Any live platform integration.** Every adapter is `mock` (`PUBLISHER_IMPL_*=mock` confirmed in the running container). No content has ever been published to a real platform by this system, in any phase.
- **Authenticated click-driven flows end-to-end.** I authenticated and observed every page, but did not drive a full publish/record submission through the UI — the automation's synthetic clicks did not reliably trigger React's submit handlers, and I judged forcing it not worth the risk of writing junk state.
- **Performance / load.** Nothing measured. Dataset is a handful of rows; the known `latest-per-post` JS aggregation and the `cadenceOverview` N+1 (QC-M1, Phase 2) are untested at scale.
- **24h stability.** Demo exception; and I recreated the containers myself mid-pass.

---

## 5. Phase 5 exit-criteria assessment

### 5.1 Against `makedown.md` §5 Phase 5 — "ครบ 4 platform, ranking แม่นขึ้นจาก real data, export report ใช้งานได้"

| # | Criterion | Evidence | Status |
|---|-----------|----------|--------|
| 1 | **ครบ 4 platform** | Registry resolves all 4; contract spec covers all 4; scheduler + publish UI show all 4; 8 manual-external posts across tiktok/line/fb/yt; cadence seeded 14/wk + 3/wk | **MET** — with the standing caveat that "publish" for TikTok/LINE means *record-what-you-posted-natively*, by explicit admin decision, and FB/YT publish is mock-only |
| 2 | **ranking แม่นขึ้นจาก real data** | v2 built, tested, and demonstrably run (48 rows). But it **defaults OFF** (`RANKING_ENGINE=v1` in the running container), the "real data" is synthetic/mock demo data, and BUG-P5-02 blocks safely flipping it | **PARTIAL — and the weakest claim in the phase** (see below) |
| 3 | **export report ใช้งานได้** | 3 CSV reports; routes match the client; admin+session guarded; audit on every export; QA byte-level PDPA test (18 values → 0 leaks); formula injection defanged; export button observed rendering | **MET for CSV.** PDF not delivered (deferred to 5C by plan) |

**On "ranking แม่นขึ้น" — what can and cannot honestly be claimed.**

*Can be claimed*: v2 is built, explainable, weight-verified, byte-frozen against v1, has a golden regression test, runs on all 4 platforms, and genuinely consumes accumulated override history — QA confirmed it can flip a recommendation for a pillar with real override history.

*Cannot be claimed*: that ranking is **more accurate**. Nothing has measured v2's recommendations against outcomes, because there are no outcomes — no real publishes, no real revenue, no real engagement. The "real data" v2 learns from is mock-adapter synthetic metrics and QA-generated override decisions. v2 ships **off**, so the system's live behavior today is still v1. Accuracy is an empirical claim and there is no experiment behind it. The correct statement is: *"v2 is a better-informed model that is ready to be evaluated,"* not *"ranking is more accurate."*

### 5.2 Against the plan's own §3.3 exit criteria

| # | Criterion | Status | Evidence / caveat |
|---|-----------|--------|-------------------|
| 1 | 4 platforms selectable; registry no longer throws; contract spec retargeted | **MET** | Verified in code and in the rendered UI |
| 2 | Manual external record, appears in `/posts`, metric + comment attach — verified live | **MET** | 8 such posts in the DB with external ids |
| 3 | v2 scores 4 platforms; 5-factor reasoning incl. `override_feedback` with raw counts; `engineVersion=v2` persisted; **UI renders v2 breakdown + engine badge** | **PARTIAL** | Backend fully met (48 rows, payload inspected). Engine badge confirmed rendering — but showing **v1**. The **v2 5-factor breakdown has still never been observed rendering**; I verified the v1 4-factor path only |
| 4 | Seeded override history demonstrably moves a v2 recommendation, explained in reasoning | **MET** | QA-verified; `override_feedback` input carries the full count set |
| 5 | v1 not regressed; byte-identical under `RANKING_ENGINE=v1`; tie-break unchanged | **MET** | 378/378 green; constants split correctly; FB/YT hold index 0/1 |
| 6 | Revenue drill-down + 3 CSV exports; zero raw author/text; audit row per export | **MET (CSV)** | Drill-down page observed rendering with correct empty states. PDF → 5C |
| 7 | Backend green (+45–65 over 285), lint/typecheck clean; frontend jest + `next build` | **MET, exceeded** | 378 (**+93**); 88 frontend; all toolchain exit 0 |
| 8 | System Analyst signs off export-PII + TikTok/LINE data handling | **MET (recorded)** | Policy locked at the 5.0 gate per plan; note this is a document sign-off, not an independent scan |
| 9 | Close-out records Ads revisit + TERMINATE/CONTINUE verdict | **MET** | This document, §6 and §7 |

### 5.3 The audit-trail gap (found this pass — affects criteria 2, 6, 8)

`AuditLogService` writes **structured JSON to stdout. There is no audit table** — the DB has 13 tables and none of them store audit entries. The service's own comment documents this as a deliberate Phase 1 scope call, with persistence deferred as "a Phase 2+ concern." That concern was never picked up, and we are now at the end of Phase 5.

**This is not theoretical. I proved the loss empirically:**

- All 8 `manual_external` posts were recorded between **12:30 and 15:32**.
- The backend container started at **15:42:04**.
- `docker compose logs backend` contains **zero audit lines** — total log volume 133 lines, none of them audit entries.
- The container log driver is `json-file` with **no rotation configured**.

Every `manual_external_post_recorded` audit entry for those 8 posts is gone, destroyed by a routine container recreate. (My own rebuild during this pass destroyed another window of them — the failure mode is that easy to trigger.)

**Why this matters more than it looks.** `bussiness_rule.md` justifies enforcing the copyright gate on the manual-external path specifically on audit-trail grounds — the gate cannot block a post that is already live, so its stated value is *"รักษา audit trail + legal-risk rule."* The audit trail is the entire rationale, and it is ephemeral stdout.

**Mitigating (and I want to be fair here):** the *business* provenance survives in the DB — `publish_method`, `external_post_id`, `external_post_url`, `was_override`, `override_reason` all persist, and `contents.copyright_cleared` shows the gate's current state. What is lost is the **who / when / from-where / result** record and the point-in-time proof that the gate was enforced. For a demo that is tolerable. For anything with legal exposure it is not.

---

## 6. Ads/Paid B-lite revisit (the Phase-5-exit decision)

### What was decided, and on what condition
2026-07-16: **B-lite** — keep Ads/Paid out of Content Hub through Phase 5, run ads directly in Meta Ads Manager / TikTok Ads, **collect real usage requirements meanwhile**, and re-decide when Phase 5 completed. `suggestion.md` was specific about the evidence to gather: log every manual ads run — content, platform, budget, result.

### What is actually known now
**Nothing was collected.** I searched the repository: every mention of ads across all documentation traces back to the 2026-07-16 decision documents themselves. There is no ads log, no requirements file, no captured workflow.

The reason is structural, not negligence: **Phase 1.5 through Phase 5 elapsed in roughly three days** (2026-07-16 → 2026-07-19) of agent build time. The B-lite decision implicitly assumed calendar months of real operation would pass during Phases 2–5. Instead the build outran the evidence-gathering it depended on. The system has never been operated for real — no live publishes, no real revenue, no ads campaigns to log.

**So the revisit's precondition is unmet. The decision cannot be made on evidence today, and pretending otherwise would just be re-guessing the same guess with more confidence.**

### Recommendation: ➤ **KEEP DEFERRED** — do not adopt as Phase 7 yet, do not drop

| Option | Assessment |
|--------|-----------|
| **Adopt as Phase 7 now** | **No.** The original rationale for B-lite — "requirement เป็นการเดา, build ก่อนใช้เสี่ยง build ผิด" — is *more* true now, not less. Scope is roughly a second Phase 2. It would also force `ads_management` scope, breaking the current Dev-Mode/no-App-Review posture (a concrete, immediate cost) and requiring a `metric` organic/paid split that touches the append-only model and both ranking engines. Paying that for zero requirements evidence is the exact mistake B-lite was designed to avoid. |
| **Drop permanently** | **No.** Nothing has been learned that argues against it. Dropping would discard a genuinely plausible extension on the basis of an experiment that was never run. |
| **Keep deferred, restart evidence collection against a real clock** | **Yes.** |

### Concrete recommendation to the admin
1. **Re-decide only after a defined period of genuine production use** — suggest **8 weeks of real operation** (real credentials, real posts, real payouts), not "when the next phase ends." Tie the trigger to usage, not to build milestones. That was the flaw in the original condition.
2. **Start the log now**, in the repo, one row per manual ads action: date, content, platform, objective, budget, spend, result, and — most important — *what you had to copy by hand between Ads Manager and Content Hub*. That last column is the actual ROI case for integration.
3. **Re-decide on a stated threshold**, not a feeling. Suggested: adopt only if (a) ads run ≥ weekly, **and** (b) manual cross-referencing between the two systems costs > ~2 h/week, **and** (c) at least one real decision was made worse by not seeing organic + paid together.
4. **Meanwhile keep the seam intact.** The current design already leaves room: `metric.source` distinguishes provenance, `PlatformAdapter` is a clean extension point, `ConnectedAccount` generalizes. Do not spend anything now to "prepare" for ads — that is speculative work of exactly the kind B-lite ruled out.

### Evidence still missing before this can be decided
- Ads cadence and spend in reality (unknown — never run).
- Whether the admin actually wants unified organic+paid ROI, or is content with two tools (never tested against real usage).
- Whether Meta would grant `ads_management` under this app's posture (never applied; App Review still outstanding).
- Whether paid signal would actually improve ranking — unanswerable while **organic** ranking accuracy is itself unmeasured (§5.1).

---

## 7. Program-level loop verdict

### Is the original goal met end-to-end?

`makedown.md`'s goal: *ยิง content หลาย platform + dashboard monitor user/revenue + เก็บ comment มาปรับปรุง content.*

| Goal | Built? | Works end-to-end for real? |
|------|--------|---------------------------|
| ยิง content หลาย platform | Yes — 4 platforms, ranking, publish authority, override, copyright gate, idempotency, audit | **No.** Every adapter is mock. Not one piece of content has ever reached a real platform through this system. |
| Dashboard monitor user/revenue | Yes — KPI, trend, per-platform/content, drill-down, CSV export | **Partially.** The UI works; the data is synthetic. Live FB/YT metric paths remain unverified. |
| เก็บ comment มาปรับปรุง content | Yes — inbox, Thai sentiment, priority, SLA, escalation, reply, retention/PDPA | **Partially.** Mock sync only; sentiment deliberately does not feed ranking; the "ปรับปรุง" loop is human-mediated by design. |

**The software is feature-complete against the plan. The entire external boundary is unverified** — and that is a known, deliberately accepted constraint (no credentials), not a defect. It is nonetheless the honest answer to "is it done end-to-end."

### Termination checklist

- ✅ Zero Critical bugs · ✅ Zero High bugs
- ✅ Test coverage: 378 backend + 88 frontend, all green
- ✅ Toolchain clean: typecheck, lint, build, migrations
- ✅ Deployment stable (demo): 4/4 healthy, 0 restarts, 0 HTTP 500s, 0 console errors
- ✅ Security/PDPA gates recorded clean across phases
- ⚠️ **Not all acceptance criteria met**: exit #3's UI half (v2 breakdown never observed rendering); "ranking แม่นขึ้น" unproven
- ❌ **One open Medium defect** (BUG-P5-02) blocking the phase's headline feature
- ❌ **Audit persistence gap** underpinning a stated business rule

### ➤ **CONTINUE LOOP**

**Rationale, in three sentences.** Phase 5 delivered its scope and passed QC/QA, but its centerpiece — ranking v2 — ships **disabled**, and the one defect I found this pass (BUG-P5-02) means it cannot be safely enabled or rolled back today; shipping a flagship feature nobody can turn on is not a finished phase. Separately, the first visual observation of the UI in the program's history immediately surfaced a defect that three QA passes missed, which tells me the substitute verification was not equivalent — one session of looking is not a QA pass, and the v2 reasoning panel specifically has still never been seen. Neither item is large, both are well-defined, and both are cheaper to fix now than after the system is trusted with real credentials.

**I want to be explicit about the alternative**: if the admin's intent is *"this is a demo, park it as-is,"* then **TERMINATE-with-conditions** is entirely defensible — nothing here is Critical or High, and the system is stable. My recommendation assumes the goal is a system that can eventually be pointed at real platforms. If it is not, say so and this becomes a stop.

### What the next iteration builds — Phase 5D (consolidation, small)

Strictly bounded. No new features.

1. **Fix BUG-P5-02** — engine-consistent latest-score reads, plus a QA pass over the v1→v2→v1 round trip. **Then flip `RANKING_ENGINE=v2`** and let QA verify exit criterion #3 live, including the 5-factor panel rendering.
2. **Visual QA pass over the whole UI, with browser tools, as a first-class deliverable** — every page, every modal, mobile/tablet/desktop widths, console clean. Not a substitute check. Treat BUG-P5-01 as evidence of what this finds.
3. **Persist the audit log** — a table (or a real sink) plus retention. Small, additive, and it is the stated justification for the copyright gate on the manual-external path.
4. **Close the two QA5B observations** — manual-external modal reachable from `/posts` (product-intent call for the admin), non-UUID `contentId` → 404 not 400.
5. **Do NOT build 5C.** See below.

**On 5C (live TikTok/LINE adapters + PDF).** Live adapters are the one item I would actively argue *against* building: without credentials the code cannot be verified, so building it produces unverifiable code that reads as capability — precisely the "unverifiable theater" the plan's own Decision 1 rejected. Build it when credentials exist, not before. PDF export is genuinely optional (CSV satisfies the criterion); leave it in the backlog.

---

## 8. Cross-agent feedback

| Target | Feedback |
|--------|----------|
| **Project Manager** | Phase 5 scope delivered; do not close the program yet — §7. The Ads B-lite revisit **could not be decided** because its evidence precondition was never met (§6): the build outran the calendar it assumed. Learning for future gates: **never condition a decision on evidence that accrues from real usage while the plan only advances build milestones** — tie it to a usage trigger with an owner. Schedule Phase 5D as a short consolidation, not a feature phase. |
| **App Designer** | The 4 cadence cards wrap 3+1 on desktop (LINE OA alone on row two) — with 4 platforms now permanent, a 4-up layout at `lg` would read better. Minor. More substantially: the manual-external modal is reachable only from `/scheduler`, not `/posts` (QA5B-OBS-1) — that is a product-intent decision that needs an actual answer, not a carry-forward. |
| **App Developer** | Strong pass — the `RANKED_PLATFORMS` double-duty catch and the `toAssetPlatform` cast→map fix were both real bugs caught before they shipped, and the comments explaining *why* are genuinely good. Two things to carry: (1) **BUG-P5-02** — the constants were correctly split for the *write* path, but the *read* path still merges engines; when you version a writer, check every reader that aggregates its output. (2) **BUG-P5-01** — a layout constant that must accommodate variable-width content is a function, not a constant. |
| **Quality Control** | The 5B `COMMENT_PLATFORMS` catch was excellent — a false claim in a comment ("every adapter now implements fetchComments") caught against actual adapter behavior; that is exactly the review that pays for itself. Gap to add to the checklist: **static review cannot see rendered output** — when a component computes geometry (SVG, canvas, absolute positioning), flag it for visual verification rather than approving on source alone. |
| **QA Tester** | Adversarial work on 5A was genuinely strong (4-way concurrency, SQL tampering at 3 layers, independent PDPA grep, formula injection). Two gaps: (1) **Browser-unavailable was treated as a substitutable constraint across two phases.** It is not — the first visual look found a 3-phase-old bug. When tooling is missing, the correct output is a **blocked** criterion, not a criterion met by other means. (2) No test covers the **engine round-trip** (v1→v2→v1), which is how BUG-P5-02 manifests. Add it before the v2 flip. |
| **DevOps** | Three items. (1) `PUBLISHER_IMPL_*` / `RANKING_ENGINE` are now properly documented in compose — R8 closed, good. (2) **Container logs are `json-file` with no rotation**: unbounded growth, and audit lines die on every recreate (proved in §5.3). Configure rotation and ship logs somewhere durable. (3) The **single `.env` source of truth** tech debt is still open and has now caused papercuts in three phases. |
| **System Analyst** | The **audit trail is stdout-only and ephemeral** (§5.3), while `bussiness_rule.md` rests the entire copyright-gate-on-manual-external decision on that trail existing. Please either re-affirm the rule with the trail's real durability documented, or require persistence before real use. Also worth revisiting: export accountability (`report_exported`) has the same ephemerality, which weakens the PDPA export-accountability story even though the redaction itself is solid. |

---

## 9. Recommended next steps for the admin, prioritized

### Before any real production use — treat as blocking

1. **Persist the audit log.** Currently stdout-only and destroyed on every container recreate (proved, §5.3). Multiple business rules and compliance claims depend on it.
2. **Fix BUG-P5-02, then decide the ranking engine.** Today the system runs v1 and v2 is off. Either enable v2 properly (after the fix + QA round-trip test) or state plainly that v1 is what ships — but do not leave a headline feature in an un-flippable state.
3. **Do a real visual QA pass.** The UI has been observed for roughly one session, by me, today. The first look found a bug. Do not assume the second look finds nothing.
4. **Connect real credentials and verify one live publish + one live metric sync per platform.** Every integration in this system is mock. This is the single largest unknown in the program, and no amount of further building reduces it.
5. **Complete Meta App Review prerequisites** (`docs/meta-app-review-status.md` — App ID / Business Manager ID). Dev Mode covers your own Page; anything beyond needs this.
6. **Configure log rotation and a durable log sink** before running anything long-lived.
7. **HTTPS + production cookie posture** — already a documented rule (`NODE_ENV=production` forces `Secure`); confirm at deploy time.

### Nice to have — real value, no urgency

8. **Cron auto-sync** for metrics + comments (Phase 3.5 bundle, needs the shared `getValidToken` system-context fix). Manual Sync buttons work; this is convenience until volume grows.
9. **PDF export** — CSV already satisfies the exit criterion.
10. **QC-4B UX minors** (template select reset, erase last-page edge, explicit pageSize) and QA5B-OBS-2 (non-UUID contentId → 404 not 400).
11. **Docs sync**: `TargetAgeSegment` enum vs `bussiness_rule.md` (QA-OBS-2); DB `UNIQUE` on `pillar_ratio_policies` / `platform_cadence_targets` (QA-OBS-1, app-layer only today).
12. **401-as-ERROR log noise** → WARN, once monitoring exists.
13. **Single `.env` source of truth** — recurring papercut across three phases.
14. **Start the ads usage log** (§6) if there is any chance of revisiting Ads/Paid.

### Explicitly recommended against

15. **Do not build 5C live adapters** until credentials exist — unverifiable code that reads as capability (§7).
16. **Do not adopt Ads/Paid as Phase 7** on current evidence (§6).

---

## 10. Post-mortem summary — BUG-P5-01

**Timeline.** Introduced Phase 3B (`98f6cf1`, 2026-07-18) — clipped from the first render. Survived Phase 3, 4, and 5 QA. Detected 2026-07-19 within roughly sixty seconds of the first browser screenshot ever taken of this application. Root-caused, fixed, tested, and visually verified the same session (`8843be0`).

**Impact.** Cosmetic. Currency labels on the primary revenue chart were unreadable ("HB 7.90"). No wrong numbers, no data loss — the KPI cards and the plotted line were always correct.

**What went well.** The moment visual tooling was available, the defect was found immediately and the root cause was shallow. The fix generalized (content-derived padding) rather than re-tuning a constant, so it is correct for magnitudes the demo has never seen.

**What went wrong.** Two consecutive phases accepted "browser tools unavailable" and substituted API-contract testing plus source audit. That substitution is excellent at finding logic bugs — it demonstrably found several — and structurally incapable of finding rendering bugs. The gap was documented honestly each time, but documented-and-proceeding gradually read as covered.

**Where we got lucky.** The bug was cosmetic. The same blind spot could equally have hidden an unclickable primary button, a modal that never opened, or a step-up password field that silently failed — all of which would have been Critical, and all equally invisible to every check that was running.

**Action items** are folded into §8 and §9 rather than duplicated here.

---

**Prepared by:** Senior Bug Fixer, Loop Engineering Position #8
**Date:** 2026-07-19
**Commit:** `8843be0`
**Recommendation:** ➤ **CONTINUE LOOP** — one bounded Phase 5D consolidation (fix BUG-P5-02 + flip or formally drop v2, real visual QA, persist audit log). **Ads/Paid: keep deferred**, evidence precondition unmet. Do not build 5C without credentials.

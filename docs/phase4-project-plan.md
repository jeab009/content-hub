# Phase 4 — Comment Aggregation · Project Plan

- **Author**: Senior Project Manager (Loop Engineering entry point)
- **Date**: 2026-07-19
- **Iteration input**: Admin fixed-requirement (self-hosted sentiment + full engagement scope) — see prompt of record
- **Depends on**: Phase 2 (posts + adapters + step-up/CSRF/audit), Phase 3 (append-only ingestion + Dashboard read-model). Can run in parallel with any Phase 3.5 defer work.
- **Downstream handoff**: App Designer (architecture + inbox UI/UX), then System Analyst (PDPA/retention/security sign-off gate).
- **Status doc alignment**: extends `makedown.md` §5 Phase 4, §9.5 phase table (row 4), §10 "Customer Engagement"; closes System Analyst condition "strip PII + retention 12 months + alert dedup" (gate Phase 4).

---

## 1. Project Charter

### 1.1 Objective
Build a unified, PDPA-compliant comment inbox that pulls comments from connected platforms (Facebook + YouTube this phase), tags each with sentiment via a **self-hosted, pluggable classifier** (comments never leave our infrastructure), and lets the admin triage and reply from one screen — with the same publish-grade authority controls (step-up + audited, never automatic).

### 1.2 Success statement
> Admin sees FB + YouTube comments in one inbox, each auto-tagged sentiment + priority; can filter by platform/sentiment/priority/SLA; can reply from the inbox on platforms whose API allows it (audited, PII-redacted); receives a **deduplicated** alert when negative-sentiment volume spikes; and no stored comment data breaches the 12-month retention policy.

### 1.3 Key decisions already fixed by admin (do not re-litigate)
| # | Decision | Consequence for this plan |
|---|----------|---------------------------|
| D1 | Self-hosted Thai sentiment classifier, in-process/in-container | **Sidesteps the third-party sentiment DPA gate** that blocked Phase 4 in §9.5. No vendor DPA needed. PDPA retention + PII-in-audit rules still apply. |
| D2 | Sentiment as a pluggable interface (mock/rule-based default, real model behind a flag) | Mirror the `PUBLISHER_IMPL_*` mock/live adapter pattern. Tests + demo run offline on the rule-based default; real model gated by env flag. |
| D3 | Scope = §5 Phase 4 + §10 Customer Engagement (a)–(g) | Seven capabilities, see §2.1. |
| D4 | PDPA retention = 12 months; author/text redacted in audit meta | System Analyst prior condition. Retention purge job + audit redaction are in-scope deliverables, not follow-ups. |

---

## 2. Scope

### 2.1 In scope (the seven capabilities)
| Ref | Capability | Notes |
|-----|-----------|-------|
| a | Pull comments from connected platforms into one store | FB + YouTube now (TikTok/LINE = Phase 5). Append-only ingestion, per-post failure isolation, dedup on `(platform, externalCommentId)`. |
| b | Sentiment tagging | Pluggable `SentimentClassifier` interface; rule-based Thai default (keyword/lexicon) shipped; real self-hosted model behind flag. Sentiment stored on the existing `Comment.sentiment` column. |
| c | Unified inbox UI + filter by platform/sentiment | Bootstrap 5 / Next.js App Router client page `/comments`, reusing api-client + CSRF pattern. |
| d | Reply from the inbox where the platform API allows | `replyComment` adapter (FB + YouTube). **Step-up re-auth + CSRF + audit**, never automatic — mirrors Publish Authority business rule. |
| e | Response SLA / priority tag (complaint / question / spam) | Rule-based triage classifier (separate from sentiment) → priority tag + SLA clock. |
| f | Escalation rule (negative-sentiment spike → alert) | Threshold over rolling window. **Alert dedup is mandatory** (System Analyst condition, gate Phase 3/4) — one alert per active spike window, not per comment. |
| g | Canned reply templates | CRUD, admin-owned; inserted into reply composer. Reply still requires step-up. |

### 2.2 Out of scope — explicit "not in this phase" boundaries
- **TikTok / LINE comment ingestion & reply** → Phase 5 (adapters stay stubs; contract test asserts stub-throws for those two).
- **Auto-reply / AI-generated reply / bulk auto-actions** → never; violates Publish Authority ("no auto-publish, admin confirms every send"). Reply is one-at-a-time, human-confirmed, step-up-gated.
- **Real self-hosted sentiment model *verification* on live traffic** → shipped behind a flag; mock/rule-based is the default and the only path exercised by CI/demo. Live-model accuracy validation is a flagged follow-up (mirrors "live metric paths not yet verified", Phase 3 §9.7 defer #3).
- **Cron/webhook auto-poll of comments** → Phase 4 ships **manual "Sync comments" button** (mirrors Phase 3 metric sync). BullMQ repeatable job deferred to the same Phase 3.5 cron bundle. Rationale: `getValidToken` is still `userId`-bound (Phase 3 §9.7 defer #1) — automated polling needs the same system-context fix; do it once, for metrics + comments together.
- **Audience sub-segment (23-30 / 31-45) analytics on comments** → still open in `suggestion.md`, not pulled in here.
- **Sentiment feeding back into the ranking engine** → Phase 5+ (ranking v2), not this phase.
- **Multi-language sentiment beyond Thai/EN fallthrough** → not in scope.

### 2.3 Exit criteria (Phase 4 DONE when all true)
1. FB + YouTube comments ingest into one store via manual Sync; re-sync is idempotent (no duplicate rows on `(platform, externalCommentId)`); one bad token isolates to its own post and never blanks the batch.
2. Every ingested comment carries a sentiment tag (rule-based default) and a priority tag (complaint/question/spam) with an SLA due timestamp.
3. `/comments` inbox renders all comments with working filters (platform, sentiment, priority, SLA breach) — verified live on the Docker stack.
4. Admin can reply to a FB + a YouTube comment from the inbox: step-up password enforced, CSRF enforced, audit row written, and **author + text redacted in the audit meta**.
5. A synthetic negative-sentiment spike produces exactly **one** alert per active window (dedup verified), not one per comment.
6. Canned templates CRUD works; a template can be inserted into a reply.
7. Retention purge removes comments older than 12 months (job unit-tested against seeded old rows; append-only history otherwise preserved).
8. Backend test suite green (target +40–55 tests over the 236 baseline), lint zero-warning, typecheck clean; frontend jest green, `next build` passes; adapter contract spec updated (FB/YT `fetchComments`/`replyComment` no longer throw; TikTok/LINE still throw).
9. System Analyst signs off PDPA (retention + audit redaction) — **compliance gate**, analogous to the Phase 1.5 gate.

---

## 3. Recommended sub-phase split

Following the established phase cadence (1.5 schema gate → 2A/2B → 3A/3B), Phase 4 splits into **one blocking gate + backend + frontend**, with the real sentiment model as a flagged tail:

| Sub-phase | Name | Blocking? | Rationale |
|-----------|------|-----------|-----------|
| **4.0** | Schema & Compliance Gate | **Yes — blocks 4A** | Mirror of Phase 1.5. Additive schema for comment enrichment + templates + alert-dedup ledger; audit action union additions; PII-redaction rule; retention policy locked with System Analyst. Cheap to get right now, expensive to retrofit (same lesson as `content.media_url`). |
| **4A** | Backend | after 4.0 | Ingestion, pluggable sentiment (mock default), triage/SLA, reply orchestration, escalation+dedup, templates CRUD, retention job. |
| **4B** | Frontend | after 4A API contract frozen | `/comments` inbox, filters, reply composer + templates, alert surface. |
| **4C** | Real sentiment model (flagged) | non-blocking tail | Wire the self-hosted model behind the flag; live-accuracy validation. Ships disabled by default; does not gate exit criteria 1–8. |

App Designer receives 4.0 + 4A/4B scope together to produce architecture + inbox UI before code starts.

---

## 4. Work Breakdown Structure (WBS)

Effort in T-shirt sizes (S/M/L) per the project's dependency-order convention (`bussiness_rule.md` Budget/Timeline — no calendar dates until UAT).

### Phase 4.0 — Schema & Compliance Gate  [gate]
| ID | Work package | Size | Acceptance criteria |
|----|--------------|------|---------------------|
| 4.0.1 | Amend `Comment` model additively: `externalCommentId` (dedup key), `priority` enum (`complaint`/`question`/`spam`/`general`), `slaDueAt`, `repliedAt`, `repliedBy`, `replyExternalId`, `sentimentSource` (`rule_based`/`model`, mirrors `MetricSource`). Add UNIQUE `(platform, externalCommentId)`. | M | Migration applies clean on real Postgres; additive-only (no rename of existing enums per the additive rule); existing `sentiment Sentiment?` reused. |
| 4.0.2 | New `CommentReplyTemplate` model (id, title, body, createdBy, timestamps). | S | CRUD-ready schema; admin-owned. |
| 4.0.3 | New `EscalationAlert` model with a dedup key (e.g. `(ruleKey, windowStart)` UNIQUE) — the alert-dedup ledger. | S | Satisfies System Analyst alert-dedup condition; UNIQUE prevents duplicate alerts at the DB layer, not just app layer (learns from QA-OBS-1). |
| 4.0.4 | Extend `AuditAction` union: `comment_sync_run`, `comment_reply_sent`, `comment_reply_failed`, `comment_escalation_raised`, `comment_retention_purged`, `comment_template_created/updated/deleted`. | S | Typed union compiles; each new mutating path has an action. |
| 4.0.5 | PII-redaction rule: extend `redactSensitive` (or a comment-specific redactor) so `author`/`text` are masked in audit `meta`. Unit test proves author/text never appear raw in an audit line. | M | Test asserts redaction; defense-in-depth alongside existing `redactSensitive`. |
| 4.0.6 | Retention policy doc: 12-month TTL, purge cadence, what "delete" means (hard-delete of comment rows; `onDelete: Restrict` on Post relation reviewed). Locked with System Analyst. | S | Signed policy in `docs/`; feeds 4A.7 and the compliance gate. |

**4.0 exit**: migration verified on real Postgres, seed idempotency verified, System Analyst approves retention + redaction design.

### Phase 4A — Backend
| ID | Work package | Size | Acceptance criteria |
|----|--------------|------|---------------------|
| 4A.1 | Implement `fetchComments(post)` on FB + YouTube adapters, mock/live gated via `PUBLISHER_IMPL_*` (mock = deterministic synthetic thread from post.id; live = FB Graph `/{post}/comments`, YouTube `commentThreads.list`). Update `platform-adapter.contract.spec` — FB/YT no longer throw; TikTok/LINE still throw. | L | Contract test green; mock deterministic; token check faithful in both modes (mirrors `fetchMetrics`). |
| 4A.2 | `CommentIngestionService.syncComments(userId)` — append-only insert, dedup on `(platform, externalCommentId)` (skip existing), **per-post failure isolation** (one stale token → that post reported skipped/failed, batch continues). Endpoint `POST /api/comments/sync`. Reuse `PlatformAdapterRegistry`, `getValidToken`, `API_CAPABLE_PLATFORMS`. | L | Re-sync inserts zero duplicates; isolation verified; audit `comment_sync_run`. Directly mirrors `MetricIngestionService`. |
| 4A.3 | `SentimentClassifier` pluggable interface + `RuleBasedThaiSentimentClassifier` default (Thai lexicon/keyword → positive/negative/neutral) + `ModelSentimentClassifier` stub behind flag. Applied during ingestion; writes `sentiment` + `sentimentSource`. | M | Interface swappable by env flag (mirrors adapter registry); default runs offline in tests. |
| 4A.4 | Triage classifier → `priority` (complaint/question/spam/general) + compute `slaDueAt` from a per-priority SLA table. Rule-based, transparent. | M | Deterministic tagging; SLA due timestamps correct per priority. |
| 4A.5 | Reply orchestration: `replyComment` on FB + YouTube adapters (mock/live gated) + `POST /api/comments/:id/reply`. **Step-up re-auth + CSRF + admin guard**; writes `repliedAt/repliedBy/replyExternalId`; audit `comment_reply_sent`/`_failed` with **PII redacted**. Never automatic. | L | 401 (wrong step-up) vs 403 (not admin) distinct; audit written & redacted; reply idempotency guard (no double-reply). |
| 4A.6 | Escalation rule + **alert dedup**: rolling-window negative-sentiment count over threshold → write one `EscalationAlert` per active window (UNIQUE dedup key), audit `comment_escalation_raised`. | M | Synthetic spike → exactly one alert per window; re-run does not duplicate. Closes System Analyst dedup condition. |
| 4A.7 | Retention purge: delete comments older than 12 months. Manual endpoint now; BullMQ repeatable job deferred to the Phase 3.5 cron bundle. Audit `comment_retention_purged` (counts only, no PII). | M | Seeded old rows purged; newer rows untouched; audit has no author/text. |
| 4A.8 | Templates CRUD: `GET/POST/PATCH/DELETE /api/comment-templates`, admin+CSRF. | S | CRUD works; audited. |
| 4A.9 | Inbox read API: `GET /api/comments` with filters (platform, sentiment, priority, sla-breach, replied) + pagination. Read-model style like DashboardModule. | M | Filters combine; pagination stable. |

### Phase 4B — Frontend
| ID | Work package | Size | Acceptance criteria |
|----|--------------|------|---------------------|
| 4B.1 | `/comments` inbox page (Next.js client component, Bootstrap 5): list, platform + sentiment + priority + SLA-breach filters, Sync-comments button. Reuse api-client + CSRF wrapper + labels/formatters. | L | Filters work live; sync triggers 4A.2; empty/loading/error states. |
| 4B.2 | Reply composer modal: step-up password field, canned-template picker (insert into body), mirrors `PublishConfirmModal` step-up UX. | M | Reply requires password; template insertion works; disabled on non-repliable platforms. |
| 4B.3 | SLA/priority badges + sentiment badge in row; alert surface for active escalations. | S | Badges render; SLA-breach visually distinct; alert count shown. |
| 4B.4 | Nav link + client-logic unit tests (filter/reply-enable logic), jest. | S | jest green; `next build` passes. |

### Phase 4C — Real sentiment model (flagged tail, non-blocking)
| ID | Work package | Size | Acceptance criteria |
|----|--------------|------|---------------------|
| 4C.1 | Package the self-hosted model in-container; implement `ModelSentimentClassifier`; enable via flag. | L | Runs in-process/in-container; comments never leave infra (D1); default stays rule-based. |
| 4C.2 | Accuracy validation vs a labelled Thai sample; document confusion matrix. | M | Documented accuracy; go/no-go for enabling in a later iteration. |

---

## 5. Dependency order (critical path)

```
4.0 (schema+compliance gate)  ──▶  4A  ──▶  4B
        │                            │
        │ (System Analyst sign-off)  ├─ 4A.1 fetchComments ─▶ 4A.2 ingestion ─▶ 4A.3 sentiment ─▶ 4A.4 triage/SLA
        │                            ├─ 4A.5 reply (needs 4.0 audit+step-up)
        │                            ├─ 4A.6 escalation+dedup (needs 4A.3 sentiment + 4A.2 ingestion)
        │                            ├─ 4A.7 retention (needs 4.0.6 policy)
        │                            └─ 4A.8/4A.9 templates + inbox read API
        ▼
  Compliance gate (PDPA) ──────────────────────────────────────▶ Phase 4 exit
                                                     4C (flagged, parallel/after, non-blocking)
```

- **Hard blocker**: 4.0 must complete (migration + retention policy + audit redaction) before any 4A code — reply and ingestion both write audit rows that must already be PII-safe.
- **API contract freeze**: 4A.9 (inbox read) + 4A.5 (reply) shapes must be frozen before 4B starts, exactly as Phase 2 froze the Post response contract for Pass C.
- 4A.1 is on the critical path (all of ingestion depends on it). 4A.8 (templates) can proceed in parallel.

---

## 6. Risk Register

Probability (P) × Impact (I), 1–5. Score = P×I. Owner in parentheses.

| ID | Risk | P | I | Score | Mitigation | Owner |
|----|------|---|---|-------|-----------|-------|
| R1 | **PDPA / retention non-compliance** — stored Thai comment text + author is personal data even self-hosted; missed purge or un-redacted audit = legal exposure. | 3 | 5 | 15 | 4.0 gate: 12-mo retention job + audit redaction as *shipped deliverables* (4A.7, 4.0.5), System Analyst sign-off as exit criterion #9. Retention purge unit-tested. | System Analyst |
| R2 | **Sentiment accuracy (Thai)** — rule-based default mis-tags; real model unproven on live traffic. | 4 | 3 | 12 | Pluggable interface (D2): ship rule-based default, keep model behind flag (4C), don't gate exit on live-model accuracy. Store `sentimentSource` so re-classification is auditable. Sentiment is advisory, never triggers an automatic action. | App Developer |
| R3 | **Platform reply-API limits** — YouTube allows top-level comment replies but not all comment types; FB reply permissions/visibility vary; some threads not replyable. | 4 | 3 | 12 | Adapter reports capability per-comment; UI disables reply where unsupported (like publish per-platform). `replyComment` fails cleanly + audited (mirror publish clean-fail). No silent failures. | App Designer / Developer |
| R4 | **Comment-poll rate limits** — FB Graph + YouTube quota; frequent full re-sync burns quota. | 3 | 3 | 9 | Manual sync only this phase (no cron); dedup means re-sync is cheap; incremental fetch by `collectedAt`/page token where API supports. Cron deferred until system-context token fix (shared with metrics). | App Developer |
| R5 | **Alert dedup regression** — spike fires one alert per comment → alert fatigue; violates System Analyst condition. | 3 | 4 | 12 | DB UNIQUE dedup key on `EscalationAlert` (not app-layer only — learns from QA-OBS-1); explicit exit-criterion test (#5). | App Developer / QA |
| R6 | **Reply authority bypass** — a reply path skips step-up/CSRF (Phase 2 had ready-gate bypass BUG-QA-002). | 2 | 5 | 10 | Reuse the exact publish step-up + CSRF guards; QA behavioral test for missing/empty/wrong password (Phase 2 caught bypasses only via behavioral testing, not static — run both). | QA |
| R7 | **Token staleness in dev** — recurring `APP_ENCRYPTION_KEY` drift blocked live paths in P2/P3. | 4 | 2 | 8 | Mock adapters are default and cover CI/demo; document re-connect step for live verification (known playbook from P2-OBS-1/P3-OBS-1). | DevOps |
| R8 | **Dedup key correctness** — platforms may reuse/format `externalCommentId` differently; wrong key → dup or dropped comments. | 3 | 3 | 9 | Namespace key by platform; contract test per adapter asserts stable external id; append-only means a miss is recoverable, not destructive. | App Developer |
| R9 | **Scope creep into auto-reply / bulk actions** — pressure to automate replies. | 2 | 4 | 8 | Boundary stated in §2.2; Publish Authority rule cited; every reply human-confirmed + step-up. | PM |

Top risks (R1, R2, R3, R5) all trace to fixed decisions or prior System Analyst conditions — none are new open questions; they are managed, not blocking.

---

## 7. Resource / agent allocation

| Deliverable | Primary agent | Support |
|-------------|--------------|---------|
| Architecture + inbox UI/UX + reply-capability model | App Designer | PM (scope constraints) |
| PDPA retention + audit-redaction + alert-dedup sign-off | System Analyst | PM (risk register) |
| 4.0 schema, 4A backend, 4B frontend, 4C model | App Developer | — |
| Coding-standard + tree-hygiene review | Quality Control | — |
| Behavioral tests (reply authority, dedup, isolation, retention) | QA Tester | — |
| Cron/system-context follow-up (deferred bundle) | DevOps | — |

---

## 8. Open decisions for downstream agents

1. **Reply-capability granularity** (App Designer): per-platform vs per-comment reply-enable — recommend per-comment (YouTube/FB both have non-replyable cases).
2. **SLA thresholds** (needs admin, can default): concrete hours per priority (e.g. complaint 4h / question 24h / spam none). Plan ships sensible defaults, admin confirms at UAT — same pattern as pillar-ratio/cadence provisional values.
3. **Escalation window + threshold** (System Analyst + admin): rolling window length and negative-count threshold for a spike. Default provisional, tune with real data.
4. **Retention "delete" semantics** (System Analyst): hard-delete vs anonymize-in-place. Plan assumes hard-delete of comment rows; confirm at 4.0 gate.
5. **Spam handling** (App Designer): does `spam` priority auto-hide from the default inbox view or just tag? Recommend tag + filter, no auto-action (consistent with no-auto-action boundary).

---

## 9. Consistency check against existing docs
- Adds to `makedown.md` §9.5 phase table row 4 — the PDPA blocker note changes: **third-party-vendor DPA no longer required** (D1 self-hosted); retention + redaction remain and are now scheduled deliverables (4.0.5/4.0.6/4A.7).
- Honors Publish Authority business rule (no auto-send; step-up on every reply).
- Reuses every Phase 2/3 pattern named in the iteration brief: append-only ingestion, per-post isolation, `PUBLISHER_IMPL_*` gating, admin+CSRF+step-up, central `AuditLogService` typed union, dual-enum bridge via `platform-map.util`, DashboardModule read-model style.
- Closes System Analyst conditions gated to Phase 4: PII strip + 12-month retention + **alert dedup**.
```

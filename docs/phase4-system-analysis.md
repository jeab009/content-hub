# Phase 4 — Comment Aggregation · System Analysis Report

- **Author**: Senior System Analyst (Loop Engineering, quality/security gate — stage #3)
- **Date**: 2026-07-19
- **Inputs reviewed**: `docs/phase4-architecture-design.md`, `docs/phase4-project-plan.md`, `docs/security-decisions.md`, `bussiness_rule.md`, `makedown.md` §9.5 (prior 9 analyst conditions) / §9.7, `errorlog.md` (QA-OBS-1, BUG-QA-001/002)
- **Source-of-truth services validated against**: `backend/src/modules/publish/step-up-auth.service.ts`, `backend/src/common/audit/audit-log.service.ts`, `backend/src/common/utils/redact.util.ts`, `backend/src/modules/connected-accounts/services/token-encryption.service.ts`
- **Assessment frames**: STRIDE, OWASP Top 10 (Web/API), Thai PDPA (B.E. 2562), ISO 25010

---

## 0. Verdict

**APPROVED WITH CONDITIONS.**

No blocking/critical flaw requires a redesign. The four proposed compliance controls (DB dedup, logging-only PII redaction, 12-month hard-delete retention, publish-grade step-up on reply) are architecturally sound and correctly reuse shipped Phase 2/3 primitives. **10 conditions** below gate the downstream sub-phases (4.0 / 4A.x / 4B) — they are additive controls and two are correctness fixes to *the way a control is built*, not a change to the architecture.

The single condition closest to blocking is **C1** — the proposed `redactSensitive` pattern additions (`'author'`, `'text'`) are **substring** matches and would both (a) over-redact the design's own `authorRef`/`textLength`/any `context*` field, defeating the audit, and (b) still must be proven to mask the raw fields. C1 must land inside the 4.0 gate before any 4A code writes an audit line.

---

## 1. Self-hosted in-process sentiment vs PDPA (challenged and confirmed, with residual duties)

**Confirmed:** in-process/in-container inference with **no egress** (design D1, C4 `Rel(api, sentiment, "in-process, no egress")`) genuinely removes the *third-party-vendor DPA* obligation that blocked Phase 4 in `makedown.md` §9.5. With no data processor/sub-processor and no cross-border transfer of the comment payload, there is no vendor DPA to sign. This is a correct reading.

**But the DPA gate ≠ the PDPA gate.** The data subject here is **the member of the public who commented** (a third party), not the admin. The following PDPA duties **REMAIN** and are only partially addressed:

| PDPA duty | Status in design | Gap → condition |
|---|---|---|
| **Lawful basis to collect/store author+text** | Implicit (public comments on the brand's own pages ⇒ legitimate interest / contractual-adjacent). Not documented. | Must record the basis + purpose. → **C10** |
| **Purpose limitation / minimization** | Good — stored fields serve triage/reply; sentiment is advisory only (ADR-P4-4, risk R2), no automated decision on the subject. | OK |
| **Storage limitation (retention)** | 12-month hard-delete on `collectedAt`. Addressed. | See §5 / C8 |
| **Data-subject rights — erasure/access (PDPA §30/§33)** | **No per-subject early-erasure path.** Only a bulk 12-month purge exists. A commenter's "delete my comment now" request cannot be honored in-app. | **C2** |
| **Special-category data (PDPA §26)** | Free public text can incidentally contain health/religion/political data. Not called out. | Note in C10; legitimate-interest storage of self-published public comments is defensible, but document it. |
| **Cross-border transfer if model weights come from abroad** | **Not a personal-data transfer.** Importing pre-trained *weights* is not exporting the data subject's data; inference is local. No PDPA §28 transfer occurs **provided** the container never phones home. | Confirm no telemetry/egress at build+run (supply-chain checksum on the weights blob). Folded into C10. |

Net: the DPA obstacle is genuinely gone; PDPA compliance is ~80% there. The one real compliance gap is **data-subject erasure (C2)**.

---

## 2. DB-enforced dedup — sufficiency, keying, races

**Comment dedup** — `(platform, external_comment_id)` PARTIAL UNIQUE `WHERE external_comment_id IS NOT NULL`, plus `createMany({ skipDuplicates: true })`. **Sound.** DB-enforced (race-proof at the engine, P2002 backstop), correctly namespaced by platform (closes R8), NULL-distinct handling correct for legacy rows. This faithfully mirrors the BUG-QA-001 `posts_content_platform_active_key` precedent and answers QA-OBS-1.

- **Hole (silent, real):** the partial index gives **zero** protection for any row where a LIVE adapter returns a null/empty `externalCommentId`. The mock always sets a stable id; live FB/YT edge responses may not. Every such comment re-inserts on each sync. → **C3** (contract test must assert non-null/non-empty external id for FB+YT live snapshots).
- **Observation (accepted):** append-only + dedup means an **edited** comment on-platform is never re-synced (dedup skips it), so stored text/sentiment can go stale. Consistent with the append-only model; acceptable, no action.

**Escalation-alert dedup** — `(rule_key, window_start)` UNIQUE, `windowStart` = floored bucket, P2002 → no-op. The dedup *mechanism* is **sound** and race-proof.

- **Semantic mismatch (needs pinning down):** the trigger **counts** negatives over a **rolling** window `[now-60m, now]` but **dedups** on a **floored hourly bucket**. A single sustained spike that crosses a bucket boundary (e.g. 13:55 → 14:05) maps to two different `windowStart` values and raises **two** alerts; conversely the intent "exactly one alert per active window" (plan exit #5) is only true *per clock-hour*, not per continuous spike. This is not a dedup failure — it is an unspecified cadence. → **C5** (reconcile counting window with bucket key; document the cadence as "≤1 alert per rule per hourly bucket" and confirm it meets the no-alert-fatigue intent; handle the boundary-straddle case).

No interleave hole exists in either DB dedup itself.

---

## 3. PII redaction — "logging-only, full text to admin"

**Acceptable and correct.** The admin is the authorized operator; returning `author`/`text` in the authenticated `GET /api/comments` response IS the legitimate business purpose. Redaction is rightly scoped to the **logging/audit/exception** surface (long-lived, shipped to aggregators, seen by ops) — ADR-P4-5 draws this line correctly.

Leak surfaces reviewed:

- **Exception filter / stack traces** (`RedactingExceptionFilter` → `redactSensitive`, security-decision #4): field-name-based; will NOT catch a serialized `Comment` unless the patterns are extended — the design proposes exactly that. **But the proposed additions are `String.includes` substrings** (`isSensitiveKey` uses `normalized.includes(pattern)`), which mis-fires:
  - `'author'` ⇒ also redacts **`authorRef`** (the hash the design intends to KEEP) and `authorExternalId`.
  - `'text'` ⇒ also redacts **`textLength`**, and any `context`/`contextId` (`"context".includes("text")` is true), `plainText`, etc.
  - Result: the audit meta the design carefully built (`authorRef` + `textLength`) gets `[REDACTED]`, making the trail useless — while a genuinely raw `author`/`text` field is only masked as a side effect. This is a **correctness defect in the control itself.** → **C1** (use exact-key matching for these comment fields, or names that cannot collide with `authorRef`/`textLength`/`context`; unit test must assert BOTH raw `author`/`text`/`replyText` are masked AND `authorRef`/`textLength` survive).
- **`comment_reply_failed` meta:** design says "reason only," but an FB/YT adapter error object can embed the submitted `message` (and quoted author). → **C7** (audit a mapped reason *code*, never the raw upstream error/exception object).
- **Sentiment classifier logs:** in-process, but any debug log of the text it classifies is a leak. → folded into **C6b** (classifier must not log raw text).
- **URL/query params:** clean — filters are enums/booleans, ids are path params, reply text is POST body. No PII in URLs. OK.
- **Escalation meta / retention meta:** counts only. OK.

---

## 4. Reply flow — step-up / CSRF / idempotency + the `assertFreshPassword` change

**Mirroring is correct.** Reply is the one platform *write*, with the same blast radius as publish; reusing the verbatim stack — step-up password-per-action, `CsrfGuard`, `AdminGuard`, `ThrottlerGuard @Throttle(STEP_UP_RATE_LIMIT)` (5/15min password-oracle cap), typed audit, and the claim-first `updateMany(where repliedAt=null)` optimistic-concurrency guard with dispatch-failure rollback — is the right posture (ADR-P4-2, closes R6). STRIDE: covers Spoofing (fresh auth), Tampering/EoP (admin+CSRF), Repudiation (audit), and the double-reply race (Tampering) via the DB-level claim.

**Parameterizing `StepUpAuthService.assertFreshPassword` — SAFE, with guardrails.** I read the service: the `action` value affects **only** the `action` field of the **failure** audit record. Adding a parameter that **defaults to `'publish_attempt_started'`** preserves the publish path byte-for-byte (existing caller passes nothing). Recommended path (a) is correct; path (b) double-audits and is rejected. Conditions on the change:
- The parameter MUST be typed `AuditAction` (not `string`) and defaulted — a typo must not create an un-alertable action.
- **Brute-force blind-spot risk:** today every step-up failure (publish + future reply) is discoverable under one action. Splitting to `comment_reply_failed` means any password-oracle/brute-force detection must aggregate on the shared `meta.reason='step_up_reauth_failed'` **across all actions** — otherwise reply becomes an unmonitored oracle (the 5/15min throttle still caps a single route, but cross-route aggregation is lost).
- The reply route's `@Throttle` MUST be behaviorally verified present (Phase 2 shipped guard-bypasses BUG-QA-002 that only *behavioral* tests caught).
→ **C4** (typed+defaulted param) and **C6a** (verify reply throttle + shared brute-force query).

---

## 5. Retention — hard-delete vs anonymize (given replies reference comment text)

**Hard-delete is the correct choice and satisfies PDPA storage-limitation better than anonymize.** Reasoning specific to this schema:
- `replyText`, `repliedBy`, `replyExternalId` live on the **same `Comment` row** as `author`/`text`. An admin's reply may itself quote the commenter's name/details, so `replyText` is *also* potentially personal data. Anonymize-in-place would have to reliably scrub free-text `replyText` too — harder to do safely than simply deleting the row. Hard-delete removes all of it at once.
- Accountability is not lost: the `comment_reply_sent` audit line (refs/counts, no body — once C1/C7 land) preserves "a reply was sent by X at T" beyond 12 months without retaining PII. So there is no reason to keep the row for audit purposes.
- Mechanically clean: `Comment.post onDelete: Restrict` restricts deleting a *Post*, not its comments; `repliedBy → User onDelete: SetNull`. `deleteMany({ collectedAt < now-12mo })` works.

Confirmations/conditions:
- Retention clock on `collectedAt` (platform timestamp) — correct as designed.
- **The manual purge endpoint is an irreversible mass-delete but is only `admin + CSRF`** — a weaker posture than the reply *write* it sits beside. A hijacked/CSRF'd session (or an over-eager script) could purge. Blast radius is bounded to already-expiring (>12mo) rows, so severity is medium, but a destructive endpoint should match the authority bar. → **C8** (add step-up to the manual purge endpoint, or restrict it to a non-web/system path; the deferred BullMQ cron runs in system context and is unaffected).
- Retention alone does not satisfy erasure (§1, **C2**).

---

## 6. Rate-limit / abuse — polling and reply

- **Reply:** throttled (5/15min) — good; verify present (**C6a**).
- **`POST /api/comments/sync`:** admin + CSRF but **no throttle noted.** Each sync is a full platform re-poll — dedup makes it cheap in the DB but NOT in **FB/YT API quota** (risk R4). Repeated/looped syncs can exhaust quota and get the app's platform access throttled or suspended (a Denial-of-Service on the integration). Concurrent syncs double the quota burn. → **C6c** (throttle `POST /api/comments/sync`; add an in-flight/min-interval guard so concurrent or hammered syncs don't stack quota; check whether `POST /api/metrics/sync` shares this gap and fix together).
- **`GET /api/comments`:** ensure `pageSize` is **capped** in the DTO (unbounded page size = query-DoS + large PII payload). → **C9**.
- **Reply DTO:** `message` must be `@IsNotEmpty` + `@MaxLength(N)` with N = platform comment limit; `forbidNonWhitelisted` on (good, keep). Template `body` likewise length-capped. → **C9**.

---

## 7. Conditions (gate the named sub-phase; not a redesign)

Severity: **[H]** high / **[M]** medium / **[L]** low.

| # | Sev | Condition | Gates |
|---|-----|-----------|-------|
| **C1** | **H** | Fix the redactor extension: match `author`/`text`/`replyText`/`authorExternalId`/`message` by **exact key** (or non-colliding names), NOT `includes()` substrings, so `authorRef`/`textLength`/`context*` are NOT clobbered. Unit test must assert (a) raw `author`/`text`/`replyText` are masked on both the log AND exception paths, and (b) `authorRef`/`textLength` survive intact. | **4.0.5** (blocks 4A) |
| **C2** | **H** | Add a PDPA data-subject **erasure** path: an audited, single-comment hard-delete the admin can invoke on request (or a documented, audited manual DB procedure for the single-admin MVP). Bulk 12-month purge does not satisfy §30/§33 on its own. | 4.0.6 / **4A.7** |
| **C3** | **H** | Adapter contract test must assert FB + YT live `CommentSnapshot.externalCommentId` is **non-null and non-empty** — the partial unique index provides zero dedup for null keys, so a null silently duplicates on every re-sync. | **4A.1** |
| **C4** | **M** | Parameterize `assertFreshPassword`'s failure action as a **typed `AuditAction` defaulted to `'publish_attempt_started'`** (publish path unchanged); reply passes `'comment_reply_failed'`. No free-string. | **4A.5** (touches shared `step-up-auth.service.ts`) |
| **C5** | **M** | Reconcile the escalation **rolling count window** with the **floored bucket dedup key**; document the guaranteed cadence (≤1 alert per rule per hourly bucket) and handle the boundary-straddle so a sustained spike neither double-alerts nor goes silent. | **4A.6** |
| **C6a** | **M** | Behaviorally verify the reply route's `@Throttle(STEP_UP_RATE_LIMIT)` fires; ensure step-up brute-force detection aggregates on `meta.reason='step_up_reauth_failed'` across BOTH `publish_attempt_started` and `comment_reply_failed` (no reply oracle blind spot). | **4A.5** |
| **C6b** | **L** | Sentiment classifier and triage must not log raw comment `text` at any level. | **4A.3** |
| **C6c** | **M** | Throttle `POST /api/comments/sync` and add an in-flight/min-interval guard (platform-quota DoS / R4); apply the same fix to `POST /api/metrics/sync` if it shares the gap. | **4A.2** |
| **C7** | **M** | `comment_reply_failed` must audit a **mapped reason code**, never the raw FB/YT error/exception object (can embed the submitted `message`/author). | **4A.5** |
| **C8** | **M** | Add **step-up** to the manual `POST /api/comments/retention/purge` (irreversible mass hard-delete) — match the authority bar of the reply write beside it. Deferred system-context BullMQ cron is exempt. | **4A.7** |
| **C9** | **L** | DTO hardening: cap `GET /api/comments` `pageSize`; `ReplyCommentDto.message` `@IsNotEmpty`+`@MaxLength`(platform limit); template `body` length-capped; keep `forbidNonWhitelisted`. | 4A.9 / 4A.5 / 4A.8 |
| **C10** | **L** | Document PDPA lawful basis (legitimate interest — customer-engagement on the brand's own pages) + purpose limitation for storing commenter author/text; note possible special-category content (§26); confirm the model weights blob is integrity-checked and the container has no egress at build+run (no §28 transfer). | 4.0.6 gate |

**Open items from the design's §12, resolved:** retention "delete" semantics = **hard-delete confirmed** (§5). Escalation window/threshold and SLA hours remain provisional/admin-tunable (acceptable PROVISIONAL pattern) — but the window↔bucket reconciliation (C5) is required regardless of the chosen numbers.

---

## 8. ISO 25010 note (quality attributes)

- **Security:** strong — reuses proven step-up/CSRF/audit/token-encryption; conditions close the residual logging + oracle + quota-DoS gaps.
- **Reliability/Maintainability:** high — every pattern mirrors a shipped module; DB-enforced idempotency makes re-sync/concurrent-sync safe by construction.
- **Performance:** add index-usage check for the inbox filter/sort (`@@index([platform, sentiment, priority, slaDueAt])` supports the default sort; the `slaBreach` computed clause is fine); cap pagination (C9).
- **Compliance (PDPA):** conditional-pass — C1/C2/C10 are the compliance-gate items.

**Gate result: APPROVED WITH CONDITIONS — 4.0 may proceed once C1, C2, C10 are folded into the 4.0 gate; C3–C9 gate their named 4A/4B work packages.**

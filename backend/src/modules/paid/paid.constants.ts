/**
 * Paid/Ads Visibility constants (Phase 7.0).
 *
 * This file is the single source of truth for the policy values the paid
 * feature (7A) will enforce. It ships in the 7.0 gate — before any endpoint
 * exists — so the policy is reviewed and frozen alongside the schema, not
 * invented later under feature pressure. Mirrors
 * `backend/src/modules/commerce/commerce.constants.ts` exactly in shape and
 * comment density, per docs/phase7-system-analyst-signoff.md conditions
 * P-A1, P-A4, SA-P4, SA-P6.
 *
 * Nothing here reads the payout/ranking or commerce streams; this module is
 * on the paid side of the three-way ESLint separation zone.
 */

/**
 * Currencies the v1 service accepts on write (System Analyst SA-P6).
 *
 * The `currency` columns and the DB `~ '^[A-Z]{3}$'` CHECK exist on both
 * money-bearing paid tables so the column never has to be added later
 * (expensive, irreversible). v1 REJECTS anything but THB in the service —
 * the admin's answer to the PM's OQ-4 (bussiness_rule.md, "Phase 7 OQ-4
 * answer (2026-07-21): currency = THB only") confirms THB-only for v1,
 * mirroring Commerce's COMMERCE_SUPPORTED_CURRENCIES exactly. Relaxing a
 * service guard later is free; adding a column later is not. When this list
 * grows, the paid summary must still GROUP BY currency and never emit a
 * scalar grand total (NFR-7.10, mirroring Commerce's NFR-6.12).
 */
export const PAID_SUPPORTED_CURRENCIES: readonly string[] = ['THB'];
export const PAID_DEFAULT_CURRENCY = 'THB';

/**
 * Retention position for paid (System Analyst condition P-A4 / §5.2 —
 * "the single most significant omission" in the design draft, restating
 * Phase 6's own A5 finding).
 *
 * Paid campaign and performance records are business/marketing-spend records
 * with a legitimate retention basis — an admin should be able to see "what we
 * spent last quarter" indefinitely, the same way payout and commerce history
 * persists. Paid is therefore neither the audit regime (permanent, anonymize
 * actor after 90d) as-is nor the comment regime (hard delete at 12 months).
 *
 * The PDPA erasure path is AUDIT'S "anonymize-in-place, keep-the-row" pattern
 * (mirroring AuditRetentionService.anonymizeExpiredActors and Commerce's own
 * COMMERCE_ERASABLE_FREE_TEXT_COLUMNS), applied to every unconstrained
 * free-text column capable of holding personal data. An admin erasure
 * request is satisfied by NULL-ing these columns on the named rows — the
 * campaign/performance-entry row survives, the free text does not. The
 * clearing procedure itself is a documented DB-level operator runbook in 7.0
 * (as Commerce's A5 accepted — a UI is not required this phase); the POLICY
 * and the column list are frozen here so "we have no way to comply with an
 * erasure request" is never the answer at a PDPA gate a second time.
 */
export const PAID_ERASABLE_FREE_TEXT_COLUMNS: readonly {
  table: string;
  column: string;
}[] = [
  { table: 'ad_campaigns', column: 'objective' },
  { table: 'ad_performance_entries', column: 'source_ref' },
];

/**
 * The complete, frozen column inventory of the two paid tables (System
 * Analyst NFR-7.5, PDPA column allow-list, mirroring Commerce's
 * COMMERCE_TABLE_COLUMNS / NFR-6.5 exactly). The separation test asserts the
 * live introspected columns deep-equal this. Any NEW column fails the test
 * until someone updates this array — which is the review moment the
 * no-audience-data rule needs. Stronger than a deny-list of
 * %audience%/%pixel% patterns because it also catches `segment_id`,
 * `recipient`, `custom_audience_ref` and everything nobody thought to ban.
 */
export const PAID_TABLE_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  ad_campaigns: [
    'id',
    'channel',
    'external_campaign_name',
    'external_campaign_id',
    'objective',
    'content_id',
    'start_date',
    'end_date',
    'planned_budget',
    'currency',
    'status',
    'is_active',
    'retired_at',
    'source',
    'created_by',
    'created_at',
    'updated_at',
  ],
  ad_performance_entries: [
    'id',
    'campaign_id',
    'spend',
    'reach',
    'impressions',
    'clicks',
    'result_type',
    'result_count',
    'currency',
    'period_start',
    'period_end',
    'source_ref',
    'corrects_entry_id',
    'source',
    'recorded_by',
    'created_at',
  ],
};

/** Free-text length caps (also enforced by DB CHECK in 7A, per design §1.5). */
export const PAID_OBJECTIVE_MAX_LENGTH = 100;
export const PAID_SOURCE_REF_MAX_LENGTH = 64;

/**
 * Format constraint on `ad_performance_entries.source_ref` (System Analyst
 * condition P-A1 / finding SA-P1, decided at the 7.0 gate).
 *
 * ⚠ THE DESIGN DRAFT'S QUOTED REGEX IS WRONG. `docs/phase7-architecture-
 * design.md` §1.5 states this pattern mirrors Commerce's shipped fix, and
 * quotes `^[A-Za-z0-9._\-\/ ]+$` — which is the exact PRE-FIX pattern
 * Commerce's own SA-1 already found defective and rejected, not the pattern
 * that actually shipped. THE CHARACTER CLASS CONTAINS A SPACE: with it
 * present, `John Smith`, `Somchai P` and `Ratchada Rd 42` all pass
 * validation, so a pasted Latin-script personal name is NOT blocked — the
 * opposite of the stated purpose. Do not copy that regex from the design
 * document.
 *
 * This is the CORRECTED pattern — copied verbatim in shape from
 * `COMMERCE_STATEMENT_REF_PATTERN`
 * (backend/src/modules/commerce/commerce.constants.ts):
 *
 *   - Anchored (`^…$`): an unanchored pattern would accept a trailing
 *     appended value by matching only the head or tail.
 *   - First character alphanumeric: stops leading punctuation and
 *     CSV-formula-shaped values (`=`, `+`, `-`, `@`).
 *   - NO SPACE in the character class — this is the whole point.
 *   - Length bounded IN THE PATTERN ITSELF (1 + 63 = 64), matching
 *     PAID_SOURCE_REF_MAX_LENGTH.
 *   - Digits accepted: `0812345678` is indistinguishable from a source
 *     reference id by regex. Accepted residual — this is precisely why the
 *     erasure procedure (PAID_ERASABLE_FREE_TEXT_COLUMNS above) exists.
 *
 * WHERE THIS MUST BE ENFORCED (condition P-A1, 7A.2 — NOT built in the 7.0
 * gate): in THE SERVICE, not only the DTO. The DTO decorator is the
 * redundant second layer, never the primary one — a future 7D live-sync path
 * would otherwise bypass class-validator exactly as
 * `ConversionSnapshot.statementRef` did in Commerce, since class-validator
 * decorators only ever run on HTTP request bodies.
 */
export const PAID_SOURCE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-\/]{0,63}$/;

/**
 * Performance-entry append idempotency window (§4.2 finding, System Analyst
 * sign-off), mirroring `COMMERCE_CONVERSION_IDEMPOTENCY_WINDOW_MS` exactly.
 * Required in 7A, not the 7.0 gate (there is no write path yet to apply it
 * to). A byte-identical payload from the SAME recordedBy within this window
 * must be rejected with 409, rather than silently accepted as a second row —
 * the append-only table has no PATCH/DELETE to correct a double-submit
 * otherwise.
 */
export const PAID_PERFORMANCE_ENTRY_IDEMPOTENCY_WINDOW_MS = 60 * 1000;

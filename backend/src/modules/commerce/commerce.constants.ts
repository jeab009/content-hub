/**
 * Commerce / Affiliate constants (Phase 6.0).
 *
 * This file is the single source of truth for the policy values the commerce
 * feature (6A/6B) will enforce. It ships in the 6.0 gate — before any endpoint
 * exists — so the policy is reviewed and frozen alongside the schema, not
 * invented later under feature pressure.
 *
 * Nothing here reads the payout/ranking stream; this module is on the commerce
 * side of the ESLint separation zone.
 */

/**
 * Currencies the v1 service accepts on write (System Analyst SA-9).
 *
 * The `currency` columns and the DB `~ '^[A-Z]{3}$'` CHECK exist on every
 * money-bearing table so the column never has to be added later (expensive,
 * irreversible). But v1 REJECTS anything but THB in the service, because no
 * non-THB statement is expected yet and a summary must never total across
 * currencies. Relaxing a service guard later is free; adding a column later is
 * not. When this list grows, the commerce summary must still GROUP BY currency
 * and never emit a scalar grand total.
 */
export const COMMERCE_SUPPORTED_CURRENCIES: readonly string[] = ['THB'];
export const COMMERCE_DEFAULT_CURRENCY = 'THB';

/**
 * Retention position for commerce (System Analyst condition A5/C7).
 *
 * Commerce rows are FINANCIAL RECORDS and are NEVER deleted — they have a
 * legitimate long-retention basis under Thai accounting practice, and the
 * append-only conversion ledger must not lose reversals. Commerce is therefore
 * neither the audit regime (permanent, anonymize actor after 90d) as-is nor the
 * comment regime (hard delete at 12 months).
 *
 * The PDPA erasure path is AUDIT'S "anonymize-in-place, keep the row" pattern
 * (mirroring AuditRetentionService.anonymizeExpiredActors) applied to the ONLY
 * two columns capable of holding personal data. An admin erasure request is
 * satisfied by NULL-ing these columns on the named rows — the financial row
 * survives, the free text does not. The clearing sweep job itself is 6A; the
 * POLICY and the column list are frozen here so "we have no way to comply with
 * an erasure request" can never be the answer at the PDPA gate.
 */
export const COMMERCE_ERASABLE_FREE_TEXT_COLUMNS: readonly {
  table: string;
  column: string;
}[] = [
  { table: 'commerce_conversions', column: 'statement_ref' },
  { table: 'commerce_placements', column: 'note' },
];

/**
 * The complete, frozen column inventory of the five commerce tables
 * (System Analyst NFR-6.5, PDPA column-name allow-list). The separation test
 * asserts the live introspected columns deep-equal this. Any NEW column fails
 * the test until someone updates this array — which is the review moment the
 * "no column capable of holding buyer data" rule needs. Stronger than a
 * deny-list of %buyer%/%order_id% patterns because it also catches
 * `customer_ref`, `recipient`, `contact` and everything nobody thought to ban.
 */
export const COMMERCE_TABLE_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  commerce_products: [
    'id',
    'channel',
    'external_product_id',
    'name',
    'sku',
    'product_url',
    'list_price',
    'currency',
    'commission_rate_pct',
    'is_active',
    'retired_at',
    'source',
    'created_by',
    'created_at',
    'updated_at',
  ],
  affiliate_links: [
    'id',
    'product_id',
    'url',
    'tracking_code',
    'sub_id',
    'is_active',
    'retired_at',
    'source',
    'created_by',
    'created_at',
    'updated_at',
  ],
  product_anchors: [
    'id',
    'post_id',
    'placement_id',
    'product_id',
    'affiliate_link_id',
    'anchor_position',
    'anchored_at',
    'removed_at',
    'source',
    'recorded_by',
    'created_at',
  ],
  commerce_placements: [
    'id',
    'content_id',
    'channel',
    'external_media_id',
    'external_url',
    'status',
    'publish_method',
    'source_asset_id',
    'media_url',
    'duration_seconds',
    'note',
    'version',
    'source',
    'recorded_by',
    'placed_at',
    'removed_at',
    'created_at',
    'updated_at',
  ],
  commerce_conversions: [
    'id',
    'channel',
    'period_start',
    'period_end',
    'orders_count',
    'items_sold',
    'gross_sales_amount',
    'commission_amount',
    'currency',
    'post_id',
    'placement_id',
    'product_id',
    'affiliate_link_id',
    'statement_ref',
    'reversal_of_id',
    'source',
    'recorded_by',
    'created_at',
  ],
};

/** Shopee video duration bounds (business rule; DB CHECK backs this up). */
export const SHOPEE_DURATION_MIN_SECONDS = 10;
export const SHOPEE_DURATION_MAX_SECONDS = 60;

/** Free-text length caps (also enforced by DB CHECK). */
export const COMMERCE_STATEMENT_REF_MAX_LENGTH = 64;
export const COMMERCE_PLACEMENT_NOTE_MAX_LENGTH = 200;

/**
 * Format constraint on `commerce_conversions.statement_ref`
 * (System Analyst condition A1, decided at the 6.0.6 policy gate).
 *
 * NOTE THE ABSENCE OF A SPACE. The design proposed
 * `/^[A-Za-z0-9._\-\/ ]+$/` and justified it as "a pasted name, address,
 * phone or email fails validation". It does not: the character class INCLUDES
 * a space, so `John Smith`, `Somchai P` and `Ratchada Rd 42` all pass. What it
 * actually blocked was Thai script, `@`, `+`, `(` and `,` — i.e. emails and
 * Thai-language names, but not Latin-script ones. That is a partial control
 * described as a complete one, and the System Analyst rejected it (A-i / SA-1).
 *
 * This pattern is anchored, length-bounded IN THE PATTERN ITSELF (1 + 63 = 64,
 * matching COMMERCE_STATEMENT_REF_MAX_LENGTH and the DB CHECK), and requires
 * an alphanumeric first character. Digits necessarily pass — `0812345678` is
 * indistinguishable from a statement id by regex — and that residual is
 * accepted and documented in the 6.0.6 policy doc, alongside the erasure
 * procedure that exists precisely because no regex closes it.
 *
 * WHERE THIS MUST BE ENFORCED (condition A2/A3, 6A.7 — NOT built in the 6.0
 * gate): in the SERVICE, via an exported `assertStatementRefShape(value)`, and
 * again at the adapter ingestion seam. The DTO decorator is the redundant
 * second layer, not the primary one: `ConversionSnapshot.statementRef` flows
 * from a future live adapter into the column through the service, and
 * class-validator decorators only ever run on HTTP request bodies. A control
 * that lives only on the DTO is absent from the exact path it was written to
 * guard.
 */
export const COMMERCE_STATEMENT_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,63}$/;

/**
 * How `product_anchors` with equal `anchor_position` order (Phase 6.0
 * decision, System Analyst §5.4). `anchor_position` is deliberately NOT unique
 * per target — a drag-reorder that swaps two positions would fight a unique
 * index. Ties break by `anchored_at` so the read order is still deterministic.
 * The read service must honour this ORDER BY.
 */
export const COMMERCE_ANCHOR_ORDER_TIE_BREAK = 'anchoredAt' as const;

/**
 * Password-carrying rate limit for the commerce placement step-up endpoint
 * (6A.5). Registered by CommerceModule's OWN ThrottlerModule — throttling is
 * per-importing-module in this codebase, so it is NOT inherited from
 * PublishModule. Matches the publish/comments budget: 5 attempts / 15 min.
 */
export const COMMERCE_STEP_UP_TTL_MS = 15 * 60 * 1000;
export const COMMERCE_STEP_UP_LIMIT = 5;

/**
 * Conversion idempotency window (6A.7, System Analyst condition C6). There
 * is no unique constraint or client-generated idempotency key on
 * `commerce_conversions` — the design's own R8 mitigation (a warn-only
 * period-overlap probe) catches "I entered week 29 twice on two different
 * days" but not the actually-likely trigger: a double-click or a client
 * retry submitting the IDENTICAL body twice within a second. Both rows would
 * land, the commerce total would inflate, and because the ledger is
 * append-only the only correction is a compensating negative row.
 *
 * The fix: a byte-identical payload from the SAME recordedBy within this
 * window is rejected with 409, rather than silently accepted as a second
 * row. Cheap, and it preserves the append-only model — no PATCH/DELETE is
 * added to fix a double-submit; the admin simply doesn't resubmit.
 */
export const COMMERCE_CONVERSION_IDEMPOTENCY_WINDOW_MS = 60 * 1000;

import type {
  AnchorItemInput,
  CommerceChannel,
  CommerceCurrencyTotal,
  CommerceSummary,
} from '@/lib/api-client';

/**
 * Pure decision helpers for the Commerce / Affiliate feature (Phase 6B). Kept
 * free of React/fetch so the branching (submit gating, duration/statementRef
 * validation, error categorisation, anchor selection, reversal detection) is
 * unit-testable in isolation — the same posture as publish-logic.ts /
 * comment-logic.ts.
 */

// --- Shopee duration gate (mirrors backend commerce.constants.ts /
// commerce-duration.ts EXACTLY — this is a courtesy layer only, never
// authority; the server re-validates unconditionally). ---

export const SHOPEE_DURATION_MIN_SECONDS = 10;
export const SHOPEE_DURATION_MAX_SECONDS = 60;

export type DurationHintKind = 'not-applicable' | 'missing' | 'out-of-range' | 'ok';

export interface DurationHint {
  kind: DurationHintKind;
  message: string | null;
}

/**
 * Courtesy, client-side duration hint for the placement record form. Only
 * `channel === 'shopee'` is gated — no other channel has a duration rule
 * today. Mirrors assertShopeeDuration's "null is a rejection" rule: an
 * absent/unparsed duration is reported the same as an out-of-range one, never
 * silently treated as fine.
 */
export function describeDurationHint(
  channel: CommerceChannel,
  durationSeconds: number | null,
): DurationHint {
  if (channel !== 'shopee') {
    return { kind: 'not-applicable', message: null };
  }
  if (durationSeconds === null || Number.isNaN(durationSeconds)) {
    return {
      kind: 'missing',
      message: `Shopee requires ${SHOPEE_DURATION_MIN_SECONDS}–${SHOPEE_DURATION_MAX_SECONDS} seconds. Unknown counts as a rejection — enter it by hand.`,
    };
  }
  if (durationSeconds < SHOPEE_DURATION_MIN_SECONDS || durationSeconds > SHOPEE_DURATION_MAX_SECONDS) {
    return {
      kind: 'out-of-range',
      message: `Shopee requires ${SHOPEE_DURATION_MIN_SECONDS}–${SHOPEE_DURATION_MAX_SECONDS} seconds; ${durationSeconds}s is outside that range.`,
    };
  }
  return {
    kind: 'ok',
    message: `${durationSeconds}s is within the ${SHOPEE_DURATION_MIN_SECONDS}–${SHOPEE_DURATION_MAX_SECONDS}s range.`,
  };
}

/** Whether the duration gate blocks a shopee submission (other channels always pass). */
export function isDurationBlocking(channel: CommerceChannel, durationSeconds: number | null): boolean {
  const hint = describeDurationHint(channel, durationSeconds);
  return hint.kind === 'missing' || hint.kind === 'out-of-range';
}

// --- statementRef shape (mirrors COMMERCE_STATEMENT_REF_PATTERN /
// COMMERCE_STATEMENT_REF_MAX_LENGTH in backend commerce.constants.ts EXACTLY
// — same anchored, length-bounded pattern, alphanumeric-first). ---

export const COMMERCE_STATEMENT_REF_MAX_LENGTH = 64;
export const COMMERCE_STATEMENT_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,63}$/;

/**
 * Blank is valid (the field is optional). Anything present must match the
 * server's pattern — letters/digits/`._-/` only, NO SPACE (the space is a
 * deliberate, documented residual gap upstream, see commerce.constants.ts —
 * this client copy exists so the admin sees the rule before the round-trip,
 * not so it is a weaker or different rule).
 */
export function isValidStatementRef(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return true;
  }
  if (trimmed.length > COMMERCE_STATEMENT_REF_MAX_LENGTH) {
    return false;
  }
  return COMMERCE_STATEMENT_REF_PATTERN.test(trimmed);
}

export const STATEMENT_REF_HELP_TEXT =
  'Business reference only — never buyer names, order ids, addresses, or contacts. ' +
  'Letters, digits, and . _ - / only (no spaces), up to 64 characters.';

// --- Product / affiliate link submit gating ---

export function canSubmitCommerceProduct(params: {
  channel: CommerceChannel | '';
  externalProductId: string;
  name: string;
}): boolean {
  return (
    params.channel !== '' &&
    params.externalProductId.trim().length > 0 &&
    params.name.trim().length > 0
  );
}

export function isValidHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function canSubmitAffiliateLink(url: string): boolean {
  return isValidHttpUrl(url);
}

// --- Commerce placement (Shopee) submit gating + error mapping ---

export function canSubmitCommercePlacement(params: {
  contentId: string;
  channel: CommerceChannel | '';
  externalMediaId: string;
  durationSeconds: number | null;
  password: string;
}): boolean {
  if (params.contentId.trim().length === 0) return false;
  if (params.channel === '') return false;
  if (params.externalMediaId.trim().length === 0) return false;
  if (params.password.trim().length === 0) return false;
  if (isDurationBlocking(params.channel, params.durationSeconds)) return false;
  return true;
}

export interface DescribedError {
  message: string;
  isPasswordError: boolean;
}

/**
 * Maps an ApiError from the commerce placement (or any step-up-guarded
 * commerce) endpoint to a user-facing message. Every status gets a DISTINCT,
 * actionable message (design §4.4): 401/403/429 are authored here (the
 * backend's 401 body is generic "step-up re-auth failed" by design, so the
 * actionable framing belongs to the UI, same as ManualExternalRecordModal's
 * describeError); 409 (duplicate OR copyright gate) and 422 (duration
 * null/out-of-range) already carry a specific, actionable backend message —
 * relayed as-is rather than collapsed into one generic string.
 */
export function describeCommerceStepUpError(err: {
  status?: number;
  message: string;
} | null): DescribedError {
  if (!err) {
    return { message: 'Something went wrong. Please try again.', isPasswordError: false };
  }
  if (err.status === 401) {
    return {
      message: `${err.message} — check your password and try again.`,
      isPasswordError: true,
    };
  }
  if (err.status === 403) {
    return {
      message: 'Access denied — your account is not allowed to record placements.',
      isPasswordError: false,
    };
  }
  if (err.status === 429) {
    return {
      message:
        'Too many attempts. This endpoint allows 5 password attempts per 15 minutes — wait and try again.',
      isPasswordError: false,
    };
  }
  // 400 (validation), 409 (duplicate active placement OR copyright gate not
  // cleared), and 422 (duration null/out-of-range) all carry a specific,
  // already-actionable backend message — shown as-is.
  return { message: err.message, isPasswordError: false };
}

// --- Conversion (append-only) submit gating + reversal detection ---

export function canSubmitCommerceConversion(params: {
  channel: CommerceChannel | '';
  periodStart: string;
  periodEnd: string;
  commissionAmount: string;
  statementRef: string;
}): boolean {
  if (params.channel === '') return false;
  if (params.periodStart.trim().length === 0 || params.periodEnd.trim().length === 0) return false;
  if (params.periodEnd < params.periodStart) return false;
  if (params.commissionAmount.trim().length === 0 || Number.isNaN(Number(params.commissionAmount))) {
    return false;
  }
  return isValidStatementRef(params.statementRef);
}

/** A commission row is a reversal/refund iff its amount is negative — the append-only convention. */
export function isReversalAmount(commissionAmount: number): boolean {
  return commissionAmount < 0;
}

// --- Anchor picker (one component, two hosts: post / placement) ---

/**
 * Builds the RecordProductAnchorsDto body from the picker's per-product
 * selection state. `selections` maps productId → affiliateLinkId ("" or
 * undefined means "no link"), in the admin's chosen basket order.
 */
export function buildAnchorsPayload(
  order: string[],
  linkByProduct: Map<string, string>,
): AnchorItemInput[] {
  return order.map((productId) => {
    const affiliateLinkId = linkByProduct.get(productId);
    return affiliateLinkId ? { productId, affiliateLinkId } : { productId };
  });
}

/** Moves the entry at `index` one position earlier (a no-op at the start). */
export function moveEarlier<T>(list: T[], index: number): T[] {
  if (index <= 0 || index >= list.length) return list;
  const next = [...list];
  [next[index - 1], next[index]] = [next[index], next[index - 1]];
  return next;
}

/** Moves the entry at `index` one position later (a no-op at the end). */
export function moveLater<T>(list: T[], index: number): T[] {
  if (index < 0 || index >= list.length - 1) return list;
  const next = [...list];
  [next[index], next[index + 1]] = [next[index + 1], next[index]];
  return next;
}

// --- Commerce summary (dashboard section, 6B.5) ---

/**
 * True when there is nothing to show yet — every currency group has zero
 * conversion records. Drives the empty-state copy, which deliberately never
 * renders a ฿0.00 card (design §4.6: "a zero next to a payout figure invites
 * exactly the mental arithmetic this section exists to prevent").
 */
export function isCommerceSummaryEmpty(summary: CommerceSummary | null): boolean {
  if (!summary) return true;
  return summary.totals.length === 0 || summary.totals.every((row) => row.conversionRecords === 0);
}

/** Total commission across ALL currency groups added together as plain numbers — FOR TESTS ONLY. */
export function sumCommissionAcrossCurrencies(totals: CommerceCurrencyTotal[]): number {
  return totals.reduce((sum, row) => sum + row.commissionAmount, 0);
}

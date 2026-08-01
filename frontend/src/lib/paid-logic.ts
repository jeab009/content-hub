import type { AdCampaign, AdPerformanceEntry, PaidSummary } from '@/lib/api-client';

/**
 * Pure decision helpers for the Paid / Ads visibility feature (Phase 7B).
 * Kept free of React/fetch so the branching (submit gating, date-order
 * validation, sourceRef shape, correction detection, error categorisation) is
 * unit-testable in isolation — the same posture as commerce-logic.ts /
 * publish-logic.ts.
 */

// --- sourceRef shape (mirrors PAID_SOURCE_REF_PATTERN /
// PAID_SOURCE_REF_MAX_LENGTH in backend/src/modules/paid/paid.constants.ts
// EXACTLY — same anchored, length-bounded pattern, alphanumeric-first, which
// is itself copied verbatim in shape from COMMERCE_STATEMENT_REF_PATTERN,
// System Analyst condition P-A1). ---

export const PAID_SOURCE_REF_MAX_LENGTH = 64;
export const PAID_SOURCE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,63}$/;

/**
 * Blank is valid (the field is optional). Anything present must match the
 * server's pattern — letters, digits, and `._-/` only, NO SPACE, first
 * character alphanumeric.
 */
export function isValidSourceRef(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return true;
  }
  if (trimmed.length > PAID_SOURCE_REF_MAX_LENGTH) {
    return false;
  }
  return PAID_SOURCE_REF_PATTERN.test(trimmed);
}

export const SOURCE_REF_HELP_TEXT =
  'Business reference only — never buyer names, order ids, addresses, or contacts. ' +
  'Letters, digits, and . _ - / only (no spaces), up to 64 characters.';

// --- Campaign objective / free-text length caps (mirror
// PAID_OBJECTIVE_MAX_LENGTH in backend paid.constants.ts). ---

export const PAID_OBJECTIVE_MAX_LENGTH = 100;

// --- Campaign date-order validation (client mirror of BUG-7A-01's now-fixed
// server check, `assertValidDateRange` in paid-campaign.service.ts). A null/
// empty endDate always passes — "still running" is a real, common state; the
// DB CHECK is `end_date IS NULL OR end_date >= start_date`, and this helper
// must never disagree with it. ---

/**
 * `endDate` may be blank ("still running"). If present, it must not be
 * strictly before `startDate` — same-day campaigns are valid (`>=`, not `>`),
 * mirroring the backend CHECK exactly.
 */
export function isValidCampaignDateRange(startDate: string, endDate: string): boolean {
  if (startDate.trim().length === 0) {
    return false;
  }
  const trimmedEnd = endDate.trim();
  if (trimmedEnd.length === 0) {
    return true;
  }
  return trimmedEnd >= startDate.trim();
}

export const CAMPAIGN_DATE_RANGE_ERROR =
  'End date must not be before the start date. Leave end date blank for an ongoing campaign.';

// --- Campaign form submit gating ---

export function canSubmitPaidCampaign(params: {
  externalCampaignName: string;
  objective: string;
  startDate: string;
  endDate: string;
}): boolean {
  if (params.externalCampaignName.trim().length === 0) return false;
  if (params.objective.trim().length === 0) return false;
  if (!isValidCampaignDateRange(params.startDate, params.endDate)) return false;
  return true;
}

// --- Performance entry form submit gating ---

export function canSubmitPerformanceEntry(params: {
  periodStart: string;
  periodEnd: string;
  spend: string;
  sourceRef: string;
}): boolean {
  if (params.periodStart.trim().length === 0 || params.periodEnd.trim().length === 0) return false;
  if (params.periodEnd < params.periodStart) return false;
  const spend = Number(params.spend);
  if (params.spend.trim().length === 0 || Number.isNaN(spend) || spend < 0) return false;
  return isValidSourceRef(params.sourceRef);
}

// --- Correction detection (Phase 7's deliberately different word from
// Commerce's "Reversal" — ADR-7.2/design §1.2 boxed discussion: ad spend has
// no real-world refund event, only data-entry corrections). ---

/** A performance entry row is a CORRECTION iff it names the entry it corrects. */
export function isCorrection(entry: Pick<AdPerformanceEntry, 'correctsEntryId'>): boolean {
  return entry.correctsEntryId !== null;
}

// --- Error message mapping for the performance-entry form ---

export interface DescribedPaidEntryError {
  message: string;
}

/**
 * Maps an ApiError from POST .../performance-entries to a user-facing
 * message. Every status gets a DISTINCT, actionable message, mirroring
 * Commerce's conversion-form error handling:
 *   - 409: the 60s same-payload idempotency guard rejected a duplicate —
 *     the backend message already names the id and gives a "wait and
 *     resubmit" hint, so it is relayed AS-IS (mirroring how Commerce relays
 *     its own already-actionable 409/422 messages) rather than appending a
 *     second, redundant hint.
 *   - 400: `correctsEntryId` named an entry belonging to a different campaign.
 *   - 404: the campaign, or the entry named by `correctsEntryId`, was not found.
 * All other statuses relay the backend's own (already specific) message.
 */
export function describePaidEntryError(err: { status?: number; message: string } | null): DescribedPaidEntryError {
  if (!err) {
    return { message: 'Something went wrong. Please try again.' };
  }
  if (err.status === 409) {
    return { message: err.message };
  }
  if (err.status === 400) {
    return {
      message: `${err.message} Pick a "Corrects" entry that belongs to this same campaign, or leave it unset.`,
    };
  }
  if (err.status === 404) {
    return {
      message: `${err.message} The entry it corrects may have been logged under a different campaign — check and try again.`,
    };
  }
  return { message: err.message };
}

// --- Paid summary (dashboard section, 7B.3) ---

/**
 * True when there is nothing to show yet — every currency group has zero
 * performance entries. Drives the empty-state copy, which deliberately never
 * renders a ฿0.00 card (design §4.4: "a zero next to two other real figures
 * invites exactly the mental arithmetic this section exists to prevent").
 */
export function isPaidSummaryEmpty(summary: PaidSummary | null): boolean {
  if (!summary) return true;
  return summary.totals.length === 0 || summary.totals.every((row) => row.entriesCount === 0);
}

/** Count of campaigns with `status === 'active'` — for the dashboard's "Campaigns" KPI card. */
export function countActiveCampaigns(campaigns: AdCampaign[]): number {
  return campaigns.filter((campaign) => campaign.status === 'active').length;
}

/** Total spend across ALL currency groups added together as plain numbers — FOR TESTS ONLY. */
export function sumSpendAcrossCurrencies(totals: PaidSummary['totals']): number {
  return totals.reduce((sum, row) => sum + row.totalSpend, 0);
}

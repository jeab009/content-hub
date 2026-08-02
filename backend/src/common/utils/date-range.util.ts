import { BadRequestException } from '@nestjs/common';

/**
 * Shared date-range guard. Extracted after the identical "end date/period
 * before start" gap was found and fixed independently three times —
 * BUG-7A-01 (`PaidCampaignService`), BUG-7B-01 (`PaidPerformanceService`),
 * M-4 (`CommerceConversionService`, pre-production security review #2). All
 * three services had a DB `CHECK (end >= start)` constraint as the only
 * backstop and no application-layer guard, so a backwards range reached
 * Postgres and surfaced as a raw 500 instead of a clean 400. Three
 * hand-copied private methods meant a fourth sibling could silently repeat
 * the same gap; this is the one place that class of bug can no longer hide.
 *
 * `end === null` always passes — every caller's "no end date yet" state
 * (a still-running campaign) is a valid, common case, never a violation.
 * Required-end callers (performance entries, conversions) simply never pass
 * `null`, so the null-branch never fires for them.
 */
export function assertValidDateRange(
  start: Date,
  end: Date | null,
  fieldNames: { start: string; end: string },
): void {
  if (end !== null && end < start) {
    throw new BadRequestException(
      `${fieldNames.end} (${end.toISOString().slice(0, 10)}) must not be before ` +
        `${fieldNames.start} (${start.toISOString().slice(0, 10)}).`,
    );
  }
}

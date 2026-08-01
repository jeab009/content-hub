import { BadRequestException } from '@nestjs/common';
import { PAID_SUPPORTED_CURRENCIES } from './paid.constants';

/**
 * System Analyst SA-P6: the `currency` column exists on both money-bearing
 * paid tables (and carries a DB CHECK on shape) so it never has to be added
 * later — but v1 REJECTS anything but THB in the SERVICE, mirroring
 * `assertSupportedCurrency` / `commerce-currency.util.ts` exactly. Relaxing
 * this guard later is free; adding a column later would not have been.
 *
 * Shared between `PaidCampaignService` and `PaidPerformanceService` — both
 * money-bearing write paths — so the rule cannot drift between them.
 */
export function assertPaidSupportedCurrency(currency: string): string {
  const normalized = currency.toUpperCase();
  if (!PAID_SUPPORTED_CURRENCIES.includes(normalized)) {
    throw new BadRequestException(
      `Unsupported currency "${currency}". This system currently accepts: ` +
        `${PAID_SUPPORTED_CURRENCIES.join(', ')}.`,
    );
  }
  return normalized;
}

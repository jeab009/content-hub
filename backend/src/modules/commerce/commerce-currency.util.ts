import { BadRequestException } from '@nestjs/common';
import { COMMERCE_SUPPORTED_CURRENCIES } from './commerce.constants';

/**
 * System Analyst SA-9: the `currency` column exists on every money-bearing
 * commerce table (and carries a DB CHECK) so it never has to be added later —
 * but v1 REJECTS anything but THB in the SERVICE, because no non-THB
 * statement is expected yet and the summary must never total across
 * currencies. Relaxing this guard later is free; adding a column later is
 * not (§SA-9 note 2).
 *
 * Shared between `CommerceCatalogService` and `CommerceConversionService` —
 * both money-bearing write paths — so the rule cannot drift between them.
 */
export function assertSupportedCurrency(currency: string): string {
  const normalized = currency.toUpperCase();
  if (!COMMERCE_SUPPORTED_CURRENCIES.includes(normalized)) {
    throw new BadRequestException(
      `Unsupported currency "${currency}". This system currently accepts: ` +
        `${COMMERCE_SUPPORTED_CURRENCIES.join(', ')}.`,
    );
  }
  return normalized;
}

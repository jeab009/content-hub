import { CadencePeriodUnit } from '@prisma/client';

/**
 * Cadence period math shared by the ranking engine's cadence-pressure
 * factor and the scheduler overview. Pure functions, UTC-based:
 * - week periods start Monday 00:00:00 UTC (ISO-8601 week convention),
 * - month periods start on the 1st, 00:00:00 UTC.
 * UTC (not server-local time) so the period boundary is deterministic
 * across containers/hosts in different timezones.
 */
export function currentPeriodStart(unit: CadencePeriodUnit, now: Date = new Date()): Date {
  if (unit === CadencePeriodUnit.month) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  // getUTCDay(): 0 = Sunday .. 6 = Saturday; shift so Monday is day 0.
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday),
  );
}

/** Exclusive end of the current period (i.e. the next period's start). */
export function currentPeriodEnd(unit: CadencePeriodUnit, now: Date = new Date()): Date {
  const start = currentPeriodStart(unit, now);
  if (unit === CadencePeriodUnit.month) {
    return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  }
  const DAYS_PER_WEEK = 7;
  return new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + DAYS_PER_WEEK),
  );
}

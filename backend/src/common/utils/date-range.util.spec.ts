import { BadRequestException } from '@nestjs/common';
import { assertValidDateRange } from './date-range.util';

const FIELD_NAMES = { start: 'periodStart', end: 'periodEnd' };

describe('assertValidDateRange', () => {
  it('rejects end before start', () => {
    expect(() =>
      assertValidDateRange(new Date('2026-07-10'), new Date('2026-07-01'), FIELD_NAMES),
    ).toThrow(BadRequestException);
  });

  it('accepts end equal to start', () => {
    expect(() =>
      assertValidDateRange(new Date('2026-07-10'), new Date('2026-07-10'), FIELD_NAMES),
    ).not.toThrow();
  });

  it('accepts end after start', () => {
    expect(() =>
      assertValidDateRange(new Date('2026-07-01'), new Date('2026-07-10'), FIELD_NAMES),
    ).not.toThrow();
  });

  it('accepts a null end ("still running" / no end date yet)', () => {
    expect(() => assertValidDateRange(new Date('2026-07-01'), null, FIELD_NAMES)).not.toThrow();
  });

  it('names both fields and both dates in the error message', () => {
    expect(() =>
      assertValidDateRange(new Date('2026-07-10'), new Date('2026-07-01'), FIELD_NAMES),
    ).toThrow('periodEnd (2026-07-01) must not be before periodStart (2026-07-10).');
  });

  it('uses the caller-supplied field names in the message (e.g. campaign start/end)', () => {
    expect(() =>
      assertValidDateRange(new Date('2026-07-10'), new Date('2026-07-01'), {
        start: 'startDate',
        end: 'endDate',
      }),
    ).toThrow('endDate (2026-07-01) must not be before startDate (2026-07-10).');
  });
});

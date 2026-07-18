import { CadencePeriodUnit } from '@prisma/client';
import { currentPeriodEnd, currentPeriodStart } from './cadence-period.util';

describe('cadence period math (UTC)', () => {
  describe('week periods (Monday 00:00 UTC start)', () => {
    it('maps a mid-week instant to the preceding Monday', () => {
      // 2026-07-17 is a Friday.
      const friday = new Date('2026-07-17T15:30:00Z');
      expect(currentPeriodStart(CadencePeriodUnit.week, friday).toISOString()).toBe(
        '2026-07-13T00:00:00.000Z',
      );
    });

    it('Sunday 23:59:59 still belongs to the week that began the PREVIOUS Monday', () => {
      const sundayNight = new Date('2026-07-19T23:59:59Z');
      expect(currentPeriodStart(CadencePeriodUnit.week, sundayNight).toISOString()).toBe(
        '2026-07-13T00:00:00.000Z',
      );
    });

    it('Monday 00:00:00 starts a NEW week — the boundary itself', () => {
      const mondayMidnight = new Date('2026-07-20T00:00:00Z');
      expect(currentPeriodStart(CadencePeriodUnit.week, mondayMidnight).toISOString()).toBe(
        '2026-07-20T00:00:00.000Z',
      );
    });

    it('period end is the exclusive next Monday', () => {
      const friday = new Date('2026-07-17T15:30:00Z');
      expect(currentPeriodEnd(CadencePeriodUnit.week, friday).toISOString()).toBe(
        '2026-07-20T00:00:00.000Z',
      );
    });

    it('handles month rollover inside a week', () => {
      // 2026-08-01 is a Saturday; its week began Monday 2026-07-27.
      const saturday = new Date('2026-08-01T10:00:00Z');
      expect(currentPeriodStart(CadencePeriodUnit.week, saturday).toISOString()).toBe(
        '2026-07-27T00:00:00.000Z',
      );
      expect(currentPeriodEnd(CadencePeriodUnit.week, saturday).toISOString()).toBe(
        '2026-08-03T00:00:00.000Z',
      );
    });
  });

  describe('month periods', () => {
    it('starts on the 1st 00:00 UTC and ends on the next 1st (exclusive)', () => {
      const midMonth = new Date('2026-07-17T15:30:00Z');
      expect(currentPeriodStart(CadencePeriodUnit.month, midMonth).toISOString()).toBe(
        '2026-07-01T00:00:00.000Z',
      );
      expect(currentPeriodEnd(CadencePeriodUnit.month, midMonth).toISOString()).toBe(
        '2026-08-01T00:00:00.000Z',
      );
    });

    it('handles December → January rollover', () => {
      const december = new Date('2026-12-31T23:00:00Z');
      expect(currentPeriodEnd(CadencePeriodUnit.month, december).toISOString()).toBe(
        '2027-01-01T00:00:00.000Z',
      );
    });
  });
});

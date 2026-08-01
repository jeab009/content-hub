import { describe, expect, it } from '@jest/globals';
import {
  canSubmitPaidCampaign,
  canSubmitPerformanceEntry,
  countActiveCampaigns,
  describePaidEntryError,
  isCorrection,
  isPaidSummaryEmpty,
  isValidCampaignDateRange,
  isValidSourceRef,
  sumSpendAcrossCurrencies,
} from '@/lib/paid-logic';
import type { AdCampaign, PaidSummary } from '@/lib/api-client';

describe('isValidSourceRef (mirrors PAID_SOURCE_REF_PATTERN / the corrected Commerce shape)', () => {
  it('accepts blank — the field is optional', () => {
    expect(isValidSourceRef('')).toBe(true);
    expect(isValidSourceRef('   ')).toBe(true);
  });

  it('accepts letters, digits, dot, underscore, hyphen, slash — no space', () => {
    expect(isValidSourceRef('AdsManager.CampaignSummary.2026-07-20')).toBe(true);
    expect(isValidSourceRef('Ads_Manager/2026.W29-1')).toBe(true);
  });

  it('rejects a space (the exact SA-P1 defect this pattern must not reintroduce)', () => {
    expect(isValidSourceRef('John Smith')).toBe(false);
    expect(isValidSourceRef('Ads Manager Campaign Summary')).toBe(false);
  });

  it('rejects a non-alphanumeric first character', () => {
    expect(isValidSourceRef('-AdsManager')).toBe(false);
    expect(isValidSourceRef('.AdsManager')).toBe(false);
    expect(isValidSourceRef('/AdsManager')).toBe(false);
  });

  it('rejects an email-shaped value (@ is not in the allow-list)', () => {
    expect(isValidSourceRef('someone@example.com')).toBe(false);
  });

  it('rejects a value over 64 characters, accepts exactly 64', () => {
    expect(isValidSourceRef('A'.repeat(65))).toBe(false);
    expect(isValidSourceRef('A'.repeat(64))).toBe(true);
  });
});

describe('isValidCampaignDateRange (client mirror of BUG-7A-01, the now-fixed backend check)', () => {
  it('rejects a blank start date', () => {
    expect(isValidCampaignDateRange('', '2026-07-31')).toBe(false);
  });

  it('accepts a blank end date — "still running" is a real, common state', () => {
    expect(isValidCampaignDateRange('2026-07-01', '')).toBe(true);
    expect(isValidCampaignDateRange('2026-07-01', '   ')).toBe(true);
  });

  it('rejects endDate strictly before startDate', () => {
    expect(isValidCampaignDateRange('2026-07-31', '2026-07-01')).toBe(false);
  });

  it('accepts endDate equal to startDate — same-day campaigns are valid (>=, not >)', () => {
    expect(isValidCampaignDateRange('2026-07-01', '2026-07-01')).toBe(true);
  });

  it('accepts endDate strictly after startDate', () => {
    expect(isValidCampaignDateRange('2026-07-01', '2026-07-31')).toBe(true);
  });
});

describe('canSubmitPaidCampaign', () => {
  const base = {
    externalCampaignName: 'Summer Skincare Reach',
    objective: 'Traffic',
    startDate: '2026-07-01',
    endDate: '',
  };

  it('allows a well-formed campaign with no end date', () => {
    expect(canSubmitPaidCampaign(base)).toBe(true);
  });

  it('requires a non-blank campaign name and objective', () => {
    expect(canSubmitPaidCampaign({ ...base, externalCampaignName: '  ' })).toBe(false);
    expect(canSubmitPaidCampaign({ ...base, objective: '' })).toBe(false);
  });

  it('blocks on an invalid date range', () => {
    expect(canSubmitPaidCampaign({ ...base, startDate: '2026-07-31', endDate: '2026-07-01' })).toBe(
      false,
    );
  });
});

describe('canSubmitPerformanceEntry', () => {
  const base = {
    periodStart: '2026-07-13',
    periodEnd: '2026-07-19',
    spend: '3200.00',
    sourceRef: 'AdsManager.CampaignSummary.2026-07-20',
  };

  it('allows a well-formed entry', () => {
    expect(canSubmitPerformanceEntry(base)).toBe(true);
  });

  it('allows a blank sourceRef — the field is optional', () => {
    expect(canSubmitPerformanceEntry({ ...base, sourceRef: '' })).toBe(true);
  });

  it('requires a valid period range (periodEnd >= periodStart)', () => {
    expect(
      canSubmitPerformanceEntry({ ...base, periodStart: '2026-07-19', periodEnd: '2026-07-13' }),
    ).toBe(false);
  });

  it('accepts a period of a single day (periodEnd === periodStart)', () => {
    expect(canSubmitPerformanceEntry({ ...base, periodStart: '2026-07-13', periodEnd: '2026-07-13' })).toBe(
      true,
    );
  });

  it('requires a non-negative numeric spend — NEGATIVE IS NOT LEGAL (SA-P2, unlike Commerce)', () => {
    expect(canSubmitPerformanceEntry({ ...base, spend: '' })).toBe(false);
    expect(canSubmitPerformanceEntry({ ...base, spend: 'abc' })).toBe(false);
    expect(canSubmitPerformanceEntry({ ...base, spend: '-1' })).toBe(false);
  });

  it('accepts a zero spend (a legitimate boundary — a just-started campaign)', () => {
    expect(canSubmitPerformanceEntry({ ...base, spend: '0' })).toBe(true);
  });

  it('rejects an invalid sourceRef', () => {
    expect(canSubmitPerformanceEntry({ ...base, sourceRef: 'John Smith' })).toBe(false);
  });
});

describe('isCorrection (the deliberately different word from Commerce\'s "Reversal")', () => {
  it('is true only when correctsEntryId is set', () => {
    expect(isCorrection({ correctsEntryId: 'entry-1' })).toBe(true);
    expect(isCorrection({ correctsEntryId: null })).toBe(false);
  });
});

describe('describePaidEntryError', () => {
  it('gives a generic message when there is no error object', () => {
    expect(describePaidEntryError(null).message).toMatch(/something went wrong/i);
  });

  it('409 (idempotency) relays the backend message AS-IS — it is already specific and actionable', () => {
    const backendMessage =
      'An identical performance entry was already recorded 12s ago (id abc). If this is a ' +
      'genuinely new line, wait a moment and resubmit.';
    const described = describePaidEntryError({ status: 409, message: backendMessage });
    expect(described.message).toBe(backendMessage);
  });

  it('400 (cross-campaign correction) appends a same-campaign hint', () => {
    const described = describePaidEntryError({
      status: 400,
      message: 'correctsEntryId abc belongs to campaign xyz, not def.',
    });
    expect(described.message).toContain('belongs to campaign');
    expect(described.message).toMatch(/same campaign/i);
  });

  it('404 (correction target not found) appends a distinct hint', () => {
    const described = describePaidEntryError({
      status: 404,
      message: 'The performance entry this row corrects was not found',
    });
    expect(described.message).toContain('was not found');
    expect(described.message).toMatch(/different campaign/i);
  });

  it('relays every other status as-is (already specific and actionable)', () => {
    const described = describePaidEntryError({ status: 422, message: 'Some validation message.' });
    expect(described.message).toBe('Some validation message.');
  });
});

describe('countActiveCampaigns', () => {
  function campaign(status: AdCampaign['status']): AdCampaign {
    return {
      id: `campaign-${status}`,
      channel: 'meta',
      externalCampaignName: 'x',
      externalCampaignId: null,
      objective: 'Traffic',
      contentId: null,
      startDate: '2026-07-01',
      endDate: null,
      plannedBudget: null,
      currency: 'THB',
      status,
      isActive: true,
      retiredAt: null,
      source: 'manual',
      createdBy: 'user-1',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    };
  }

  it('counts only status === active, regardless of isActive/retire state', () => {
    expect(countActiveCampaigns([campaign('active'), campaign('paused'), campaign('ended')])).toBe(1);
    expect(countActiveCampaigns([campaign('active'), campaign('active')])).toBe(2);
    expect(countActiveCampaigns([])).toBe(0);
  });
});

describe('isPaidSummaryEmpty / sumSpendAcrossCurrencies', () => {
  function summary(totals: PaidSummary['totals']): PaidSummary {
    return { generatedAt: '2026-07-20T00:00:00.000Z', totals, byCampaign: [], byResultType: [] };
  }

  it('is empty when there are no currency groups, or every group has zero entries', () => {
    expect(isPaidSummaryEmpty(null)).toBe(true);
    expect(isPaidSummaryEmpty(summary([]))).toBe(true);
    expect(
      isPaidSummaryEmpty(
        summary([
          {
            currency: 'THB',
            totalSpend: 0,
            totalReach: 0,
            totalImpressions: 0,
            totalClicks: 0,
            totalResultCount: 0,
            entriesCount: 0,
          },
        ]),
      ),
    ).toBe(true);
  });

  it('is not empty once a currency group has at least one entry', () => {
    expect(
      isPaidSummaryEmpty(
        summary([
          {
            currency: 'THB',
            totalSpend: 12_050,
            totalReach: 401_000,
            totalImpressions: 900_000,
            totalClicks: 3_880,
            totalResultCount: 47,
            entriesCount: 10,
          },
        ]),
      ),
    ).toBe(false);
  });

  it('sums across currency groups (a TEST-ONLY helper — production code must never do this)', () => {
    expect(
      sumSpendAcrossCurrencies([
        {
          currency: 'THB',
          totalSpend: 100,
          totalReach: 0,
          totalImpressions: 0,
          totalClicks: 0,
          totalResultCount: 0,
          entriesCount: 1,
        },
        {
          currency: 'USD',
          totalSpend: 5,
          totalReach: 0,
          totalImpressions: 0,
          totalClicks: 0,
          totalResultCount: 0,
          entriesCount: 1,
        },
      ]),
    ).toBe(105);
  });
});

import { describe, expect, it } from '@jest/globals';
import {
  buildAnchorsPayload,
  canSubmitAffiliateLink,
  canSubmitCommerceConversion,
  canSubmitCommercePlacement,
  canSubmitCommerceProduct,
  describeCommerceStepUpError,
  describeDurationHint,
  isCommerceSummaryEmpty,
  isDurationBlocking,
  isReversalAmount,
  isValidHttpUrl,
  isValidStatementRef,
  moveEarlier,
  moveLater,
  sumCommissionAcrossCurrencies,
} from '@/lib/commerce-logic';
import type { CommerceSummary } from '@/lib/api-client';

describe('describeDurationHint / isDurationBlocking (Shopee 10-60s gate)', () => {
  it('is not applicable to a non-shopee channel', () => {
    expect(describeDurationHint('tiktok_shop', null).kind).toBe('not-applicable');
    expect(isDurationBlocking('tiktok_shop', null)).toBe(false);
    expect(isDurationBlocking('tiktok_shop', 999)).toBe(false);
  });

  it('treats a null/unparsed duration as a REJECTION, not a pass, for shopee', () => {
    const hint = describeDurationHint('shopee', null);
    expect(hint.kind).toBe('missing');
    expect(hint.message).toMatch(/unknown counts as a rejection/i);
    expect(isDurationBlocking('shopee', null)).toBe(true);
  });

  it('rejects durations outside the inclusive 10-60s bounds', () => {
    expect(isDurationBlocking('shopee', 9)).toBe(true);
    expect(isDurationBlocking('shopee', 61)).toBe(true);
    expect(describeDurationHint('shopee', 61).kind).toBe('out-of-range');
  });

  it('accepts the inclusive boundaries 10s and 60s', () => {
    expect(isDurationBlocking('shopee', 10)).toBe(false);
    expect(isDurationBlocking('shopee', 60)).toBe(false);
    expect(describeDurationHint('shopee', 42).kind).toBe('ok');
  });
});

describe('isValidStatementRef (mirrors COMMERCE_STATEMENT_REF_PATTERN)', () => {
  it('accepts blank — the field is optional', () => {
    expect(isValidStatementRef('')).toBe(true);
    expect(isValidStatementRef('   ')).toBe(true);
  });

  it('accepts letters, digits, dot, underscore, hyphen, slash — no space', () => {
    expect(isValidStatementRef('SHP-2026-W29')).toBe(true);
    expect(isValidStatementRef('SHP_2026.W29/1')).toBe(true);
  });

  it('rejects a space (the closed loophole — SA-1)', () => {
    expect(isValidStatementRef('John Smith')).toBe(false);
    expect(isValidStatementRef('Ratchada Rd 42')).toBe(false);
  });

  it('rejects a non-alphanumeric first character', () => {
    expect(isValidStatementRef('-SHP2026')).toBe(false);
    expect(isValidStatementRef('.SHP2026')).toBe(false);
  });

  it('rejects an email-shaped value (@ is not in the allow-list)', () => {
    expect(isValidStatementRef('someone@example.com')).toBe(false);
  });

  it('rejects a value over 64 characters', () => {
    expect(isValidStatementRef('A'.repeat(65))).toBe(false);
    expect(isValidStatementRef('A'.repeat(64))).toBe(true);
  });
});

describe('canSubmitCommerceProduct', () => {
  it('requires channel, externalProductId and name', () => {
    expect(
      canSubmitCommerceProduct({ channel: '', externalProductId: '1', name: 'Serum' }),
    ).toBe(false);
    expect(
      canSubmitCommerceProduct({ channel: 'shopee', externalProductId: '', name: 'Serum' }),
    ).toBe(false);
    expect(
      canSubmitCommerceProduct({ channel: 'shopee', externalProductId: '1', name: '  ' }),
    ).toBe(false);
    expect(
      canSubmitCommerceProduct({ channel: 'shopee', externalProductId: '1', name: 'Serum' }),
    ).toBe(true);
  });
});

describe('isValidHttpUrl / canSubmitAffiliateLink', () => {
  it('accepts http(s) URLs only', () => {
    expect(isValidHttpUrl('https://s.shopee.co.th/abc123')).toBe(true);
    expect(isValidHttpUrl('ftp://example.com')).toBe(false);
    expect(isValidHttpUrl('not a url')).toBe(false);
    expect(isValidHttpUrl('')).toBe(false);
  });

  it('canSubmitAffiliateLink defers to isValidHttpUrl', () => {
    expect(canSubmitAffiliateLink('https://s.shopee.co.th/abc123')).toBe(true);
    expect(canSubmitAffiliateLink('')).toBe(false);
  });
});

describe('canSubmitCommercePlacement', () => {
  const base = {
    contentId: 'content-1',
    channel: 'shopee' as const,
    externalMediaId: '1122334455',
    durationSeconds: 42,
    password: 'secret',
  };

  it('allows a well-formed shopee submission', () => {
    expect(canSubmitCommercePlacement(base)).toBe(true);
  });

  it('blocks on a missing or out-of-range shopee duration', () => {
    expect(canSubmitCommercePlacement({ ...base, durationSeconds: null })).toBe(false);
    expect(canSubmitCommercePlacement({ ...base, durationSeconds: 9 })).toBe(false);
    expect(canSubmitCommercePlacement({ ...base, durationSeconds: 61 })).toBe(false);
  });

  it('does not require a duration for a non-shopee channel', () => {
    expect(
      canSubmitCommercePlacement({ ...base, channel: 'tiktok_shop', durationSeconds: null }),
    ).toBe(true);
  });

  it('requires contentId, channel, externalMediaId and password', () => {
    expect(canSubmitCommercePlacement({ ...base, contentId: '' })).toBe(false);
    expect(canSubmitCommercePlacement({ ...base, channel: '' })).toBe(false);
    expect(canSubmitCommercePlacement({ ...base, externalMediaId: '' })).toBe(false);
    expect(canSubmitCommercePlacement({ ...base, password: '' })).toBe(false);
  });
});

describe('describeCommerceStepUpError', () => {
  it('gives a distinct, actionable message per status code', () => {
    expect(describeCommerceStepUpError({ status: 401, message: 'Incorrect password' })).toEqual({
      message: 'Incorrect password — check your password and try again.',
      isPasswordError: true,
    });
    expect(describeCommerceStepUpError({ status: 403, message: 'Forbidden' }).isPasswordError).toBe(
      false,
    );
    expect(describeCommerceStepUpError({ status: 403, message: 'Forbidden' }).message).toMatch(
      /access denied/i,
    );
    expect(describeCommerceStepUpError({ status: 429, message: 'Too many' }).message).toMatch(
      /5 password attempts per 15 minutes/,
    );
  });

  it('relays the backend 409/422 message as-is (already specific and actionable)', () => {
    const duplicate = describeCommerceStepUpError({
      status: 409,
      message: 'An active shopee placement for this content already exists (placement abc).',
    });
    expect(duplicate.message).toContain('already exists');
    expect(duplicate.isPasswordError).toBe(false);

    const duration = describeCommerceStepUpError({
      status: 422,
      message: 'Shopee placements require a video duration between 10 and 60 seconds.',
    });
    expect(duration.message).toContain('10 and 60 seconds');
  });

  it('only clears the password on 401 — every other status keeps isPasswordError false', () => {
    for (const status of [400, 403, 404, 409, 422, 429, 500]) {
      expect(describeCommerceStepUpError({ status, message: 'x' }).isPasswordError).toBe(false);
    }
  });
});

describe('canSubmitCommerceConversion', () => {
  const base = {
    channel: 'shopee' as const,
    periodStart: '2026-07-13',
    periodEnd: '2026-07-19',
    commissionAmount: '4120.00',
    statementRef: 'SHP-2026-W29',
  };

  it('allows a well-formed entry, including a negative reversal amount', () => {
    expect(canSubmitCommerceConversion(base)).toBe(true);
    expect(canSubmitCommerceConversion({ ...base, commissionAmount: '-240.00' })).toBe(true);
  });

  it('requires channel and a valid period range', () => {
    expect(canSubmitCommerceConversion({ ...base, channel: '' })).toBe(false);
    expect(
      canSubmitCommerceConversion({ ...base, periodStart: '2026-07-19', periodEnd: '2026-07-13' }),
    ).toBe(false);
  });

  it('requires a numeric commission amount', () => {
    expect(canSubmitCommerceConversion({ ...base, commissionAmount: '' })).toBe(false);
    expect(canSubmitCommerceConversion({ ...base, commissionAmount: 'abc' })).toBe(false);
  });

  it('rejects an invalid statementRef', () => {
    expect(canSubmitCommerceConversion({ ...base, statementRef: 'John Smith' })).toBe(false);
  });
});

describe('isReversalAmount', () => {
  it('is true only for a negative commission amount', () => {
    expect(isReversalAmount(-240)).toBe(true);
    expect(isReversalAmount(0)).toBe(false);
    expect(isReversalAmount(4120)).toBe(false);
  });
});

describe('anchor picker ordering + payload building', () => {
  it('buildAnchorsPayload omits affiliateLinkId when unset (never null)', () => {
    const payload = buildAnchorsPayload(
      ['product-a', 'product-b'],
      new Map([['product-a', 'link-1']]),
    );
    expect(payload).toEqual([
      { productId: 'product-a', affiliateLinkId: 'link-1' },
      { productId: 'product-b' },
    ]);
    expect(payload[1]).not.toHaveProperty('affiliateLinkId');
  });

  it('moveEarlier/moveLater swap adjacent entries and no-op at the edges', () => {
    const list = ['a', 'b', 'c'];
    expect(moveEarlier(list, 1)).toEqual(['b', 'a', 'c']);
    expect(moveEarlier(list, 0)).toEqual(list);
    expect(moveLater(list, 1)).toEqual(['a', 'c', 'b']);
    expect(moveLater(list, 2)).toEqual(list);
  });
});

describe('isCommerceSummaryEmpty / sumCommissionAcrossCurrencies', () => {
  function summary(totals: CommerceSummary['totals']): CommerceSummary {
    return { generatedAt: '2026-07-20T00:00:00.000Z', totals, byChannel: [], byProduct: [], byPeriod: [] };
  }

  it('is empty when there are no currency groups, or every group has zero records', () => {
    expect(isCommerceSummaryEmpty(null)).toBe(true);
    expect(isCommerceSummaryEmpty(summary([]))).toBe(true);
    expect(
      isCommerceSummaryEmpty(
        summary([
          {
            currency: 'THB',
            commissionAmount: 0,
            grossSalesAmount: 0,
            ordersCount: 0,
            itemsSold: 0,
            conversionRecords: 0,
          },
        ]),
      ),
    ).toBe(true);
  });

  it('is not empty once a currency group has at least one conversion record', () => {
    expect(
      isCommerceSummaryEmpty(
        summary([
          {
            currency: 'THB',
            commissionAmount: 12290,
            grossSalesAmount: 154500,
            ordersCount: 402,
            itemsSold: 500,
            conversionRecords: 9,
          },
        ]),
      ),
    ).toBe(false);
  });

  it('sums across currency groups (a TEST-ONLY helper — production code must never do this)', () => {
    expect(
      sumCommissionAcrossCurrencies([
        {
          currency: 'THB',
          commissionAmount: 100,
          grossSalesAmount: 0,
          ordersCount: 0,
          itemsSold: 0,
          conversionRecords: 1,
        },
        {
          currency: 'USD',
          commissionAmount: 5,
          grossSalesAmount: 0,
          ordersCount: 0,
          itemsSold: 0,
          conversionRecords: 1,
        },
      ]),
    ).toBe(105);
  });
});

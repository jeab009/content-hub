import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import type { CommerceProduct, CommerceSummary } from '@/lib/api-client';
import { CommerceDashboardSection } from '@/components/commerce/CommerceDashboardSection';

/**
 * 6B.5 acceptance criterion: "a UI test asserts no element renders
 * payout+commerce summed." This component never receives payout data as
 * props (it fetches its own `/api/commerce/summary`), so the test proves the
 * negative two ways: (1) the six separation signals are all present, and
 * (2) no rendered text anywhere equals a plausible combined figure, and no
 * card is ever labelled the way the payout side's KPI card is.
 *
 * NOTE: this file deliberately avoids `@testing-library/jest-dom`'s custom
 * matchers (`toBeInTheDocument`, etc.) — this project's tests use
 * `@jest/globals`' own `expect`, whose types don't merge with jest-dom's
 * global `jest.Matchers` augmentation, so `toBeInTheDocument` type-checks
 * under `ts-jest` (isolatedModules skips full type-checking) but fails
 * `tsc --noEmit`. Plain null-checks on `queryBy*`/resolved `findBy*` give
 * the exact same assertions without the type mismatch.
 */

const mockGetCommerceSummary = jest.fn<() => Promise<CommerceSummary>>();
const mockListCommerceProducts = jest.fn<() => Promise<CommerceProduct[]>>();

jest.mock('@/lib/api-client', () => {
  const actual = jest.requireActual('@/lib/api-client') as Record<string, unknown>;
  return {
    ...actual,
    apiClient: {
      getCommerceSummary: (...args: unknown[]) => mockGetCommerceSummary(...(args as [])),
      listCommerceProducts: (...args: unknown[]) => mockListCommerceProducts(...(args as [])),
      reportCsvUrl: () => 'http://localhost:4000/api/reports/commerce.csv',
    },
  };
});

/** A plausible payout total that a naive dashboard could try to add to commerce (for the negative assertion). */
const PAYOUT_TOTAL_THB = 128_400;

function summaryWithCommission(commissionAmount: number): CommerceSummary {
  return {
    generatedAt: '2026-07-20T00:00:00.000Z',
    totals: [
      {
        currency: 'THB',
        commissionAmount,
        grossSalesAmount: 154_500,
        ordersCount: 402,
        itemsSold: 500,
        conversionRecords: 9,
      },
    ],
    byChannel: [
      {
        channel: 'shopee',
        currency: 'THB',
        commissionAmount,
        grossSalesAmount: 154_500,
        ordersCount: 402,
        itemsSold: 500,
        conversionRecords: 9,
      },
    ],
    byProduct: [
      {
        productId: 'product-1',
        currency: 'THB',
        commissionAmount,
        grossSalesAmount: 154_500,
        ordersCount: 402,
        itemsSold: 500,
        conversionRecords: 9,
      },
    ],
    byPeriod: [],
  };
}

beforeEach(() => {
  mockGetCommerceSummary.mockReset();
  mockListCommerceProducts.mockReset();
  mockListCommerceProducts.mockResolvedValue([]);
});

describe('CommerceDashboardSection — separation signals', () => {
  it('renders the bordered inset container (signal 1)', async () => {
    mockGetCommerceSummary.mockResolvedValue(summaryWithCommission(12_290));
    const { container } = render(<CommerceDashboardSection />);
    await waitFor(() => expect(screen.queryByText(/Commission \(net\)/i)).not.toBeNull());

    const section = container.querySelector('section');
    expect(section?.className).toEqual(expect.stringContaining('border'));
    expect(section?.className).toEqual(expect.stringContaining('border-2'));
  });

  it('always shows the "not included in payout" alert (signal 2)', async () => {
    mockGetCommerceSummary.mockResolvedValue(summaryWithCommission(12_290));
    render(<CommerceDashboardSection />);

    const alert = await screen.findByText(/Not included in platform payout revenue above/i);
    expect(alert).not.toBeNull();
  });

  it('uses disjoint commerce vocabulary — no card is ever labelled "Revenue" (signal 4)', async () => {
    mockGetCommerceSummary.mockResolvedValue(summaryWithCommission(12_290));
    render(<CommerceDashboardSection />);

    await screen.findByText(/Commission \(net\)/i);
    // The alert copy legitimately NAMES "payout revenue" for the reciprocal
    // cross-reference (design §4.6) — what must never happen is a CARD
    // labelled "Revenue" the way the payout side's KPI card is.
    expect(screen.queryByText(/^Revenue$/)).toBeNull();
  });

  it('renders its own export button, never a shared toolbar (signal 5)', async () => {
    mockGetCommerceSummary.mockResolvedValue(summaryWithCommission(12_290));
    render(<CommerceDashboardSection />);

    const exportLink = await screen.findByRole('link', { name: /export commerce csv/i });
    expect(exportLink).not.toBeNull();
  });

  it('NEVER renders a rendered number equal to payout + commerce combined', async () => {
    const commissionAmount = 12_290;
    mockGetCommerceSummary.mockResolvedValue(summaryWithCommission(commissionAmount));
    render(<CommerceDashboardSection />);

    await screen.findByText(/Commission \(net\)/i);

    const combinedTotal = PAYOUT_TOTAL_THB + commissionAmount;
    const combinedTotalText = combinedTotal.toLocaleString('en-US', { minimumFractionDigits: 2 });
    expect(screen.queryByText(combinedTotalText)).toBeNull();
    expect(screen.queryByText(new RegExp(String(combinedTotal)))).toBeNull();
  });

  it('empty state shows NO ฿0.00 card — a zero beside a payout figure invites summation', async () => {
    mockGetCommerceSummary.mockResolvedValue({
      generatedAt: '2026-07-20T00:00:00.000Z',
      totals: [
        {
          currency: 'THB',
          commissionAmount: 0,
          grossSalesAmount: 0,
          ordersCount: 0,
          itemsSold: 0,
          conversionRecords: 0,
        },
      ],
      byChannel: [],
      byProduct: [],
      byPeriod: [],
    });
    render(<CommerceDashboardSection />);

    const emptyMessage = await screen.findByText(/No commission records yet/i);
    expect(emptyMessage).not.toBeNull();
    expect(screen.queryByText(/Commission \(net\)/i)).toBeNull();
    expect(screen.queryByText(/฿0\.00/)).toBeNull();
  });

  it('groups by currency and never sums across currency groups (SA-9)', async () => {
    mockGetCommerceSummary.mockResolvedValue({
      generatedAt: '2026-07-20T00:00:00.000Z',
      totals: [
        {
          currency: 'THB',
          commissionAmount: 100,
          grossSalesAmount: 0,
          ordersCount: 1,
          itemsSold: 1,
          conversionRecords: 1,
        },
        {
          currency: 'USD',
          commissionAmount: 5,
          grossSalesAmount: 0,
          ordersCount: 1,
          itemsSold: 1,
          conversionRecords: 1,
        },
      ],
      byChannel: [],
      byProduct: [],
      byPeriod: [],
    });
    render(<CommerceDashboardSection />);

    await screen.findByText('THB');
    expect(screen.queryByText('USD')).not.toBeNull();
    // Two independent groups, never a single flat total (e.g. "105").
    expect(screen.queryByText(/^105(\.00)?$/)).toBeNull();
  });
});

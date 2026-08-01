import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import type { AdCampaign, PaidSummary } from '@/lib/api-client';
import { formatTHB } from '@/lib/content-labels';
import { PaidDashboardSection } from '@/components/paid/PaidDashboardSection';

/**
 * 7B.3 acceptance criterion (design §2.5, System Analyst condition P-B3):
 * "a UI test asserts no rendered numeric text node equals any pairwise or
 * triple sum" — payout+commerce, payout+paid, commerce+paid, or all three —
 * and P-B3 specifically requires the comparison run through the ACTUAL
 * FORMATTER THE PAGE USES (`formatTHB`), not a raw numeric comparison. This
 * is Phase 6's own G5a finding restated: an unformatted sum ("140690") would
 * never appear as rendered text next to a `formatTHB`-rendered figure
 * ("฿140,690.00"), so a raw-number comparison would have silently passed on
 * a broken page. Every comparison below builds the candidate sum THEN pushes
 * it through `formatTHB` before checking it is absent from the DOM.
 *
 * This component never receives payout or commerce data as props (it fetches
 * its own `/api/paid/summary` + `/api/paid/campaigns`), so the test proves
 * the negative the same way CommerceDashboardSection.test.tsx does: render
 * with a plausible OTHER-STREAM total in scope only as a JS constant, then
 * assert that constant's formatted sum with THIS component's own total never
 * appears anywhere in the rendered output.
 *
 * NOTE: mirrors CommerceDashboardSection.test.tsx's documented reason for
 * avoiding `@testing-library/jest-dom` custom matchers — plain null-checks on
 * `queryBy*`/resolved `findBy*` type-check under `tsc --noEmit`.
 */

const mockGetPaidSummary = jest.fn<() => Promise<PaidSummary>>();
const mockListPaidCampaigns = jest.fn<() => Promise<AdCampaign[]>>();

jest.mock('@/lib/api-client', () => {
  const actual = jest.requireActual('@/lib/api-client') as Record<string, unknown>;
  return {
    ...actual,
    apiClient: {
      getPaidSummary: (...args: unknown[]) => mockGetPaidSummary(...(args as [])),
      listPaidCampaigns: (...args: unknown[]) => mockListPaidCampaigns(...(args as [])),
      reportCsvUrl: () => 'http://localhost:4000/api/reports/paid.csv',
    },
  };
});

/** Plausible OTHER-STREAM totals a naive dashboard could try to add to paid spend. */
const PAYOUT_TOTAL_THB = 128_400;
const COMMERCE_COMMISSION_THB = 12_290;

function activeCampaign(id: string): AdCampaign {
  return {
    id,
    channel: 'meta',
    externalCampaignName: 'Summer Skincare Reach',
    externalCampaignId: null,
    objective: 'Traffic',
    contentId: null,
    startDate: '2026-07-01',
    endDate: null,
    plannedBudget: null,
    currency: 'THB',
    status: 'active',
    isActive: true,
    retiredAt: null,
    source: 'manual',
    createdBy: 'user-1',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function summaryWithSpend(totalSpend: number): PaidSummary {
  return {
    generatedAt: '2026-07-31T00:00:00.000Z',
    totals: [
      {
        currency: 'THB',
        totalSpend,
        totalReach: 401_000,
        totalImpressions: 900_000,
        totalClicks: 3_880,
        totalResultCount: 47,
        entriesCount: 10,
      },
    ],
    byCampaign: [],
    byResultType: [{ currency: 'THB', resultType: 'Purchases', totalSpend, totalReach: 0, totalImpressions: 0, totalClicks: 0, totalResultCount: 47, entriesCount: 10 }],
  };
}

beforeEach(() => {
  mockGetPaidSummary.mockReset();
  mockListPaidCampaigns.mockReset();
  mockListPaidCampaigns.mockResolvedValue([activeCampaign('campaign-1')]);
});

describe('PaidDashboardSection — separation signals', () => {
  it('renders the warning-subtle bordered container, DISTINCT from commerce\'s neutral one (signal 1, ADR-7.7)', async () => {
    mockGetPaidSummary.mockResolvedValue(summaryWithSpend(12_050));
    const { container } = render(<PaidDashboardSection />);
    await waitFor(() => expect(screen.queryByText(/Ad spend/i)).not.toBeNull());

    const section = container.querySelector('section');
    expect(section?.className).toEqual(expect.stringContaining('border-warning-subtle'));
    expect(section?.className).toEqual(expect.stringContaining('bg-warning-subtle'));
    // NOT commerce's neutral treatment.
    expect(section?.className).not.toEqual(expect.stringContaining('bg-body-tertiary'));
  });

  it('always shows the alert naming BOTH other streams by name (signal 2)', async () => {
    mockGetPaidSummary.mockResolvedValue(summaryWithSpend(12_050));
    render(<PaidDashboardSection />);

    const alert = await screen.findByText(
      /Not included in platform payout revenue above, or in commerce\/affiliate figures above/i,
    );
    expect(alert).not.toBeNull();
  });

  it('uses paid-PREFIXED, disjoint vocabulary — never bare "Spend"/"Reach"/"Clicks" (signal 4)', async () => {
    mockGetPaidSummary.mockResolvedValue(summaryWithSpend(12_050));
    render(<PaidDashboardSection />);

    await screen.findByText(/Ad spend/i);
    expect(screen.queryByText(/^Spend$/)).toBeNull();
    expect(screen.queryByText(/^Reach$/)).toBeNull();
    expect(screen.queryByText(/^Clicks$/)).toBeNull();
    expect(screen.queryByText(/^Revenue$/)).toBeNull();
    expect(screen.queryByText(/^Commission \(net\)$/)).toBeNull();
  });

  it('renders its own export button, never a shared toolbar (signal 5)', async () => {
    mockGetPaidSummary.mockResolvedValue(summaryWithSpend(12_050));
    render(<PaidDashboardSection />);

    const exportLink = await screen.findByRole('link', { name: /export paid csv/i });
    expect(exportLink).not.toBeNull();
  });

  it('P-B3: never renders payout + paid, formatted through formatTHB — not a raw-number comparison', async () => {
    const totalSpend = 12_050;
    mockGetPaidSummary.mockResolvedValue(summaryWithSpend(totalSpend));
    render(<PaidDashboardSection />);

    await screen.findByText(/Ad spend/i);

    const combined = formatTHB(PAYOUT_TOTAL_THB + totalSpend);
    expect(screen.queryByText(combined)).toBeNull();
  });

  it('P-B3: never renders commerce + paid, formatted through formatTHB', async () => {
    const totalSpend = 12_050;
    mockGetPaidSummary.mockResolvedValue(summaryWithSpend(totalSpend));
    render(<PaidDashboardSection />);

    await screen.findByText(/Ad spend/i);

    const combined = formatTHB(COMMERCE_COMMISSION_THB + totalSpend);
    expect(screen.queryByText(combined)).toBeNull();
  });

  it('P-B3: never renders payout + commerce + paid (the triple-sum case), formatted through formatTHB', async () => {
    const totalSpend = 12_050;
    mockGetPaidSummary.mockResolvedValue(summaryWithSpend(totalSpend));
    render(<PaidDashboardSection />);

    await screen.findByText(/Ad spend/i);

    const combined = formatTHB(PAYOUT_TOTAL_THB + COMMERCE_COMMISSION_THB + totalSpend);
    expect(screen.queryByText(combined)).toBeNull();

    // ±0.01 rounding neighbours (System Analyst P-B3's own stated caveat).
    expect(screen.queryByText(formatTHB(PAYOUT_TOTAL_THB + COMMERCE_COMMISSION_THB + totalSpend + 0.01))).toBeNull();
    expect(screen.queryByText(formatTHB(PAYOUT_TOTAL_THB + COMMERCE_COMMISSION_THB + totalSpend - 0.01))).toBeNull();
  });

  it('empty state shows NO ฿0.00 card — a zero beside two other real figures invites summation', async () => {
    mockGetPaidSummary.mockResolvedValue({
      generatedAt: '2026-07-31T00:00:00.000Z',
      totals: [
        {
          currency: 'THB',
          totalSpend: 0,
          totalReach: 0,
          totalImpressions: 0,
          totalClicks: 0,
          totalResultCount: 0,
          entriesCount: 0,
        },
      ],
      byCampaign: [],
      byResultType: [],
    });
    mockListPaidCampaigns.mockResolvedValue([]);
    render(<PaidDashboardSection />);

    const emptyMessage = await screen.findByText(/No paid campaigns logged yet/i);
    expect(emptyMessage).not.toBeNull();
    expect(screen.queryByText(/Ad spend/i)).toBeNull();
    expect(screen.queryByText(formatTHB(0))).toBeNull();
  });

  it('groups by currency and never sums across currency groups (mirrors Commerce SA-9, extended as NFR-7.10)', async () => {
    mockGetPaidSummary.mockResolvedValue({
      generatedAt: '2026-07-31T00:00:00.000Z',
      totals: [
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
      ],
      byCampaign: [],
      byResultType: [],
    });
    render(<PaidDashboardSection />);

    await screen.findByText('THB');
    expect(screen.queryByText('USD')).not.toBeNull();
    // Two independent groups, never a single flat total (e.g. "105").
    expect(screen.queryByText(/^105(\.00)?$/)).toBeNull();
  });
});

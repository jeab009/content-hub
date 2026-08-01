'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient, ApiError, type AdCampaign, type PaidCurrencyTotal, type PaidSummary } from '@/lib/api-client';
import { countActiveCampaigns, isPaidSummaryEmpty } from '@/lib/paid-logic';
import { formatCount, formatTHB } from '@/lib/content-labels';
import { PaidExportCsvButton } from '@/components/paid/PaidExportCsvButton';

/**
 * The paid dashboard section (7B.3) — this phase's R1 separation surface
 * (architecture doc §4.4), one notch harder than Commerce's: a person
 * glancing at the page for two seconds must not come away thinking any two
 * of the three numbers (payout / commerce / paid) belong together, AND must
 * not mistake this section for a re-skinned commerce section.
 *
 * Built LAST (7B.3, after 7B.1/7B.2), against the real backend (its own
 * `GET /api/paid/summary` + `GET /api/paid/campaigns` calls — never props
 * from the dashboard page), mirroring exactly why CommerceDashboardSection
 * was built last in 6B.5: judging "visually unmistakable, three-way"
 * separation against stub data would not be honest.
 *
 * Six independent separation signals (design §4.4), extended and made
 * harder than Commerce's:
 *   1. A genuinely DIFFERENT Bootstrap colour treatment from Commerce's
 *      neutral `bg-body-tertiary` — `border-warning-subtle`/`bg-warning-subtle`
 *      (ADR-7.7), the same "subtle" palette `CopyrightGatePanel.tsx` already
 *      uses, not a re-skin with different words.
 *   2. Always-visible alert naming BOTH other streams by name.
 *   3. (The reciprocal half lives in CommerceDashboardSection's own alert —
 *      see the one-line edit there, SA-P7.)
 *   4. Disjoint, paid-PREFIXED vocabulary: "Ad spend"/"Ad reach"/"Ad clicks",
 *      never bare "Spend"/"Reach"/"Clicks" — so a card here is never one
 *      glance away from looking like the payout section's card repeated.
 *   5. Its own export button, never a shared toolbar.
 *   6. Rendered by the caller (`dashboard/page.tsx`) strictly BELOW both the
 *      payout AND commerce sections — vertical stacking only, this
 *      component never renders itself side-by-side with anything, and this
 *      component does its OWN data fetching so no file ever has payout,
 *      commerce, AND paid summaries in scope together (ADR-7.1).
 */
export function PaidDashboardSection(): JSX.Element {
  const [summary, setSummary] = useState<PaidSummary | null>(null);
  const [activeCampaignCount, setActiveCampaignCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const [paidSummary, campaigns] = await Promise.all([
          apiClient.getPaidSummary(),
          apiClient.listPaidCampaigns({ isActive: true }).catch((): AdCampaign[] => []),
        ]);
        if (cancelled) return;
        setSummary(paidSummary);
        setActiveCampaignCount(countActiveCampaigns(campaigns));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load paid data.');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section
      aria-labelledby="paid-heading"
      className="border border-2 border-warning-subtle rounded-3 p-4 bg-warning-subtle mt-4"
    >
      <div className="d-flex justify-content-between align-items-start mb-2">
        <h2 id="paid-heading" className="h5 mb-0">
          Paid / Ads — tracked separately
        </h2>
        <Link href="/paid" className="small">
          Manage in Paid →
        </Link>
      </div>

      <div className="alert alert-info py-2 mb-3" role="note">
        Not included in platform payout revenue above, or in commerce/affiliate figures above. Paid
        spend and results are logged manually from Meta Ads Manager and never added to either.
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      {isLoading ? (
        <p className="text-muted small mb-0">Loading…</p>
      ) : isPaidSummaryEmpty(summary) ? (
        <p className="text-muted mb-0">
          No paid campaigns logged yet. Add one from <Link href="/paid">Paid → + Add campaign</Link>,
          then log performance after your first Ads Manager check.
        </p>
      ) : (
        summary && (
          <>
            {summary.totals.map((totalRow) => (
              <CurrencyGroup
                key={totalRow.currency}
                total={totalRow}
                activeCampaignCount={activeCampaignCount}
                multipleCurrencies={summary.totals.length > 1}
              />
            ))}

            <div className="row small text-muted mb-2">
              <div className="col-12">
                <span className="fw-semibold">Results (all types)</span>{' '}
                {summary.byResultType.length === 0
                  ? '—'
                  : summary.byResultType
                      .filter((item) => item.resultType !== null)
                      .map((item) => `${item.resultType} ${formatCount(item.totalResultCount)}`)
                      .join(' · ') || '—'}
              </div>
            </div>

            <p className="small text-muted">
              Logged by hand from Meta Ads Manager — not measured by Content Hub.
            </p>
          </>
        )
      )}

      <div className="d-flex justify-content-end mt-2">
        <PaidExportCsvButton label="Export paid CSV" disabled={isPaidSummaryEmpty(summary)} />
      </div>
    </section>
  );
}

/**
 * One currency's KPI row. `multipleCurrencies` only changes the heading —
 * the numbers themselves are NEVER summed across currency groups (mirrors
 * Commerce's SA-9 posture, NFR-7.10 for paid): each group renders its own
 * independent row of cards. `activeCampaignCount` is currency-independent
 * (a campaign count, not a money figure) so it repeats identically per group.
 */
function CurrencyGroup({
  total,
  activeCampaignCount,
  multipleCurrencies,
}: {
  total: PaidCurrencyTotal;
  activeCampaignCount: number;
  multipleCurrencies: boolean;
}): JSX.Element {
  return (
    <div className="mb-3">
      {multipleCurrencies && <p className="small fw-semibold mb-2">{total.currency}</p>}
      <div className="row g-3">
        <PaidKpiCard label="Ad spend" value={formatTHB(total.totalSpend)} />
        <PaidKpiCard label="Ad reach" value={formatCount(total.totalReach)} />
        <PaidKpiCard label="Ad clicks" value={formatCount(total.totalClicks)} />
        <PaidKpiCard label="Campaigns" value={`${activeCampaignCount} active`} />
      </div>
    </div>
  );
}

function PaidKpiCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    // col-12 below `sm` (BUG-P5-01 lesson, mirrored from CommerceKpiCard: a
    // currency value can wrap mid-number in a narrow card at 375px).
    <div className="col-12 col-sm-6 col-lg-3">
      <div className="card h-100">
        <div className="card-body">
          <p className="text-muted small text-uppercase mb-1">{label}</p>
          <p className="fs-5 fw-semibold mb-0 text-nowrap">{value}</p>
        </div>
      </div>
    </div>
  );
}

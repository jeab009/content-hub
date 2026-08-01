'use client';

import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import Link from 'next/link';
import {
  apiClient,
  ApiError,
  type CommerceCurrencyTotal,
  type CommerceSummary,
} from '@/lib/api-client';
import { isCommerceSummaryEmpty } from '@/lib/commerce-logic';
import { labels } from '@/lib/content-labels';
import { CommerceExportCsvButton } from '@/components/commerce/CommerceExportCsvButton';

/**
 * The commerce dashboard section (6B.5) — the design's R1 separation
 * surface (architecture doc §4.6). Built LAST, against the real backend
 * (its own `GET /api/commerce/summary` call — never props from the payout
 * page), for two reasons at once:
 *
 * 1. Design sequencing: judging "visually unmistakable separation" against
 *    stub data would not be honest (§5, "6B — Frontend", step 6).
 * 2. Structural separation: this component does its OWN data fetching, so
 *    the payout dashboard page NEVER has both a `DashboardOverview` and a
 *    `CommerceSummary` in scope in the same file — there is no JSX
 *    expression in `dashboard/page.tsx` that could add the two together,
 *    because it never imports this module in the first place (loaded via
 *    `next/dynamic` — see dashboard/page.tsx). No shared component, no
 *    shared props type, no combined total anywhere (ADR-6.8).
 *
 * Six independent separation signals, all present at once so no single CSS
 * or copy change collapses the boundary:
 *   1. The only bordered, inset container on the page (`border border-2`).
 *   2. Always-visible alert: "Not included in platform payout revenue above."
 *   3. (Reciprocal half lives on the payout side — see dashboard/page.tsx.)
 *   4. Disjoint vocabulary: "Commission"/"Gross sales", never "Revenue".
 *   5. Its own export button, never a shared toolbar.
 *   6. Rendered by the caller in a block below the payout section —
 *      VERTICAL stacking only, this component never renders itself
 *      side-by-side with anything.
 */
export function CommerceDashboardSection(): JSX.Element {
  const [summary, setSummary] = useState<CommerceSummary | null>(null);
  const [productNames, setProductNames] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const [commerceSummary, products] = await Promise.all([
          apiClient.getCommerceSummary(),
          apiClient.listCommerceProducts().catch(() => []),
        ]);
        if (cancelled) return;
        setSummary(commerceSummary);
        setProductNames(new Map(products.map((p) => [p.id, p.name])));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load commerce data.');
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
      aria-labelledby="commerce-heading"
      className="border border-2 rounded-3 p-4 bg-body-tertiary mt-4"
    >
      <div className="d-flex justify-content-between align-items-start mb-2">
        <h2 id="commerce-heading" className="h5 mb-0">
          Commerce / Affiliate — tracked separately
        </h2>
        <Link href="/commerce/conversions" className="small">
          Manage in Commerce →
        </Link>
      </div>

      <div className="alert alert-info py-2 mb-3" role="note">
        Not included in platform payout revenue above, or in the paid/ads section below. These
        figures measure different things and are never added together anywhere in Content Hub.
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      {isLoading ? (
        <p className="text-muted small mb-0">Loading…</p>
      ) : isCommerceSummaryEmpty(summary) ? (
        <p className="text-muted mb-0">
          No commission records yet. Add them from{' '}
          <Link href="/commerce/conversions">Commerce → Conversions</Link> after your first payout
          statement.
        </p>
      ) : (
        summary && (
          <>
            {summary.totals.map((totalRow) => (
              <CurrencyGroup
                key={totalRow.currency}
                total={totalRow}
                multipleCurrencies={summary.totals.length > 1}
              />
            ))}

            <div className="row small text-muted mb-2">
              <div className="col-12 mb-1">
                <span className="fw-semibold">By channel</span>{' '}
                {summary.byChannel.length === 0
                  ? '—'
                  : summary.byChannel
                      .map(
                        (item) =>
                          `${labels.channel(item.channel)} ${formatMoney(item.commissionAmount, item.currency)}`,
                      )
                      .join(' · ')}
              </div>
              <div className="col-12">
                <span className="fw-semibold">Top products</span>{' '}
                {summary.byProduct.length === 0
                  ? '—'
                  : topProducts(summary.byProduct, productNames)
                      .map((item) => `${item.name} ${formatMoney(item.commissionAmount, item.currency)}`)
                      .join(' · ')}
              </div>
            </div>

            <p className="small text-muted">
              Entered by hand from payout statements — not measured by Content Hub.
            </p>
          </>
        )
      )}

      <div className="d-flex justify-content-end mt-2">
        <CommerceExportCsvButton label="Export commerce CSV" disabled={isCommerceSummaryEmpty(summary)} />
      </div>
    </section>
  );
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function topProducts(
  byProduct: CommerceSummary['byProduct'],
  productNames: Map<string, string>,
  limit = 3,
): { name: string; commissionAmount: number; currency: string }[] {
  return [...byProduct]
    .sort((a, b) => b.commissionAmount - a.commissionAmount)
    .slice(0, limit)
    .map((item) => ({
      name: item.productId ? (productNames.get(item.productId) ?? item.productId) : 'Unattributed',
      commissionAmount: item.commissionAmount,
      currency: item.currency,
    }));
}

/**
 * One currency's KPI row. `multipleCurrencies` only changes the heading —
 * the numbers themselves are NEVER summed across currency groups (SA-9):
 * each group renders its own independent row of cards.
 */
function CurrencyGroup({
  total,
  multipleCurrencies,
}: {
  total: CommerceCurrencyTotal;
  multipleCurrencies: boolean;
}): JSX.Element {
  return (
    <div className="mb-3">
      {multipleCurrencies && <p className="small fw-semibold mb-2">{total.currency}</p>}
      <div className="row g-3">
        <CommerceKpiCard label="Commission (net)" value={formatMoney(total.commissionAmount, total.currency)} />
        <CommerceKpiCard label="Gross sales" value={formatMoney(total.grossSalesAmount, total.currency)} />
        <CommerceKpiCard label="Orders" value={String(total.ordersCount)} />
        <CommerceKpiCard label="Records" value={String(total.conversionRecords)} />
      </div>
    </div>
  );
}

function CommerceKpiCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    // col-12 below the `sm` breakpoint (BUG-P5-01 lesson: a currency value
    // like "THB 51,500.00" wraps mid-number in a 160px-wide `col-6` card at
    // 375px — verified with a real browser, not assumed). Full width up to
    // 576px avoids the wrap; 2-up from `sm`, 4-up from `lg` matches the
    // payout KpiCard grid's rhythm without reusing its component (ADR-6.8).
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

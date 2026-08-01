'use client';

import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  apiClient,
  ApiError,
  type CurrentUser,
  type DashboardOverview,
  type DashboardRevenue,
  type PlatformBreakdownItem,
  type SyncResult,
} from '@/lib/api-client';
import { formatCount, formatTHB, labels } from '@/lib/content-labels';
import { AppHeader } from '@/components/AppHeader';
import { TrendChart } from '@/components/dashboard/TrendChart';
import { ExportCsvButton } from '@/components/reports/ExportCsvButton';

/**
 * Loaded via `next/dynamic` rather than a static `import` — deliberately.
 * The commerce/payout ESLint zone (frontend/.eslintrc.js) bans every file
 * under `src/app/dashboard/**` from a static import of anything under
 * `components/commerce/**`, precisely so this file can never end up with
 * both a `DashboardOverview` and a `CommerceSummary` in scope to add
 * together. `next/dynamic` is not a loophole in that rule — the component
 * fetches its OWN data (`GET /api/commerce/summary`) and receives no props
 * from this page, so the two datasets are never both in memory here, static
 * import or not (design §4.6 / ADR-6.8: no shared component, no combined
 * total anywhere).
 */
const CommerceDashboardSection = dynamic(
  () => import('@/components/commerce/CommerceDashboardSection').then((m) => m.CommerceDashboardSection),
  { ssr: false, loading: () => <p className="text-muted small mt-4">Loading commerce data…</p> },
);

/**
 * Phase 7 — same reasoning as CommerceDashboardSection above, one stream
 * further. The three-way ESLint zone (frontend/.eslintrc.js, Phase 7) bans
 * every file under `src/app/dashboard/**` from a static import of anything
 * under `components/paid/**`, so this page can never end up with a
 * `DashboardOverview`, a `CommerceSummary`, AND a `PaidSummary` all in scope
 * at once (design §4.4 / ADR-7.1). Rendered LAST in stacking order —
 * Payout → Commerce → Paid (design §4.4 signal 6).
 */
const PaidDashboardSection = dynamic(
  () => import('@/components/paid/PaidDashboardSection').then((m) => m.PaidDashboardSection),
  { ssr: false, loading: () => <p className="text-muted small mt-4">Loading paid/ads data…</p> },
);

export default function DashboardPage(): JSX.Element {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [revenue, setRevenue] = useState<DashboardRevenue | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  const loadData = useCallback(async () => {
    const [overviewData, revenueData] = await Promise.all([
      apiClient.getDashboardOverview(),
      apiClient.getDashboardRevenue(),
    ]);
    setOverview(overviewData);
    setRevenue(revenueData);
  }, []);

  const loadInitial = useCallback(async () => {
    try {
      const [currentUser, csrf] = await Promise.all([apiClient.me(), apiClient.getCsrfToken()]);
      setUser(currentUser);
      setCsrfToken(csrf.csrfToken);
      await loadData();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }
      setError('Failed to load the dashboard.');
    } finally {
      setIsLoading(false);
    }
  }, [router, loadData]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  async function handleSync(): Promise<void> {
    if (!csrfToken) return;
    setError(null);
    setSyncResult(null);
    setIsSyncing(true);
    try {
      const result = await apiClient.syncMetrics(csrfToken);
      setSyncResult(result);
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Metric sync failed.');
    } finally {
      setIsSyncing(false);
    }
  }

  if (isLoading) {
    return <p>Loading…</p>;
  }

  return (
    <div>
      <AppHeader>
        {user && <span className="text-muted small">{user.email}</span>}
      </AppHeader>

      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h1 className="h3 mb-0">Dashboard</h1>
          {overview && (
            <span className="text-muted small">
              Generated {new Date(overview.generatedAt).toLocaleString()}
            </span>
          )}
        </div>
        <div className="d-flex align-items-center gap-2">
          <ExportCsvButton
            report="revenue"
            label="Export revenue (CSV)"
            disabled={!revenue || revenue.byContent.length === 0}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={isSyncing}
            onClick={() => void handleSync()}
          >
            {isSyncing ? 'Syncing…' : 'Sync metrics'}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      {syncResult && (
        <div className="alert alert-info" role="status">
          Sync complete: {syncResult.synced} synced, {syncResult.skipped} skipped,{' '}
          {syncResult.failed} failed (of {syncResult.eligible} eligible posts).
          {syncResult.failed > 0 && (
            <div className="small mt-1">
              Failures often mean a stale platform token — reconnect the account in Settings.
            </div>
          )}
        </div>
      )}

      {overview && (
        <>
          <p className="text-muted small mb-2">
            Monetization payout from Facebook, YouTube, TikTok and LINE OA. This is the figure the
            ranking engine uses.
          </p>
          <div className="row g-3 mb-4">
            <KpiCard label="Payout" value={formatTHB(overview.totals.revenue)} accent="text-success" />
            <KpiCard label="Reach" value={formatCount(overview.totals.reach)} />
            <KpiCard label="Engagement" value={formatCount(overview.totals.engagement)} />
            <KpiCard
              label="Posts with metrics"
              value={`${overview.totals.postsWithMetrics}`}
              sub={`${overview.totals.contentsWithMetrics} content`}
            />
          </div>

          <div className="card mb-4">
            <div className="card-body">
              <h2 className="h6 mb-3">Cumulative revenue</h2>
              <TrendChart points={overview.trend} />
            </div>
          </div>

          <h2 className="h5">Revenue by platform</h2>
          <PlatformTable items={overview.byPlatform} />
        </>
      )}

      {revenue && (
        <>
          <h2 className="h5 mt-4">Revenue by content</h2>
          {revenue.byContent.length === 0 ? (
            <p className="text-muted">No content has metrics yet.</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover align-middle">
                <thead>
                  <tr>
                    <th scope="col">Title</th>
                    <th scope="col">Pillar</th>
                    <th scope="col" className="text-end">
                      Reach
                    </th>
                    <th scope="col" className="text-end">
                      Engagement
                    </th>
                    <th scope="col" className="text-end">
                      Revenue
                    </th>
                    <th scope="col" className="text-end">
                      Detail
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {revenue.byContent.map((row) => (
                    <tr key={row.contentId}>
                      <td>
                        <Link
                          href={`/content/${row.contentId}/edit`}
                          className="text-decoration-none fw-semibold"
                        >
                          {row.title}
                        </Link>
                      </td>
                      <td>{row.contentPillar ? labels.pillar(row.contentPillar) : '—'}</td>
                      <td className="text-end">{formatCount(row.reach)}</td>
                      <td className="text-end">{formatCount(row.engagement)}</td>
                      <td className="text-end fw-semibold">{formatTHB(row.revenue)}</td>
                      <td className="text-end">
                        <Link
                          href={`/dashboard/revenue/${row.contentId}`}
                          className="btn btn-sm btn-outline-primary"
                        >
                          Drill down
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={4} className="text-end">
                      Total revenue
                    </th>
                    <td className="text-end fw-bold">{formatTHB(revenue.totalRevenue)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}

      {/*
        VERTICAL STACKING ONLY (design §4.6 signal 6) — this block renders
        strictly BELOW the payout section above, at every width, never
        side-by-side. Side-by-side reads as comparable-and-summable at every
        width, which is exactly what this whole section exists to prevent —
        see the "three widths" check in phase6-architecture-design.md §4.9,
        especially 768px, where a naive grid most often floats two blocks
        side by side by accident.
      */}
      <CommerceDashboardSection />

      {/*
        Phase 7 — the same vertical-stacking-only rule, one stream further
        (design §4.4 signal 6). Paid renders LAST: Payout → Commerce → Paid,
        each additional stream getting progressively more visual "distance"
        from the core payout metric, an honest reflection of evidentiary
        maturity (payout: measured; commerce: reconciled by hand against a
        statement; paid: self-reported with no vendor-statement or live-sync
        check behind it at all this phase).
      */}
      <PaidDashboardSection />
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}): JSX.Element {
  return (
    <div className="col-6 col-lg-3">
      <div className="card h-100">
        <div className="card-body">
          <p className="text-muted small text-uppercase mb-1">{label}</p>
          <p className={`fs-4 fw-semibold mb-0 ${accent ?? ''}`}>{value}</p>
          {sub && <p className="text-muted small mb-0">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

function PlatformTable({ items }: { items: PlatformBreakdownItem[] }): JSX.Element {
  if (items.length === 0) {
    return <p className="text-muted">No metrics yet.</p>;
  }
  return (
    <div className="table-responsive">
      <table className="table table-sm align-middle">
        <thead>
          <tr>
            <th scope="col">Platform</th>
            <th scope="col" className="text-end">
              Posts
            </th>
            <th scope="col" className="text-end">
              Reach
            </th>
            <th scope="col" className="text-end">
              Engagement
            </th>
            <th scope="col" className="text-end">
              Revenue
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.platform}>
              <td>{labels.postPlatform(item.platform)}</td>
              <td className="text-end">{item.posts}</td>
              <td className="text-end">{formatCount(item.reach)}</td>
              <td className="text-end">{formatCount(item.engagement)}</td>
              <td className="text-end fw-semibold">{formatTHB(item.revenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

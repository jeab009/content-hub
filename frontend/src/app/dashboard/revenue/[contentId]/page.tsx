'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  apiClient,
  ApiError,
  type ContentRevenueDrilldown,
  type CurrentUser,
  type PlatformBreakdownItem,
  type RevenueByPostItem,
} from '@/lib/api-client';
import { formatCount, formatTHB, labels } from '@/lib/content-labels';
import { describeDrilldownError } from '@/lib/revenue-drilldown-logic';
import { AppHeader } from '@/components/AppHeader';
import { TrendChart } from '@/components/dashboard/TrendChart';
import { ExportCsvButton } from '@/components/reports/ExportCsvButton';

/**
 * Per-content revenue drill-down (Phase 5B.3) — the level below the dashboard's
 * "Revenue by content" table: this content split by platform, by post, and
 * over time. Same latest-per-post read-model semantics as the summary above
 * it, so the totals reconcile.
 */
export default function ContentRevenuePage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ contentId: string }>();
  const contentId = params.contentId;

  const [user, setUser] = useState<CurrentUser | null>(null);
  const [drilldown, setDrilldown] = useState<ContentRevenueDrilldown | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadInitial = useCallback(async () => {
    try {
      const [currentUser, data] = await Promise.all([
        apiClient.me(),
        apiClient.getContentRevenue(contentId),
      ]);
      setUser(currentUser);
      setDrilldown(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }
      setError(describeDrilldownError(err));
    } finally {
      setIsLoading(false);
    }
  }, [router, contentId]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  if (isLoading) {
    return <p>Loading…</p>;
  }

  return (
    <div>
      <AppHeader>{user && <span className="text-muted small">{user.email}</span>}</AppHeader>

      <p className="mb-2">
        <Link href="/dashboard" className="text-decoration-none">
          ← Back to dashboard
        </Link>
      </p>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      {drilldown && (
        <>
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-4">
            <div>
              <h1 className="h3 mb-0">{drilldown.title}</h1>
              <span className="text-muted small">
                {labels.type(drilldown.type)}
                {drilldown.contentPillar ? ` · ${labels.pillar(drilldown.contentPillar)}` : ''} ·
                generated {new Date(drilldown.generatedAt).toLocaleString()}
              </span>
            </div>
            <ExportCsvButton
              report="revenue"
              query={{ contentId: drilldown.contentId }}
              label="Export this content’s revenue (CSV)"
              disabled={drilldown.byPost.length === 0}
            />
          </div>

          <div className="row g-3 mb-4">
            <KpiCard label="Revenue" value={formatTHB(drilldown.totals.revenue)} accent="text-success" />
            <KpiCard label="Reach" value={formatCount(drilldown.totals.reach)} />
            <KpiCard label="Engagement" value={formatCount(drilldown.totals.engagement)} />
            <KpiCard label="Posts" value={`${drilldown.totals.posts}`} />
          </div>

          <div className="card mb-4">
            <div className="card-body">
              <h2 className="h6 mb-3">Cumulative revenue for this content</h2>
              <TrendChart points={drilldown.trend} />
            </div>
          </div>

          <h2 className="h5">By platform</h2>
          <PlatformTable items={drilldown.byPlatform} />

          <h2 className="h5 mt-4">By post</h2>
          <PostTable items={drilldown.byPost} />
        </>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}): JSX.Element {
  return (
    <div className="col-6 col-lg-3">
      <div className="card h-100">
        <div className="card-body">
          <p className="text-muted small text-uppercase mb-1">{label}</p>
          <p className={`fs-4 fw-semibold mb-0 ${accent ?? ''}`}>{value}</p>
        </div>
      </div>
    </div>
  );
}

function PlatformTable({ items }: { items: PlatformBreakdownItem[] }): JSX.Element {
  if (items.length === 0) {
    return <p className="text-muted">No metrics for this content yet.</p>;
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

/**
 * The post-level split. Carries publish method and metric source as TEXT
 * badges so a manually-recorded post and a manually-entered metric are both
 * legible without relying on colour.
 */
function PostTable({ items }: { items: RevenueByPostItem[] }): JSX.Element {
  if (items.length === 0) {
    return <p className="text-muted">No published posts with metrics for this content yet.</p>;
  }
  return (
    <div className="table-responsive">
      <table className="table table-hover align-middle">
        <thead>
          <tr>
            <th scope="col">Platform</th>
            <th scope="col">Method</th>
            <th scope="col">External ID</th>
            <th scope="col">Posted at</th>
            <th scope="col">Metric source</th>
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
          {items.map((post) => (
            <tr key={post.postId}>
              <td>{labels.postPlatform(post.platform)}</td>
              <td>
                <span className={`badge ${labels.publishMethodBadgeClass(post.publishMethod)}`}>
                  {labels.publishMethod(post.publishMethod)}
                </span>
              </td>
              <td className="small text-muted">
                {post.externalPostUrl ? (
                  <a href={post.externalPostUrl} target="_blank" rel="noopener noreferrer">
                    {post.externalPostId ?? 'View post'}
                  </a>
                ) : (
                  (post.externalPostId ?? '—')
                )}
              </td>
              <td className="small">
                {post.postedAt ? new Date(post.postedAt).toLocaleString() : '—'}
              </td>
              <td className="small">
                {post.metricSource ? labels.metricSource(post.metricSource) : '—'}
                {post.lastCollectedAt && (
                  <span className="text-muted">
                    {' '}
                    · {new Date(post.lastCollectedAt).toLocaleDateString()}
                  </span>
                )}
              </td>
              <td className="text-end">{formatCount(post.reach)}</td>
              <td className="text-end">{formatCount(post.engagement)}</td>
              <td className="text-end fw-semibold">{formatTHB(post.revenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

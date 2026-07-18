'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  apiClient,
  ApiError,
  type AssetPlatform,
  type CadenceOverviewItem,
  type CurrentUser,
  type RankingScore,
  type ReadyContentOverview,
  type SchedulerOverview,
} from '@/lib/api-client';
import { labels } from '@/lib/content-labels';
import { needsRanking, recommendedScore } from '@/lib/publish-logic';
import { AppHeader } from '@/components/AppHeader';
import { PublishConfirmModal } from '@/components/publish/PublishConfirmModal';

/** The only platforms with a live publish adapter (Phase 2 = FB + YouTube). */
const PUBLISHABLE_PLATFORMS: AssetPlatform[] = ['facebook', 'youtube'];

interface PublishTarget {
  content: ReadyContentOverview;
  /** Full score rows (with reasoning) fetched on demand for the modal. */
  scores: RankingScore[];
}

export default function SchedulerPage(): JSX.Element {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [overview, setOverview] = useState<SchedulerOverview | null>(null);
  const [connectablePlatforms, setConnectablePlatforms] = useState<AssetPlatform[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rankingContentId, setRankingContentId] = useState<string | null>(null);
  const [publishTarget, setPublishTarget] = useState<PublishTarget | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await apiClient.getSchedulerOverview());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }
      setError('Failed to load the scheduler overview.');
    }
  }, [router]);

  const loadInitial = useCallback(async () => {
    try {
      const [currentUser, csrf, accounts] = await Promise.all([
        apiClient.me(),
        apiClient.getCsrfToken(),
        apiClient.listConnectedAccounts(),
      ]);
      setUser(currentUser);
      setCsrfToken(csrf.csrfToken);
      // Connected-account platform values coincide with AssetPlatform for the
      // two publishable targets, so the narrowing filter doubles as the map.
      setConnectablePlatforms(
        accounts
          .filter((account) => account.status === 'connected')
          .map((account) => account.platform as AssetPlatform)
          .filter((platform) => PUBLISHABLE_PLATFORMS.includes(platform)),
      );
      await loadOverview();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }
      setError('Failed to load the scheduler overview.');
    } finally {
      setIsLoading(false);
    }
  }, [router, loadOverview]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  async function handleRank(content: ReadyContentOverview): Promise<void> {
    if (!csrfToken) return;
    setError(null);
    setRankingContentId(content.contentId);
    try {
      await apiClient.rankContent(content.contentId, csrfToken);
      await loadOverview();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to rank content.');
    } finally {
      setRankingContentId(null);
    }
  }

  async function handleOpenPublish(content: ReadyContentOverview): Promise<void> {
    setError(null);
    try {
      const scores = await apiClient.getScores(content.contentId);
      setPublishTarget({ content, scores });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load scores.');
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
        <h1 className="h3 mb-0">Scheduler</h1>
        {overview && (
          <span className="text-muted small">
            Generated {new Date(overview.generatedAt).toLocaleString()}
          </span>
        )}
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      {overview && (
        <>
          <h2 className="h5">Cadence this period</h2>
          {overview.cadence.length === 0 ? (
            <p className="text-muted">No cadence targets configured.</p>
          ) : (
            <div className="row g-3 mb-4">
              {overview.cadence.map((item) => (
                <div className="col-12 col-md-6 col-lg-4" key={item.platform}>
                  <CadenceCard item={item} />
                </div>
              ))}
            </div>
          )}

          <h2 className="h5">Ready to publish</h2>
          {connectablePlatforms.length === 0 && (
            <div className="alert alert-warning" role="alert">
              No connected publishable account. Connect Facebook or YouTube in{' '}
              <Link href="/settings">Settings</Link> to publish.
            </div>
          )}
          {overview.readyContents.length === 0 ? (
            <div className="text-center text-muted border rounded py-5">
              <p className="mb-2">No ready content. Mark content as Ready in the library first.</p>
              <Link href="/content" className="btn btn-outline-primary btn-sm">
                Go to content library
              </Link>
            </div>
          ) : (
            <ReadyContentTable
              contents={overview.readyContents}
              rankingContentId={rankingContentId}
              canPublish={connectablePlatforms.length > 0}
              onRank={(content) => void handleRank(content)}
              onPublish={(content) => void handleOpenPublish(content)}
            />
          )}
        </>
      )}

      {publishTarget && csrfToken && (
        <PublishConfirmModal
          contentId={publishTarget.content.contentId}
          title={publishTarget.content.title}
          scores={publishTarget.scores}
          recommendedPlatform={publishTarget.content.recommendedPlatform}
          connectablePlatforms={connectablePlatforms}
          csrfToken={csrfToken}
          onClose={() => setPublishTarget(null)}
          onPublished={() => void loadOverview()}
        />
      )}
    </div>
  );
}

function CadenceCard({ item }: { item: CadenceOverviewItem }): JSX.Element {
  return (
    <div className="card h-100">
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-start">
          <h3 className="h6 card-title mb-1">{labels.platform(item.platform)}</h3>
          <span className={`badge ${labels.paceBadgeClass(item.status)}`}>
            {labels.pace(item.status)}
          </span>
        </div>
        <p className="mb-1">
          <span className="fs-4 fw-semibold">{item.publishedThisPeriod}</span>
          <span className="text-muted"> / {item.targetPostsPerPeriod} posts this {item.periodUnit}</span>
        </p>
        <p className="small text-muted mb-0">
          {item.remaining} remaining · {new Date(item.periodStart).toLocaleDateString()} –{' '}
          {new Date(item.periodEnd).toLocaleDateString()}
        </p>
      </div>
    </div>
  );
}

interface ReadyContentTableProps {
  contents: ReadyContentOverview[];
  rankingContentId: string | null;
  canPublish: boolean;
  onRank: (content: ReadyContentOverview) => void;
  onPublish: (content: ReadyContentOverview) => void;
}

function ReadyContentTable(props: ReadyContentTableProps): JSX.Element {
  return (
    <div className="table-responsive">
      <table className="table table-hover align-middle">
        <thead>
          <tr>
            <th scope="col">Title</th>
            <th scope="col">Type</th>
            <th scope="col">Pillar</th>
            <th scope="col">Recommended</th>
            <th scope="col">Scores</th>
            <th scope="col" className="text-end">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {props.contents.map((content) => {
            const recommended = recommendedScore(content);
            const isRanking = props.rankingContentId === content.contentId;
            return (
              <tr key={content.contentId}>
                <td>
                  <Link
                    href={`/content/${content.contentId}/edit`}
                    className="text-decoration-none fw-semibold"
                  >
                    {content.title}
                  </Link>
                </td>
                <td>{labels.type(content.type)}</td>
                <td>{content.contentPillar ? labels.pillar(content.contentPillar) : '—'}</td>
                <td>
                  {content.recommendedPlatform ? (
                    <span className="badge bg-primary">
                      {labels.platform(content.recommendedPlatform)}
                      {recommended ? ` · ${recommended.score.toFixed(3)}` : ''}
                    </span>
                  ) : (
                    <span className="text-muted">not ranked</span>
                  )}
                </td>
                <td className="small">
                  {content.latestScores.length === 0 ? (
                    <span className="text-muted">—</span>
                  ) : (
                    content.latestScores
                      .map((row) => `${labels.platform(row.platform)} ${row.score.toFixed(3)}`)
                      .join(' · ')
                  )}
                </td>
                <td className="text-end">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary me-2"
                    disabled={isRanking}
                    onClick={() => props.onRank(content)}
                  >
                    {isRanking ? 'Ranking…' : needsRanking(content) ? 'Rank' : 'Re-rank'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={!props.canPublish}
                    onClick={() => props.onPublish(content)}
                  >
                    Publish…
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

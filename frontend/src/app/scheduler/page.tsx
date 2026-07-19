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
import { ASSET_PLATFORMS, labels } from '@/lib/content-labels';
import {
  isManualRecordPlatform,
  needsRanking,
  recommendedScore,
  toAssetPlatform,
} from '@/lib/publish-logic';
import { AppHeader } from '@/components/AppHeader';
import { PublishConfirmModal } from '@/components/publish/PublishConfirmModal';
import { ManualExternalRecordModal } from '@/components/publish/ManualExternalRecordModal';

/**
 * Platforms the publish pipeline covers. Phase 5A registered mock TikTok and
 * LINE OA adapters, so all four dispatch — but dispatch still requires a
 * connected account, which is why this list is intersected with the admin's
 * connected accounts below rather than used directly.
 */
const PUBLISHABLE_PLATFORMS: AssetPlatform[] = ASSET_PLATFORMS;

interface PublishTarget {
  content: ReadyContentOverview;
  /** Full score rows (with reasoning) fetched on demand for the modal. */
  scores: RankingScore[];
}

type ModalTarget = { kind: 'publish' | 'manual-record' } & PublishTarget;

export default function SchedulerPage(): JSX.Element {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [overview, setOverview] = useState<SchedulerOverview | null>(null);
  const [connectablePlatforms, setConnectablePlatforms] = useState<AssetPlatform[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rankingContentId, setRankingContentId] = useState<string | null>(null);
  const [modalTarget, setModalTarget] = useState<ModalTarget | null>(null);

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
      // Connected accounts carry a `Platform`, not an `AssetPlatform` — the two
      // enums disagree on LINE (`line` vs `line_oa`), so this must go through
      // the real map rather than a cast.
      setConnectablePlatforms(
        accounts
          .filter((account) => account.status === 'connected')
          .map((account) => toAssetPlatform(account.platform))
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

  /** Both modals need the full score rows (with reasoning), so they share a loader. */
  async function handleOpenModal(
    kind: ModalTarget['kind'],
    content: ReadyContentOverview,
  ): Promise<void> {
    setError(null);
    try {
      const scores = await apiClient.getScores(content.contentId);
      setModalTarget({ kind, content, scores });
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
          <p className="text-muted small">
            TikTok and LINE OA have no verified live integration in this build — their normal path
            is “Record external…”: post natively, then record it here so it becomes a tracked post.
          </p>
          {connectablePlatforms.length === 0 && (
            <div className="alert alert-warning" role="alert">
              No connected publishable account, so direct dispatch is unavailable. Connect an
              account in <Link href="/settings">Settings</Link>, or record an externally-published
              post instead.
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
              onPublish={(content) => void handleOpenModal('publish', content)}
              onRecordExternal={(content) => void handleOpenModal('manual-record', content)}
            />
          )}
        </>
      )}

      {modalTarget && csrfToken && modalTarget.kind === 'publish' && (
        <PublishConfirmModal
          contentId={modalTarget.content.contentId}
          title={modalTarget.content.title}
          scores={modalTarget.scores}
          recommendedPlatform={modalTarget.content.recommendedPlatform}
          connectablePlatforms={connectablePlatforms}
          csrfToken={csrfToken}
          onClose={() => setModalTarget(null)}
          onPublished={() => void loadOverview()}
        />
      )}
      {modalTarget && csrfToken && modalTarget.kind === 'manual-record' && (
        <ManualExternalRecordModal
          contentId={modalTarget.content.contentId}
          title={modalTarget.content.title}
          scores={modalTarget.scores}
          recommendedPlatform={modalTarget.content.recommendedPlatform}
          csrfToken={csrfToken}
          onClose={() => setModalTarget(null)}
          onRecorded={() => void loadOverview()}
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
        {isManualRecordPlatform(item.platform) && (
          <p className="small text-muted mb-0 mt-1">Recorded manually — no live integration.</p>
        )}
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
  onRecordExternal: (content: ReadyContentOverview) => void;
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
                    className="btn btn-sm btn-primary me-2"
                    disabled={!props.canPublish}
                    onClick={() => props.onPublish(content)}
                  >
                    Publish…
                  </button>
                  {/* Never disabled by connected accounts: recording an
                      externally-published post needs no adapter and no token. */}
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-primary"
                    onClick={() => props.onRecordExternal(content)}
                  >
                    Record external…
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

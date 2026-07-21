'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  apiClient,
  ApiError,
  type CommerceChannel,
  type CommercePlacement,
  type Content,
  type ContentAsset,
  type ContentStatus,
  type CurrentUser,
} from '@/lib/api-client';
import {
  canSubmitCommercePlacement,
  describeCommerceStepUpError,
  describeDurationHint,
} from '@/lib/commerce-logic';
import { COMMERCE_CHANNELS, labels } from '@/lib/content-labels';
import { AppHeader } from '@/components/AppHeader';
import { CommerceTabs } from '@/components/commerce/CommerceTabs';
import { ModalShell } from '@/components/commerce/ModalShell';
import { AnchorPickerModal } from '@/components/commerce/AnchorPickerModal';

type StatusFilter = '' | 'recorded' | 'removed';

export default function CommercePlacementsPage(): JSX.Element {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [placements, setPlacements] = useState<CommercePlacement[]>([]);
  const [contentTitles, setContentTitles] = useState<Map<string, string>>(new Map());
  const [anchorCounts, setAnchorCounts] = useState<Map<string, number>>(new Map());
  const [channelFilter, setChannelFilter] = useState<CommerceChannel | ''>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [anchorTarget, setAnchorTarget] = useState<CommercePlacement | null>(null);

  const loadPlacements = useCallback(async () => {
    try {
      const rows = await apiClient.listCommercePlacements({
        channel: channelFilter || undefined,
        status: statusFilter || undefined,
      });
      setPlacements(rows);
      const counts = new Map<string, number>();
      await Promise.all(
        rows.map(async (placement) => {
          try {
            const anchors = await apiClient.listPlacementProductAnchors(placement.id);
            counts.set(placement.id, anchors.length);
          } catch {
            // leave uncounted
          }
        }),
      );
      setAnchorCounts(counts);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }
      setError('Failed to load placements.');
    }
  }, [channelFilter, statusFilter, router]);

  const loadInitial = useCallback(async () => {
    try {
      const [currentUser, csrf, contents] = await Promise.all([
        apiClient.me(),
        apiClient.getCsrfToken(),
        apiClient.listContents(),
      ]);
      setUser(currentUser);
      setCsrfToken(csrf.csrfToken);
      setContentTitles(new Map(contents.map((content) => [content.id, content.title])));
      await loadPlacements();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }
      setError('Failed to load placements.');
    } finally {
      setIsLoading(false);
    }
  }, [router, loadPlacements]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    if (!isLoading) void loadPlacements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelFilter, statusFilter]);

  if (isLoading) {
    return <p>Loading…</p>;
  }

  return (
    <div>
      <AppHeader>{user && <span className="text-muted small">{user.email}</span>}</AppHeader>

      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h3 mb-0">Commerce</h1>
        <button type="button" className="btn btn-primary" onClick={() => setShowRecordModal(true)}>
          + Record placement
        </button>
      </div>

      <CommerceTabs active="placements" />

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      <div className="d-flex flex-wrap gap-3 align-items-end mb-3">
        <div>
          <label htmlFor="filter-placement-channel" className="form-label small mb-1">
            Channel
          </label>
          <select
            id="filter-placement-channel"
            className="form-select form-select-sm"
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value as CommerceChannel | '')}
          >
            <option value="">All</option>
            {COMMERCE_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {labels.channel(channel)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="filter-placement-status" className="form-label small mb-1">
            Status
          </label>
          <select
            id="filter-placement-status"
            className="form-select form-select-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="">All</option>
            <option value="recorded">Recorded</option>
            <option value="removed">Removed</option>
          </select>
        </div>
      </div>

      {placements.length === 0 ? (
        <div className="text-center text-muted border rounded py-5">
          <p className="mb-0">
            No placements yet. Publish on Shopee/TikTok Shop yourself, then record it here.
          </p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-hover align-middle">
            <thead>
              <tr>
                <th scope="col">Content</th>
                <th scope="col">Channel</th>
                <th scope="col">External media ID</th>
                <th scope="col">Duration</th>
                <th scope="col">Status</th>
                <th scope="col">Products</th>
                <th scope="col">Placed at</th>
                <th scope="col" className="text-end">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {placements.map((placement) => {
                const count = anchorCounts.get(placement.id) ?? 0;
                return (
                  <tr key={placement.id}>
                    <td className="fw-semibold">
                      {contentTitles.get(placement.contentId) ?? placement.contentId}
                    </td>
                    <td>
                      <span className={`badge ${labels.channelBadgeClass(placement.channel)}`}>
                        {labels.channel(placement.channel)}
                      </span>
                    </td>
                    <td className="small text-muted">
                      {placement.externalUrl ? (
                        <a href={placement.externalUrl} target="_blank" rel="noopener noreferrer">
                          {placement.externalMediaId}
                        </a>
                      ) : (
                        placement.externalMediaId
                      )}
                    </td>
                    <td className="small">
                      {placement.durationSeconds !== null ? `${placement.durationSeconds}s` : '—'}
                    </td>
                    <td>
                      <span className={`badge ${labels.placementStatusBadgeClass(placement.status)}`}>
                        {labels.placementStatus(placement.status)}
                      </span>
                    </td>
                    <td className="small">
                      {count > 0 ? (
                        <span className="badge bg-info text-dark">Anchored ({count})</span>
                      ) : (
                        <span className="badge bg-secondary">No products anchored</span>
                      )}
                    </td>
                    <td className="small">{new Date(placement.placedAt).toLocaleString()}</td>
                    <td className="text-end">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-primary"
                        onClick={() => setAnchorTarget(placement)}
                      >
                        Anchor products
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showRecordModal && csrfToken && (
        <PlacementRecordModal
          csrfToken={csrfToken}
          onClose={() => setShowRecordModal(false)}
          onRecorded={() => {
            setShowRecordModal(false);
            void loadPlacements();
          }}
        />
      )}

      {anchorTarget && csrfToken && (
        <AnchorPickerModal
          heading={`Anchor products · ${contentTitles.get(anchorTarget.contentId) ?? anchorTarget.contentId}`}
          channel={anchorTarget.channel}
          listExisting={() => apiClient.listPlacementProductAnchors(anchorTarget.id)}
          onAnchor={(body) => apiClient.anchorProductsToPlacement(anchorTarget.id, body, csrfToken)}
          onRemove={(anchorId) =>
            apiClient.removePlacementProductAnchor(anchorTarget.id, anchorId, csrfToken)
          }
          onClose={() => setAnchorTarget(null)}
          onSaved={() => {
            setAnchorTarget(null);
            void loadPlacements();
          }}
        />
      )}
    </div>
  );
}

const READY_STATUS: ContentStatus = 'ready';

function PlacementRecordModal(props: {
  csrfToken: string;
  onClose: () => void;
  onRecorded: (placement: CommercePlacement) => void;
}): JSX.Element {
  const [contents, setContents] = useState<Content[]>([]);
  const [assets, setAssets] = useState<ContentAsset[]>([]);
  const [contentId, setContentId] = useState('');
  const [channel, setChannel] = useState<CommerceChannel | ''>('shopee');
  const [sourceAssetId, setSourceAssetId] = useState('');
  const [externalMediaId, setExternalMediaId] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [durationInput, setDurationInput] = useState('');
  const [note, setNote] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CommercePlacement | null>(null);

  useEffect(() => {
    void apiClient
      .listContents({ status: READY_STATUS })
      .then(setContents)
      .catch(() => setContents([]));
  }, []);

  useEffect(() => {
    if (!contentId) {
      setAssets([]);
      return;
    }
    void apiClient
      .listAssets(contentId)
      .then(setAssets)
      .catch(() => setAssets([]));
  }, [contentId]);

  const selectedContent = useMemo(
    () => contents.find((c) => c.id === contentId) ?? null,
    [contents, contentId],
  );

  function applyAsset(assetId: string): void {
    setSourceAssetId(assetId);
    const asset = assets.find((a) => a.id === assetId);
    if (asset && asset.durationSeconds !== null && durationInput.trim() === '') {
      setDurationInput(String(asset.durationSeconds));
    }
  }

  const durationSeconds = durationInput.trim() === '' ? null : Number(durationInput);
  const durationHint = channel !== '' ? describeDurationHint(channel, durationSeconds) : null;
  const canSubmit =
    channel !== '' &&
    canSubmitCommercePlacement({
      contentId,
      channel,
      externalMediaId,
      durationSeconds,
      password,
    });

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    // `canSubmit` already required `channel !== ''` (TS narrows `channel` to
    // CommerceChannel for the rest of this function via aliased-condition CFA).
    if (!canSubmit) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const placement = await apiClient.recordCommercePlacement(
        {
          contentId,
          channel,
          externalMediaId: externalMediaId.trim(),
          externalUrl: externalUrl.trim() || undefined,
          durationSeconds: durationSeconds ?? undefined,
          sourceAssetId: sourceAssetId || undefined,
          password,
          note: note.trim() || undefined,
        },
        props.csrfToken,
      );
      setResult(placement);
      props.onRecorded(placement);
    } catch (err) {
      const described = describeCommerceStepUpError(
        err instanceof ApiError ? { status: err.status, message: err.message } : null,
      );
      setError(described.message);
      if (described.isPasswordError) {
        setPassword('');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ModalShell titleId="placement-record-title" heading="Record Shopee placement" onClose={props.onClose} size="lg">
      {result ? (
        <div>
          <div className="modal-body">
            <div className="alert alert-success" role="status">
              Placement recorded and audited.
            </div>
            <dl className="row mb-0">
              <dt className="col-4">Channel</dt>
              <dd className="col-8">{labels.channel(result.channel)}</dd>
              <dt className="col-4">External media ID</dt>
              <dd className="col-8 text-break">{result.externalMediaId}</dd>
              <dt className="col-4">Duration</dt>
              <dd className="col-8">{result.durationSeconds !== null ? `${result.durationSeconds}s` : '—'}</dd>
            </dl>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-primary" onClick={props.onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)} noValidate>
          <div className="modal-body">
            <div className="alert alert-info py-2" role="note">
              You publish on the channel yourself. This records it here so it can be tracked. Nothing
              is uploaded to the channel by this action.
            </div>

            <div className="mb-3">
              <label htmlFor="placement-content" className="form-label">
                Content <span className="text-danger">*</span>
              </label>
              <select
                id="placement-content"
                className="form-select"
                value={contentId}
                onChange={(e) => setContentId(e.target.value)}
                required
              >
                <option value="">Choose ready content…</option>
                {contents.map((content) => (
                  <option
                    key={content.id}
                    value={content.id}
                    disabled={content.copyrightCleared !== 'cleared'}
                  >
                    {content.title}
                    {content.copyrightCleared !== 'cleared' ? ' (not copyright cleared)' : ''}
                  </option>
                ))}
              </select>
              {selectedContent && selectedContent.copyrightCleared !== 'cleared' && (
                <div className="form-text text-danger">
                  Blocked: this content is not copyright-cleared. Clear it in Content first.
                </div>
              )}
            </div>

            <div className="mb-3">
              <span className="form-label d-block">
                Channel <span className="text-danger">*</span>
              </span>
              {COMMERCE_CHANNELS.map((value) => (
                <div className="form-check form-check-inline" key={value}>
                  <input
                    id={`placement-channel-${value}`}
                    type="radio"
                    className="form-check-input"
                    name="placement-channel"
                    value={value}
                    checked={channel === value}
                    onChange={() => setChannel(value)}
                  />
                  <label className="form-check-label" htmlFor={`placement-channel-${value}`}>
                    {labels.channel(value)}
                  </label>
                </div>
              ))}
            </div>

            {assets.length > 0 && (
              <div className="mb-3">
                <label htmlFor="placement-source-asset" className="form-label">
                  Source asset <span className="text-muted">(optional)</span>
                </label>
                <select
                  id="placement-source-asset"
                  className="form-select"
                  value={sourceAssetId}
                  onChange={(e) => applyAsset(e.target.value)}
                >
                  <option value="">— none —</option>
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {labels.aspect(asset.aspectRatio)} · {asset.mediaUrl.split('/').pop()}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="mb-3">
              <label htmlFor="placement-external-media-id" className="form-label">
                {labels.channel(channel || 'shopee')} video ID <span className="text-danger">*</span>
              </label>
              <input
                id="placement-external-media-id"
                type="text"
                className="form-control"
                value={externalMediaId}
                onChange={(e) => setExternalMediaId(e.target.value)}
                required
              />
            </div>

            <div className="mb-3">
              <label htmlFor="placement-external-url" className="form-label">
                Video URL <span className="text-muted">(optional)</span>
              </label>
              <input
                id="placement-external-url"
                type="url"
                className="form-control"
                placeholder="https://…"
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
              />
            </div>

            <div className="mb-3">
              <label htmlFor="placement-duration" className="form-label">
                Duration (seconds) {channel === 'shopee' && <span className="text-danger">*</span>}
              </label>
              <input
                id="placement-duration"
                type="number"
                min={1}
                max={86_400}
                className="form-control"
                value={durationInput}
                onChange={(e) => setDurationInput(e.target.value)}
                aria-describedby="placement-duration-help"
              />
              <div
                id="placement-duration-help"
                className={`form-text ${
                  durationHint?.kind === 'ok'
                    ? 'text-success'
                    : durationHint?.kind === 'missing' || durationHint?.kind === 'out-of-range'
                      ? 'text-danger'
                      : ''
                }`}
              >
                {durationHint?.message ??
                  'Only Shopee requires a duration (10–60 seconds). Pre-filled from the selected asset where possible.'}
              </div>
            </div>

            <div className="mb-3">
              <label htmlFor="placement-note" className="form-label">
                Note <span className="text-muted">(optional)</span>
              </label>
              <input
                id="placement-note"
                type="text"
                className="form-control"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
                aria-describedby="placement-note-help"
              />
              <div id="placement-note-help" className="form-text">
                Do not enter buyer or order details.
              </div>
            </div>

            <div className="mb-3">
              <label htmlFor="placement-password" className="form-label">
                Confirm with your password <span className="text-danger">*</span>
              </label>
              <input
                id="placement-password"
                type="password"
                className="form-control"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <div className="form-text">Recording a placement is audited, so it re-checks who you are.</div>
            </div>

            {error && (
              <div className="alert alert-danger" role="alert">
                {error}
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary" onClick={props.onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-danger" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? 'Recording…' : 'Record'}
            </button>
          </div>
        </form>
      )}
    </ModalShell>
  );
}

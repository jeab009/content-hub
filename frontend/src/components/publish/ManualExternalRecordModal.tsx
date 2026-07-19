'use client';

import { FormEvent, useMemo, useState } from 'react';
import {
  apiClient,
  ApiError,
  type AssetPlatform,
  type Post,
  type RankingScore,
} from '@/lib/api-client';
import { ASSET_PLATFORMS, labels } from '@/lib/content-labels';
import {
  canSubmitManualRecord,
  isManualRecordPlatform,
  isOverride,
  isValidExternalPostUrl,
} from '@/lib/publish-logic';
import { ScoreReasoning } from '@/components/publish/ScoreReasoning';

interface ManualExternalRecordModalProps {
  contentId: string;
  title: string;
  /** Latest ranking scores (with reasoning) for this content. */
  scores: RankingScore[];
  recommendedPlatform: AssetPlatform | null;
  csrfToken: string;
  onClose: () => void;
  /** Called after the post is recorded so the parent can refresh. */
  onRecorded: (post: Post) => void;
}

/**
 * Maps an ApiError to the user-facing message + whether it is a password
 * error. Same contract as PublishConfirmModal.describeError: a 401 is
 * recoverable IN the modal (clear the password, keep everything else), while
 * every other status is terminal for this attempt.
 */
function describeError(err: unknown): { message: string; isPasswordError: boolean } {
  if (!(err instanceof ApiError)) {
    return { message: 'Something went wrong. Please try again.', isPasswordError: false };
  }
  if (err.status === 401) {
    return { message: `${err.message} — check your password and try again.`, isPasswordError: true };
  }
  if (err.status === 403) {
    return {
      message: 'Access denied — your account is not allowed to record posts.',
      isPasswordError: false,
    };
  }
  if (err.status === 429) {
    return {
      message:
        'Too many attempts. This endpoint allows 5 password attempts per 15 minutes — wait and try again.',
      isPasswordError: false,
    };
  }
  // 400 (validation) and 409 (duplicate active post, or the content failed the
  // copyright gate) both carry a specific backend message worth showing as-is.
  return { message: err.message, isPasswordError: false };
}

/**
 * Records a post the admin already published natively on the platform
 * (Phase 5B.1). This is the delivered publish path for TikTok and LINE OA,
 * where no verifiable live integration exists — see phase5-project-plan.md
 * Decision 1.
 *
 * It carries the same step-up re-auth as a real publish because it has the
 * same consequences: it creates a tracked post, it is audited, and its
 * recommended-vs-selected facts feed ranking v2's override_feedback factor.
 * Those facts are computed server-side and never sent from here.
 */
export function ManualExternalRecordModal(props: ManualExternalRecordModalProps): JSX.Element {
  const { contentId, title, scores, recommendedPlatform, csrfToken } = props;

  const [selected, setSelected] = useState<AssetPlatform>(
    () => recommendedPlatform ?? ASSET_PLATFORMS[0],
  );
  const [externalPostId, setExternalPostId] = useState('');
  const [externalPostUrl, setExternalPostUrl] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Post | null>(null);

  const selectedScore = useMemo(
    () => scores.find((row) => row.platform === selected) ?? null,
    [scores, selected],
  );
  const overriding = isOverride(selected, recommendedPlatform);
  const canSubmit = canSubmitManualRecord({
    selected,
    recommended: recommendedPlatform,
    externalPostId,
    externalPostUrl,
    password,
    overrideReason,
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const post = await apiClient.recordManualExternalPost(
        {
          contentId,
          platform: selected,
          externalPostId: externalPostId.trim(),
          externalPostUrl: externalPostUrl.trim() || undefined,
          password,
          overrideReason: overriding && overrideReason.trim() ? overrideReason.trim() : undefined,
        },
        csrfToken,
      );
      setResult(post);
      props.onRecorded(post);
    } catch (err) {
      const described = describeError(err);
      setError(described.message);
      if (described.isPasswordError) {
        setPassword('');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      className="modal d-block"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-record-title"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
    >
      <div className="modal-dialog modal-lg modal-dialog-scrollable">
        <div className="modal-content">
          <div className="modal-header">
            <h2 className="modal-title h5" id="manual-record-title">
              Record external post — “{title}”
            </h2>
            <button type="button" className="btn-close" aria-label="Close" onClick={props.onClose} />
          </div>
          {result ? (
            <RecordResult post={result} onClose={props.onClose} />
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} noValidate>
              <div className="modal-body">
                <div className="alert alert-info py-2" role="note">
                  Records a post you already published on the platform. It becomes a tracked post —
                  metrics and comments attach to it, and it counts toward cadence and ranking.
                </div>

                <RecommendationSummary
                  recommendedPlatform={recommendedPlatform}
                  selectedScore={selectedScore}
                />

                <div className="mb-3">
                  <label htmlFor="manual-platform" className="form-label">
                    Platform you posted on <span className="text-danger">*</span>
                  </label>
                  <select
                    id="manual-platform"
                    className="form-select"
                    value={selected}
                    onChange={(e) => setSelected(e.target.value as AssetPlatform)}
                  >
                    {ASSET_PLATFORMS.map((platform) => (
                      <option key={platform} value={platform}>
                        {labels.platform(platform)}
                        {platform === recommendedPlatform ? ' (recommended)' : ''}
                      </option>
                    ))}
                  </select>
                  {isManualRecordPlatform(selected) && (
                    <div className="form-text">
                      {labels.platform(selected)} has no verified live integration in this build —
                      recording manually is its normal publish path.
                    </div>
                  )}
                  {overriding && (
                    <div className="form-text text-warning-emphasis">
                      Override: this is not the recommended platform. A reason is required below.
                    </div>
                  )}
                </div>

                <div className="mb-3">
                  <label htmlFor="manual-external-id" className="form-label">
                    Platform post ID <span className="text-danger">*</span>
                  </label>
                  <input
                    id="manual-external-id"
                    type="text"
                    className="form-control"
                    value={externalPostId}
                    onChange={(e) => setExternalPostId(e.target.value)}
                    required
                  />
                </div>

                <div className="mb-3">
                  <label htmlFor="manual-external-url" className="form-label">
                    Post URL <span className="text-muted">(optional)</span>
                  </label>
                  <input
                    id="manual-external-url"
                    type="url"
                    className="form-control"
                    placeholder="https://…"
                    value={externalPostUrl}
                    onChange={(e) => setExternalPostUrl(e.target.value)}
                    aria-describedby="manual-external-url-help"
                  />
                  <div id="manual-external-url-help" className="form-text">
                    {isValidExternalPostUrl(externalPostUrl)
                      ? 'A LINE OA broadcast has a message ID but no public permalink — leave blank if there is none.'
                      : 'Enter a full URL starting with http:// or https://.'}
                  </div>
                </div>

                {overriding && (
                  <div className="mb-3">
                    <label htmlFor="manual-override-reason" className="form-label">
                      Override reason <span className="text-danger">*</span>
                    </label>
                    <textarea
                      id="manual-override-reason"
                      className="form-control"
                      rows={2}
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      required
                    />
                  </div>
                )}

                <div className="mb-3">
                  <label htmlFor="manual-password" className="form-label">
                    Your password (step-up re-auth) <span className="text-danger">*</span>
                  </label>
                  <input
                    id="manual-password"
                    type="password"
                    className="form-control"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
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
                  {isSubmitting ? 'Recording…' : 'Record post'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

/** Shows what the ranking recommends, so an override is a visible choice. */
function RecommendationSummary(props: {
  recommendedPlatform: AssetPlatform | null;
  selectedScore: RankingScore | null;
}): JSX.Element {
  const reasoning = props.selectedScore?.reasoning ?? null;
  return (
    <>
      <p className="mb-2">
        Recommended platform:{' '}
        {props.recommendedPlatform ? (
          <span className="badge bg-primary">{labels.platform(props.recommendedPlatform)}</span>
        ) : (
          <span className="text-muted">none (content is not ranked yet)</span>
        )}
      </p>
      {props.selectedScore && (
        <div className="mb-3">
          <p className="mb-1">
            Score for {labels.platform(props.selectedScore.platform)}:{' '}
            <span className="fw-semibold">{props.selectedScore.score.toFixed(3)}</span>
          </p>
          {reasoning ? (
            <details>
              <summary className="small text-primary" style={{ cursor: 'pointer' }}>
                Why this score? (factor breakdown)
              </summary>
              <div className="mt-2">
                <ScoreReasoning reasoning={reasoning} />
              </div>
            </details>
          ) : (
            <p className="small text-muted mb-0">No reasoning detail available for this score.</p>
          )}
        </div>
      )}
    </>
  );
}

function RecordResult({ post, onClose }: { post: Post; onClose: () => void }): JSX.Element {
  return (
    <>
      <div className="modal-body">
        <div className="alert alert-success" role="status">
          External post recorded and audited.
        </div>
        <dl className="row mb-0">
          <dt className="col-4">Platform</dt>
          <dd className="col-8">{labels.postPlatform(post.platform)}</dd>
          <dt className="col-4">Status</dt>
          <dd className="col-8">
            <span className={`badge ${labels.postStatusBadgeClass(post.status)}`}>
              {labels.postStatus(post.status)}
            </span>
          </dd>
          <dt className="col-4">Publish method</dt>
          <dd className="col-8">
            <span className={`badge ${labels.publishMethodBadgeClass(post.publishMethod)}`}>
              {labels.publishMethod(post.publishMethod)}
            </span>
          </dd>
          <dt className="col-4">External ID</dt>
          <dd className="col-8 text-break">{post.externalPostId ?? '—'}</dd>
          <dt className="col-4">Override</dt>
          <dd className="col-8">{post.wasOverride ? 'Yes' : 'No'}</dd>
        </dl>
        <p className="small text-muted mt-3 mb-0">
          Override facts are recomputed server-side — the value above is what the backend decided,
          not what this form sent.
        </p>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </>
  );
}

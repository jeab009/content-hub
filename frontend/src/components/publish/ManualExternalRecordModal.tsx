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
import {
  AnchorPicker,
  EMPTY_ANCHOR_SELECTION,
  toAnchorsInput,
  type AnchorPickerValue,
} from '@/components/commerce/AnchorPicker';

/**
 * The anchor picker only applies to TikTok posts (design §4.7's "unified
 * TikTok anchor flow") — anchoring a product to a Facebook/YouTube/LINE OA
 * post has no commerce meaning today, and TikTok Shop is the one channel
 * whose products are pinned on the same native post this modal records.
 */
const ANCHORABLE_PLATFORM: AssetPlatform = 'tiktok';

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
  const [anchorSelection, setAnchorSelection] = useState<AnchorPickerValue>(EMPTY_ANCHOR_SELECTION);
  const [anchoredCount, setAnchoredCount] = useState<number | null>(null);
  const [anchorError, setAnchorError] = useState<string | null>(null);
  const [isAnchoring, setIsAnchoring] = useState(false);

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

  const wantsAnchoring = selected === ANCHORABLE_PLATFORM && anchorSelection.order.length > 0;

  /**
   * Step 2 of the unified TikTok anchor flow (design §4.7) — anchors the
   * already-recorded post. Called both right after the record succeeds and
   * from "Retry anchoring": it never re-issues the record call (which would
   * 409 anyway) and never asks for the password again, since anchoring
   * carries no step-up (SA-3).
   */
  async function runAnchoring(post: Post): Promise<void> {
    setIsAnchoring(true);
    setAnchorError(null);
    try {
      const anchors = await apiClient.anchorProductsToPost(
        post.id,
        { anchors: toAnchorsInput(anchorSelection) },
        csrfToken,
      );
      setAnchoredCount(anchors.length);
    } catch (err) {
      setAnchorError(
        err instanceof ApiError ? err.message : 'Failed to anchor the selected products.',
      );
    } finally {
      setIsAnchoring(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setAnchorError(null);
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
      // The parent refreshes on record success REGARDLESS of the anchor
      // outcome (design §4.7) — deferring this to full success would make a
      // partial failure look like nothing happened.
      setResult(post);
      props.onRecorded(post);
      if (wantsAnchoring) {
        await runAnchoring(post);
      }
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
          {result && anchorError ? (
            <PartialFailureResult
              post={result}
              anchorError={anchorError}
              isAnchoring={isAnchoring}
              onRetryAnchor={() => void runAnchoring(result)}
              onClose={props.onClose}
            />
          ) : result ? (
            <RecordResult post={result} anchoredCount={anchoredCount} onClose={props.onClose} />
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

                {selected === ANCHORABLE_PLATFORM && (
                  <div className="mb-3">
                    <AnchorPicker
                      channel="tiktok_shop"
                      value={anchorSelection}
                      onChange={setAnchorSelection}
                      disabled={isSubmitting}
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
                  {isSubmitting
                    ? isAnchoring
                      ? `Anchoring ${anchorSelection.order.length} product${anchorSelection.order.length === 1 ? '' : 's'}… (step 2 of 2)`
                      : wantsAnchoring
                        ? 'Recording post… (step 1 of 2)'
                        : 'Recording…'
                    : 'Record post'}
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

function RecordResult({
  post,
  anchoredCount,
  onClose,
}: {
  post: Post;
  anchoredCount: number | null;
  onClose: () => void;
}): JSX.Element {
  return (
    <>
      <div className="modal-body">
        <div className="alert alert-success" role="status">
          External post recorded and audited.
          {anchoredCount !== null && anchoredCount > 0 && (
            <> {anchoredCount} product{anchoredCount === 1 ? '' : 's'} anchored.</>
          )}
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

/**
 * Partial-failure state (design §4.7): the post IS recorded — never a
 * silent success, never a toast pretending both steps finished. Retry
 * re-issues ONLY the anchor call against the already-created post id; it
 * never re-submits the post record (which would 409) and never asks for the
 * password again (anchoring carries no step-up). "Leave for now" is a
 * legitimate exit, not a hidden failure — the post stays recorded and
 * reachable, and its Posts-page row shows a "No products anchored" chip
 * with its own inline retry.
 */
function PartialFailureResult(props: {
  post: Post;
  anchorError: string;
  isAnchoring: boolean;
  onRetryAnchor: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <>
      <div className="modal-body">
        <div className="alert alert-warning" role="alert">
          <p className="fw-semibold mb-2">Partly saved — one step still to do</p>
          <p className="mb-1">✓ Post recorded — {labels.postPlatform(props.post.platform)}</p>
          <p className="mb-2">✗ Products not anchored — {props.anchorError}</p>
          <p className="small mb-0">
            The post is saved. Your password is not needed again — anchoring is a separate,
            unaudited-as-publish step.
          </p>
        </div>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-outline-secondary" onClick={props.onClose}>
          Leave for now
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={props.isAnchoring}
          onClick={props.onRetryAnchor}
        >
          {props.isAnchoring ? 'Retrying…' : 'Retry anchoring'}
        </button>
      </div>
    </>
  );
}

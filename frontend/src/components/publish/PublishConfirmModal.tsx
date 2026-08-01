'use client';

import { FormEvent, useMemo, useState } from 'react';
import type { JSX } from 'react';
import {
  apiClient,
  ApiError,
  type AssetPlatform,
  type Post,
  type RankingScore,
} from '@/lib/api-client';
import { labels } from '@/lib/content-labels';
import { canSubmitPublish, isOverride } from '@/lib/publish-logic';
import { ScoreReasoning } from '@/components/publish/ScoreReasoning';

interface PublishConfirmModalProps {
  contentId: string;
  title: string;
  /** Latest ranking scores (with reasoning) for this content. */
  scores: RankingScore[];
  recommendedPlatform: AssetPlatform | null;
  /** Ranked platforms with a connected account — the only publishable targets. */
  connectablePlatforms: AssetPlatform[];
  csrfToken: string;
  onClose: () => void;
  /** Called after a post is created + dispatched so the parent can refresh. */
  onPublished: (post: Post) => void;
}

function initialPlatform(
  recommended: AssetPlatform | null,
  connectable: AssetPlatform[],
): AssetPlatform | null {
  if (recommended && connectable.includes(recommended)) {
    return recommended;
  }
  return connectable[0] ?? null;
}

/** Maps an ApiError status to the user-facing message + whether it is a password error. */
function describeError(err: unknown): { message: string; isPasswordError: boolean } {
  if (!(err instanceof ApiError)) {
    return { message: 'Something went wrong. Please try again.', isPasswordError: false };
  }
  // 401 = step-up re-auth failed (wrong password) — retry in the modal.
  // 403 = not an admin (access denied). Other statuses surface the backend message.
  if (err.status === 401) {
    return { message: `${err.message} — check your password and try again.`, isPasswordError: true };
  }
  if (err.status === 403) {
    return { message: 'Access denied — your account is not allowed to publish.', isPasswordError: false };
  }
  return { message: err.message, isPasswordError: false };
}

export function PublishConfirmModal(props: PublishConfirmModalProps): JSX.Element {
  const { contentId, title, scores, recommendedPlatform, connectablePlatforms, csrfToken } = props;

  const [selected, setSelected] = useState<AssetPlatform | null>(() =>
    initialPlatform(recommendedPlatform, connectablePlatforms),
  );
  const [password, setPassword] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Post | null>(null);

  const selectedScore = useMemo(
    () => scores.find((row) => row.platform === selected) ?? null,
    [scores, selected],
  );
  const overriding = selected !== null && isOverride(selected, recommendedPlatform);
  const canSubmit =
    selected !== null &&
    canSubmitPublish({ selected, recommended: recommendedPlatform, password, overrideReason });

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || !canSubmit) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const post = await apiClient.createPost(
        {
          contentId,
          platform: selected,
          password,
          overrideReason: overriding && overrideReason.trim() ? overrideReason.trim() : undefined,
        },
        csrfToken,
      );
      setResult(post);
      props.onPublished(post);
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
      aria-labelledby="publish-modal-title"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
    >
      <div className="modal-dialog modal-lg modal-dialog-scrollable">
        <div className="modal-content">
          <div className="modal-header">
            <h2 className="modal-title h5" id="publish-modal-title">
              Publish “{title}”
            </h2>
            <button
              type="button"
              className="btn-close"
              aria-label="Close"
              onClick={props.onClose}
            />
          </div>
          {result ? (
            <PublishResult post={result} onClose={props.onClose} />
          ) : (
            <PublishForm
              recommendedPlatform={recommendedPlatform}
              connectablePlatforms={connectablePlatforms}
              selected={selected}
              onSelect={setSelected}
              selectedScore={selectedScore}
              overriding={overriding}
              overrideReason={overrideReason}
              onOverrideReason={setOverrideReason}
              password={password}
              onPassword={setPassword}
              error={error}
              isSubmitting={isSubmitting}
              canSubmit={canSubmit}
              onSubmit={handleSubmit}
              onClose={props.onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}

interface PublishFormProps {
  recommendedPlatform: AssetPlatform | null;
  connectablePlatforms: AssetPlatform[];
  selected: AssetPlatform | null;
  onSelect: (platform: AssetPlatform) => void;
  selectedScore: RankingScore | null;
  overriding: boolean;
  overrideReason: string;
  onOverrideReason: (value: string) => void;
  password: string;
  onPassword: (value: string) => void;
  error: string | null;
  isSubmitting: boolean;
  canSubmit: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}

function PublishForm(props: PublishFormProps): JSX.Element {
  const { recommendedPlatform, connectablePlatforms, selected } = props;
  const reasoning =
    props.selectedScore && props.selectedScore.reasoning ? props.selectedScore.reasoning : null;

  return (
    <form onSubmit={props.onSubmit} noValidate>
      <div className="modal-body">
        <div className="alert alert-info py-2" role="note">
          Publishing is never automatic — this is an explicit, audited action requiring your
          password.
        </div>

        <p className="mb-2">
          Recommended platform:{' '}
          {recommendedPlatform ? (
            <span className="badge bg-primary">{labels.platform(recommendedPlatform)}</span>
          ) : (
            <span className="text-muted">none (content is not ranked yet)</span>
          )}
        </p>

        {connectablePlatforms.length === 0 ? (
          <div className="alert alert-warning" role="alert">
            No connected, publishable platform for this content. Connect a Facebook or YouTube
            account in Settings first.
          </div>
        ) : (
          <div className="mb-3">
            <label htmlFor="publish-platform" className="form-label">
              Publish to platform
            </label>
            <select
              id="publish-platform"
              className="form-select"
              value={selected ?? ''}
              onChange={(e) => props.onSelect(e.target.value as AssetPlatform)}
            >
              {connectablePlatforms.map((platform) => (
                <option key={platform} value={platform}>
                  {labels.platform(platform)}
                  {platform === recommendedPlatform ? ' (recommended)' : ''}
                </option>
              ))}
            </select>
            {props.overriding && (
              <div className="form-text text-warning-emphasis">
                Override: you are publishing to a platform other than the recommendation. A reason
                is required below.
              </div>
            )}
          </div>
        )}

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

        {props.overriding && (
          <div className="mb-3">
            <label htmlFor="override-reason" className="form-label">
              Override reason <span className="text-danger">*</span>
            </label>
            <textarea
              id="override-reason"
              className="form-control"
              rows={2}
              value={props.overrideReason}
              onChange={(e) => props.onOverrideReason(e.target.value)}
              required
            />
          </div>
        )}

        <div className="mb-3">
          <label htmlFor="stepup-password" className="form-label">
            Your password (step-up re-auth) <span className="text-danger">*</span>
          </label>
          <input
            id="stepup-password"
            type="password"
            className="form-control"
            autoComplete="current-password"
            value={props.password}
            onChange={(e) => props.onPassword(e.target.value)}
            required
          />
        </div>

        {props.error && (
          <div className="alert alert-danger" role="alert">
            {props.error}
          </div>
        )}
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-outline-secondary" onClick={props.onClose}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-danger"
          disabled={!props.canSubmit || props.isSubmitting}
        >
          {props.isSubmitting ? 'Publishing…' : 'Publish now'}
        </button>
      </div>
    </form>
  );
}

function PublishResult({ post, onClose }: { post: Post; onClose: () => void }): JSX.Element {
  return (
    <>
      <div className="modal-body">
        <div className="alert alert-success" role="status">
          Publish intent created and dispatched.
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
          <dt className="col-4">Override</dt>
          <dd className="col-8">{post.wasOverride ? 'Yes' : 'No'}</dd>
        </dl>
        <p className="small text-muted mt-3 mb-0">
          Dispatch runs in the background. Check the Posts page for the final status — in this demo
          the platform token is stale, so the dispatch is expected to end as “Failed” (retryable).
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

'use client';

import { FormEvent, useState } from 'react';
import {
  apiClient,
  ApiError,
  type Comment,
  type CommentTemplate,
} from '@/lib/api-client';
import { labels } from '@/lib/content-labels';
import {
  canSubmitReply,
  insertTemplate,
  MAX_REPLY_MESSAGE_LENGTH,
  remainingReplyChars,
} from '@/lib/comment-logic';

interface CommentReplyModalProps {
  comment: Comment;
  templates: CommentTemplate[];
  csrfToken: string;
  onClose: () => void;
  /** Called with the updated comment after a successful reply so the parent refreshes. */
  onReplied: (comment: Comment) => void;
}

/**
 * Maps an ApiError to a user-facing message + whether it is a password error
 * (retryable in the modal). Mirrors PublishConfirmModal.describeError, extended
 * for the reply-specific 409 (not replyable / already replied) + 429 (throttled).
 */
function describeError(err: unknown): { message: string; isPasswordError: boolean } {
  if (!(err instanceof ApiError)) {
    return { message: 'Something went wrong. Please try again.', isPasswordError: false };
  }
  // 401 = step-up re-auth failed (wrong password) — retry in the modal.
  if (err.status === 401) {
    return {
      message: `${err.message} — check your password and try again.`,
      isPasswordError: true,
    };
  }
  // 403 = CSRF / not-an-admin: access, not credentials.
  if (err.status === 403) {
    return {
      message: 'Access denied — this action was blocked (session or CSRF). Reload and retry.',
      isPasswordError: false,
    };
  }
  // 409 = comment not replyable or already replied (server is authoritative).
  if (err.status === 409) {
    return { message: `${err.message} This comment can no longer be replied to.`, isPasswordError: false };
  }
  // 429 = step-up throttle (5 / 15 min).
  if (err.status === 429) {
    return {
      message: 'Too many attempts — reply is rate-limited. Wait a few minutes and try again.',
      isPasswordError: false,
    };
  }
  return { message: err.message, isPasswordError: false };
}

export function CommentReplyModal(props: CommentReplyModalProps): JSX.Element {
  const { comment, templates, csrfToken } = props;
  const [message, setMessage] = useState('');
  const [password, setPassword] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Comment | null>(null);

  const remaining = remainingReplyChars(message);
  const overLimit = remaining < 0;
  const canSubmit = canSubmitReply({ message, password });

  function handleInsertTemplate(templateId: string): void {
    setSelectedTemplateId(templateId);
    const template = templates.find((row) => row.id === templateId);
    if (template) {
      setMessage((current) => insertTemplate(current, template.body));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const updated = await apiClient.replyComment(
        comment.id,
        { message: message.trim(), password },
        csrfToken,
      );
      setResult(updated);
      props.onReplied(updated);
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
      aria-labelledby="reply-modal-title"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
    >
      <div className="modal-dialog modal-lg modal-dialog-scrollable">
        <div className="modal-content">
          <div className="modal-header">
            <h2 className="modal-title h5" id="reply-modal-title">
              Reply to {labels.postPlatform(comment.platform)} comment
            </h2>
            <button type="button" className="btn-close" aria-label="Close" onClick={props.onClose} />
          </div>
          {result ? (
            <ReplyResult comment={result} onClose={props.onClose} />
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} noValidate>
              <div className="modal-body">
                <div className="alert alert-info py-2" role="note">
                  Replying posts publicly to the platform and is audited — it requires your password
                  (step-up re-auth).
                </div>

                <div className="mb-3">
                  <div className="small text-muted">Original comment by {comment.author}</div>
                  <blockquote className="border-start ps-3 mb-0 mt-1">{comment.text}</blockquote>
                </div>

                {templates.length > 0 && (
                  <div className="mb-3">
                    <label htmlFor="reply-template" className="form-label">
                      Insert a canned template (optional)
                    </label>
                    <select
                      id="reply-template"
                      className="form-select"
                      value={selectedTemplateId}
                      onChange={(e) => handleInsertTemplate(e.target.value)}
                    >
                      <option value="">Choose a template…</option>
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.title}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="mb-3">
                  <label htmlFor="reply-message" className="form-label">
                    Reply message <span className="text-danger">*</span>
                  </label>
                  <textarea
                    id="reply-message"
                    className={`form-control ${overLimit ? 'is-invalid' : ''}`}
                    rows={5}
                    maxLength={MAX_REPLY_MESSAGE_LENGTH}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    required
                  />
                  <div className={`form-text ${overLimit ? 'text-danger' : ''}`}>
                    {remaining} characters remaining (max {MAX_REPLY_MESSAGE_LENGTH})
                  </div>
                </div>

                <div className="mb-3">
                  <label htmlFor="reply-password" className="form-label">
                    Your password (step-up re-auth) <span className="text-danger">*</span>
                  </label>
                  <input
                    id="reply-password"
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
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!canSubmit || isSubmitting}
                >
                  {isSubmitting ? 'Sending…' : 'Send reply'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function ReplyResult({ comment, onClose }: { comment: Comment; onClose: () => void }): JSX.Element {
  return (
    <>
      <div className="modal-body">
        <div className="alert alert-success" role="status">
          Reply sent and recorded.
        </div>
        <dl className="row mb-0">
          <dt className="col-4">Platform</dt>
          <dd className="col-8">{labels.postPlatform(comment.platform)}</dd>
          <dt className="col-4">Replied at</dt>
          <dd className="col-8">
            {comment.repliedAt ? new Date(comment.repliedAt).toLocaleString() : '—'}
          </dd>
          <dt className="col-4">Reply</dt>
          <dd className="col-8">{comment.replyText ?? '—'}</dd>
        </dl>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </>
  );
}

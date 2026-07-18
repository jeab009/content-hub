'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  apiClient,
  ApiError,
  type CurrentUser,
  type Post,
  type PostStatus,
} from '@/lib/api-client';
import { labels } from '@/lib/content-labels';
import { AppHeader } from '@/components/AppHeader';

const POST_STATUSES: PostStatus[] = [
  'draft',
  'scheduled',
  'posted',
  'posted_unconfirmed',
  'failed',
  'cancelled',
];

/** Statuses the backend allows a manual re-dispatch from (post-state.ts). */
const RETRYABLE_STATUSES: PostStatus[] = ['draft', 'failed'];

type PendingAction =
  | { kind: 'retry'; post: Post }
  | { kind: 'resolve-posted'; post: Post };

export default function PostsPage(): JSX.Element {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [titles, setTitles] = useState<Map<string, string>>(new Map());
  const [statusFilter, setStatusFilter] = useState<PostStatus | ''>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const loadPosts = useCallback(
    async (status: PostStatus | '') => {
      try {
        setPosts(await apiClient.listPosts(status || undefined));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.push('/login');
          return;
        }
        setError('Failed to load posts.');
      }
    },
    [router],
  );

  const loadInitial = useCallback(async () => {
    try {
      const [currentUser, csrf, contents] = await Promise.all([
        apiClient.me(),
        apiClient.getCsrfToken(),
        apiClient.listContents(),
      ]);
      setUser(currentUser);
      setCsrfToken(csrf.csrfToken);
      setTitles(new Map(contents.map((content) => [content.id, content.title])));
      await loadPosts('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }
      setError('Failed to load posts.');
    } finally {
      setIsLoading(false);
    }
  }, [router, loadPosts]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  function applyStatusFilter(status: PostStatus | ''): void {
    setStatusFilter(status);
    void loadPosts(status);
  }

  async function handleResolveNotPosted(post: Post): Promise<void> {
    if (!csrfToken) return;
    if (
      !window.confirm(
        'Confirm that you checked the platform and found NO live post. The post reopens as Failed (retryable).',
      )
    ) {
      return;
    }
    setError(null);
    try {
      await apiClient.resolveNotPosted(post.id, csrfToken);
      await loadPosts(statusFilter);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to resolve the post.');
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
        <h1 className="h3 mb-0">Posts</h1>
        <div>
          <label htmlFor="filter-post-status" className="form-label small mb-1 me-2">
            Status
          </label>
          <select
            id="filter-post-status"
            className="form-select form-select-sm d-inline-block w-auto"
            value={statusFilter}
            onChange={(e) => applyStatusFilter(e.target.value as PostStatus | '')}
          >
            <option value="">All statuses</option>
            {POST_STATUSES.map((value) => (
              <option key={value} value={value}>
                {labels.postStatus(value)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      {posts.length === 0 ? (
        <div className="text-center text-muted border rounded py-5">
          <p className="mb-0">No posts yet. Publish ready content from the Scheduler.</p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-hover align-middle">
            <thead>
              <tr>
                <th scope="col">Content</th>
                <th scope="col">Platform</th>
                <th scope="col">Status</th>
                <th scope="col">Override</th>
                <th scope="col">Posted at</th>
                <th scope="col">External ID</th>
                <th scope="col" className="text-end">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post.id}>
                  <td className="fw-semibold">{titles.get(post.contentId) ?? post.contentId}</td>
                  <td>{labels.postPlatform(post.platform)}</td>
                  <td>
                    <span className={`badge ${labels.postStatusBadgeClass(post.status)}`}>
                      {labels.postStatus(post.status)}
                    </span>
                  </td>
                  <td>
                    {post.wasOverride ? (
                      <span title={post.overrideReason ?? undefined}>
                        Yes{post.overrideReason ? ` — ${post.overrideReason}` : ''}
                      </span>
                    ) : (
                      'No'
                    )}
                  </td>
                  <td className="small">
                    {post.postedAt ? new Date(post.postedAt).toLocaleString() : '—'}
                  </td>
                  <td className="small text-muted">{post.externalPostId ?? '—'}</td>
                  <td className="text-end">
                    {RETRYABLE_STATUSES.includes(post.status) && (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-primary"
                        onClick={() => setPendingAction({ kind: 'retry', post })}
                      >
                        Retry
                      </button>
                    )}
                    {post.status === 'posted_unconfirmed' && (
                      <>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-success me-2"
                          onClick={() => setPendingAction({ kind: 'resolve-posted', post })}
                        >
                          Mark posted
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => void handleResolveNotPosted(post)}
                        >
                          Not posted
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pendingAction && csrfToken && pendingAction.kind === 'retry' && (
        <RetryPublishModal
          post={pendingAction.post}
          title={titles.get(pendingAction.post.contentId) ?? pendingAction.post.contentId}
          csrfToken={csrfToken}
          onClose={() => setPendingAction(null)}
          onDone={() => {
            setPendingAction(null);
            void loadPosts(statusFilter);
          }}
        />
      )}
      {pendingAction && csrfToken && pendingAction.kind === 'resolve-posted' && (
        <ResolvePostedModal
          post={pendingAction.post}
          title={titles.get(pendingAction.post.contentId) ?? pendingAction.post.contentId}
          csrfToken={csrfToken}
          onClose={() => setPendingAction(null)}
          onDone={() => {
            setPendingAction(null);
            void loadPosts(statusFilter);
          }}
        />
      )}
    </div>
  );
}

interface ActionModalProps {
  post: Post;
  title: string;
  csrfToken: string;
  onClose: () => void;
  onDone: () => void;
}

/** Step-up re-auth modal for retrying a draft/failed post. */
function RetryPublishModal(props: ActionModalProps): JSX.Element {
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (password.trim().length === 0) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await apiClient.publishPost(props.post.id, password, props.csrfToken);
      props.onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError(`${err.message} — check your password and try again.`);
        setPassword('');
      } else {
        setError(err instanceof ApiError ? err.message : 'Failed to retry the post.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ActionModalShell titleId="retry-modal-title" heading={`Retry publish “${props.title}”`} onClose={props.onClose}>
      <form onSubmit={handleSubmit} noValidate>
        <div className="modal-body">
          <p className="mb-3">
            Re-dispatch to {labels.postPlatform(props.post.platform)}. This is an audited action
            requiring your password.
          </p>
          <div className="mb-3">
            <label htmlFor="retry-password" className="form-label">
              Your password (step-up re-auth) <span className="text-danger">*</span>
            </label>
            <input
              id="retry-password"
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
            className="btn btn-danger"
            disabled={password.trim().length === 0 || isSubmitting}
          >
            {isSubmitting ? 'Retrying…' : 'Retry publish'}
          </button>
        </div>
      </form>
    </ActionModalShell>
  );
}

/** Resolution modal: admin found the live post — record its platform ID. */
function ResolvePostedModal(props: ActionModalProps): JSX.Element {
  const [externalPostId, setExternalPostId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (externalPostId.trim().length === 0) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await apiClient.resolvePosted(props.post.id, externalPostId.trim(), props.csrfToken);
      props.onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to resolve the post.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ActionModalShell
      titleId="resolve-modal-title"
      heading={`Mark “${props.title}” as posted`}
      onClose={props.onClose}
    >
      <form onSubmit={handleSubmit} noValidate>
        <div className="modal-body">
          <p className="mb-3">
            Confirm you found the live post on {labels.postPlatform(props.post.platform)} and paste
            its platform post ID.
          </p>
          <div className="mb-3">
            <label htmlFor="external-post-id" className="form-label">
              Platform post ID <span className="text-danger">*</span>
            </label>
            <input
              id="external-post-id"
              type="text"
              className="form-control"
              value={externalPostId}
              onChange={(e) => setExternalPostId(e.target.value)}
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
            className="btn btn-success"
            disabled={externalPostId.trim().length === 0 || isSubmitting}
          >
            {isSubmitting ? 'Saving…' : 'Mark posted'}
          </button>
        </div>
      </form>
    </ActionModalShell>
  );
}

function ActionModalShell(props: {
  titleId: string;
  heading: string;
  onClose: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div
      className="modal d-block"
      role="dialog"
      aria-modal="true"
      aria-labelledby={props.titleId}
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
    >
      <div className="modal-dialog">
        <div className="modal-content">
          <div className="modal-header">
            <h2 className="modal-title h5" id={props.titleId}>
              {props.heading}
            </h2>
            <button type="button" className="btn-close" aria-label="Close" onClick={props.onClose} />
          </div>
          {props.children}
        </div>
      </div>
    </div>
  );
}

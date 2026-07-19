'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  apiClient,
  ApiError,
  type Comment,
  type CommentPriority,
  type CommentSentiment,
  type CommentSyncResult,
  type CommentTemplate,
  type CurrentUser,
  type EscalationAlert,
  type ListCommentsQuery,
  type PaginatedComments,
  type PostPlatform,
} from '@/lib/api-client';
import { labels } from '@/lib/content-labels';
import {
  COMMENT_PLATFORMS,
  COMMENT_PRIORITIES,
  COMMENT_SENTIMENTS,
  commentLabels,
} from '@/lib/comment-labels';
import { canReply } from '@/lib/comment-logic';
import { AppHeader } from '@/components/AppHeader';
import { CommentReplyModal } from '@/components/comments/CommentReplyModal';
import { EscalationBanner } from '@/components/comments/EscalationBanner';

/** The subset of ListCommentsQuery driven by the filter bar (page is separate). */
type InboxFilters = Omit<ListCommentsQuery, 'page' | 'pageSize'>;

/** Parses a tri-state select ('', 'true', 'false') into an optional boolean. */
function parseTriState(value: string): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

export default function CommentsPage(): JSX.Element {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [filters, setFilters] = useState<InboxFilters>({});
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PaginatedComments | null>(null);
  const [templates, setTemplates] = useState<CommentTemplate[]>([]);
  const [escalations, setEscalations] = useState<EscalationAlert[]>([]);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<CommentSyncResult | null>(null);
  const [replyTarget, setReplyTarget] = useState<Comment | null>(null);
  const [erasingId, setErasingId] = useState<string | null>(null);

  const loadComments = useCallback(
    async (nextFilters: InboxFilters, nextPage: number) => {
      setIsRefreshing(true);
      try {
        setData(await apiClient.listComments({ ...nextFilters, page: nextPage }));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.push('/login');
          return;
        }
        setError('Failed to load comments.');
      } finally {
        setIsRefreshing(false);
      }
    },
    [router],
  );

  const loadEscalations = useCallback(async () => {
    try {
      setEscalations(await apiClient.listEscalations(true));
    } catch {
      // Non-fatal: the banner is auxiliary; the inbox still works without it.
    }
  }, []);

  const loadInitial = useCallback(async () => {
    try {
      const [currentUser, csrf, templateList] = await Promise.all([
        apiClient.me(),
        apiClient.getCsrfToken(),
        apiClient.listCommentTemplates(),
      ]);
      setUser(currentUser);
      setCsrfToken(csrf.csrfToken);
      setTemplates(templateList);
      await Promise.all([loadComments({}, 1), loadEscalations()]);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }
      setError('Failed to load the comment inbox.');
    } finally {
      setIsLoading(false);
    }
  }, [router, loadComments, loadEscalations]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  function applyFilters(next: InboxFilters): void {
    setFilters(next);
    setPage(1);
    void loadComments(next, 1);
  }

  function goToPage(nextPage: number): void {
    setPage(nextPage);
    void loadComments(filters, nextPage);
  }

  async function handleSync(): Promise<void> {
    if (!csrfToken) return;
    setError(null);
    setSyncResult(null);
    setIsSyncing(true);
    try {
      const result = await apiClient.syncComments(csrfToken);
      setSyncResult(result);
      await Promise.all([loadComments(filters, 1), loadEscalations()]);
      setPage(1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to sync comments.');
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleAcknowledge(alert: EscalationAlert): Promise<void> {
    if (!csrfToken) return;
    setAcknowledgingId(alert.id);
    try {
      await apiClient.ackEscalation(alert.id, csrfToken);
      setEscalations((current) => current.filter((row) => row.id !== alert.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to acknowledge alert.');
    } finally {
      setAcknowledgingId(null);
    }
  }

  async function handleErase(comment: Comment): Promise<void> {
    if (!csrfToken) return;
    const confirmed = window.confirm(
      'Erase this comment permanently (PDPA data-subject request)? This cannot be undone.',
    );
    if (!confirmed) return;
    setErasingId(comment.id);
    try {
      await apiClient.eraseComment(comment.id, csrfToken);
      await loadComments(filters, page);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to erase comment.');
    } finally {
      setErasingId(null);
    }
  }

  function handleReplied(): void {
    setReplyTarget(null);
    void loadComments(filters, page);
  }

  if (isLoading) {
    return <p>Loading…</p>;
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <AppHeader>{user && <span className="text-muted small">{user.email}</span>}</AppHeader>

      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="h3 mb-0">Comments</h1>
        <button
          type="button"
          className="btn btn-outline-primary"
          disabled={isSyncing}
          onClick={() => void handleSync()}
        >
          {isSyncing ? 'Syncing…' : 'Sync comments'}
        </button>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      {syncResult && (
        <div className="alert alert-success" role="status">
          Sync complete: {syncResult.inserted} new comment{syncResult.inserted === 1 ? '' : 's'}{' '}
          inserted ({syncResult.synced} synced, {syncResult.skipped} skipped, {syncResult.failed}{' '}
          failed).
        </div>
      )}

      <EscalationBanner
        alerts={escalations}
        acknowledgingId={acknowledgingId}
        onAcknowledge={(alert) => void handleAcknowledge(alert)}
      />

      <FilterBar filters={filters} onChange={applyFilters} />

      {data && data.items.length === 0 ? (
        <div className="text-center text-muted border rounded py-5">
          <p className="mb-0">
            No comments match these filters. Try clearing filters or running a sync.
          </p>
        </div>
      ) : (
        data && (
          <>
            <CommentsTable
              comments={data.items}
              erasingId={erasingId}
              onReply={setReplyTarget}
              onErase={(comment) => void handleErase(comment)}
            />
            <Pagination
              page={data.page}
              totalPages={totalPages}
              total={data.total}
              disabled={isRefreshing}
              onPage={goToPage}
            />
          </>
        )
      )}

      {replyTarget && csrfToken && (
        <CommentReplyModal
          comment={replyTarget}
          templates={templates}
          csrfToken={csrfToken}
          onClose={() => setReplyTarget(null)}
          onReplied={handleReplied}
        />
      )}
    </div>
  );
}

interface FilterBarProps {
  filters: InboxFilters;
  onChange: (filters: InboxFilters) => void;
}

function FilterBar({ filters, onChange }: FilterBarProps): JSX.Element {
  return (
    <div className="row g-2 mb-3">
      <div className="col-6 col-md">
        <label htmlFor="filter-platform" className="form-label small mb-1">
          Platform
        </label>
        <select
          id="filter-platform"
          className="form-select form-select-sm"
          value={filters.platform ?? ''}
          onChange={(e) =>
            onChange({ ...filters, platform: (e.target.value || undefined) as PostPlatform | undefined })
          }
        >
          <option value="">All</option>
          {COMMENT_PLATFORMS.map((platform) => (
            <option key={platform} value={platform}>
              {labels.postPlatform(platform)}
            </option>
          ))}
        </select>
      </div>

      <div className="col-6 col-md">
        <label htmlFor="filter-sentiment" className="form-label small mb-1">
          Sentiment
        </label>
        <select
          id="filter-sentiment"
          className="form-select form-select-sm"
          value={filters.sentiment ?? ''}
          onChange={(e) =>
            onChange({
              ...filters,
              sentiment: (e.target.value || undefined) as CommentSentiment | undefined,
            })
          }
        >
          <option value="">All</option>
          {COMMENT_SENTIMENTS.map((sentiment) => (
            <option key={sentiment} value={sentiment}>
              {commentLabels.sentiment(sentiment)}
            </option>
          ))}
        </select>
      </div>

      <div className="col-6 col-md">
        <label htmlFor="filter-priority" className="form-label small mb-1">
          Priority
        </label>
        <select
          id="filter-priority"
          className="form-select form-select-sm"
          value={filters.priority ?? ''}
          onChange={(e) =>
            onChange({
              ...filters,
              priority: (e.target.value || undefined) as CommentPriority | undefined,
            })
          }
        >
          <option value="">All</option>
          {COMMENT_PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {commentLabels.priority(priority)}
            </option>
          ))}
        </select>
      </div>

      <div className="col-6 col-md">
        <label htmlFor="filter-sla" className="form-label small mb-1">
          SLA breach
        </label>
        <select
          id="filter-sla"
          className="form-select form-select-sm"
          value={filters.slaBreach === undefined ? '' : String(filters.slaBreach)}
          onChange={(e) => onChange({ ...filters, slaBreach: parseTriState(e.target.value) })}
        >
          <option value="">All</option>
          <option value="true">Breached only</option>
          <option value="false">Not breached</option>
        </select>
      </div>

      <div className="col-6 col-md">
        <label htmlFor="filter-replied" className="form-label small mb-1">
          Replied
        </label>
        <select
          id="filter-replied"
          className="form-select form-select-sm"
          value={filters.replied === undefined ? '' : String(filters.replied)}
          onChange={(e) => onChange({ ...filters, replied: parseTriState(e.target.value) })}
        >
          <option value="">All</option>
          <option value="true">Replied</option>
          <option value="false">Unreplied</option>
        </select>
      </div>

      <div className="col-6 col-md d-flex align-items-end">
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary w-100"
          onClick={() => onChange({})}
        >
          Clear filters
        </button>
      </div>
    </div>
  );
}

interface CommentsTableProps {
  comments: Comment[];
  erasingId: string | null;
  onReply: (comment: Comment) => void;
  onErase: (comment: Comment) => void;
}

function CommentsTable(props: CommentsTableProps): JSX.Element {
  return (
    <div className="table-responsive">
      <table className="table table-hover align-middle">
        <thead>
          <tr>
            <th scope="col">Platform</th>
            <th scope="col">Author</th>
            <th scope="col">Comment</th>
            <th scope="col">Sentiment</th>
            <th scope="col">Priority</th>
            <th scope="col">SLA</th>
            <th scope="col" className="text-end">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {props.comments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              erasing={props.erasingId === comment.id}
              onReply={props.onReply}
              onErase={props.onErase}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface CommentRowProps {
  comment: Comment;
  erasing: boolean;
  onReply: (comment: Comment) => void;
  onErase: (comment: Comment) => void;
}

function CommentRow({ comment, erasing, onReply, onErase }: CommentRowProps): JSX.Element {
  const sentiment = commentLabels.sentimentBadge(comment.sentiment);
  const priority = commentLabels.priorityBadge(comment.priority);
  const sla = commentLabels.slaBadge(comment);
  const replyable = canReply(comment);

  return (
    <tr>
      <td>{labels.postPlatform(comment.platform)}</td>
      <td>{comment.author}</td>
      <td style={{ maxWidth: '22rem' }}>
        <div>{comment.text}</div>
        {comment.repliedAt && comment.replyText && (
          <div className="small text-success mt-1">↳ Replied: {comment.replyText}</div>
        )}
      </td>
      <td>
        <span className={`badge ${sentiment.className}`}>{sentiment.label}</span>
        {comment.sentimentSource && (
          <div className="small text-muted">{commentLabels.sentimentSource(comment.sentimentSource)}</div>
        )}
      </td>
      <td>
        <span className={`badge ${priority.className}`}>{priority.label}</span>
      </td>
      <td>
        <span className={`badge ${sla.className}`}>{sla.label}</span>
      </td>
      <td className="text-end">
        <button
          type="button"
          className="btn btn-sm btn-primary me-2"
          disabled={!replyable}
          title={replyable ? undefined : 'This comment cannot be replied to'}
          onClick={() => onReply(comment)}
        >
          {comment.repliedAt ? 'Replied' : 'Reply…'}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline-danger"
          disabled={erasing}
          onClick={() => onErase(comment)}
        >
          {erasing ? 'Erasing…' : 'Erase'}
        </button>
      </td>
    </tr>
  );
}

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  disabled: boolean;
  onPage: (page: number) => void;
}

function Pagination({ page, totalPages, total, disabled, onPage }: PaginationProps): JSX.Element {
  return (
    <div className="d-flex justify-content-between align-items-center">
      <span className="text-muted small">
        Page {page} of {totalPages} · {total} comment{total === 1 ? '' : 's'}
      </span>
      <div className="btn-group">
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          disabled={disabled || page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          disabled={disabled || page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

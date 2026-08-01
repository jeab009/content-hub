'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  apiClient,
  ApiError,
  type Content,
  type ContentStatus,
  type ContentType,
  type CurrentUser,
  type ListContentQuery,
} from '@/lib/api-client';
import {
  CONTENT_STATUSES,
  CONTENT_TYPES,
  labels,
} from '@/lib/content-labels';
import { AppHeader } from '@/components/AppHeader';

export default function ContentLibraryPage(): JSX.Element {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [contents, setContents] = useState<Content[]>([]);
  const [filters, setFilters] = useState<ListContentQuery>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Display-only "this content had a logged paid campaign" chip (design
  // §4.5, Decision 4 item 4) — derived client-side from the ALREADY
  // authorized GET /api/paid/campaigns list, the identical technique /posts
  // uses for its "Anchored (n)" chip. No ranking read, no priority change,
  // no new backend endpoint. Counts EVERY linked campaign, any lifecycle
  // status/retire-state — a retired campaign still means "this had a logged
  // paid campaign," a historical fact that stays true after retirement.
  const [paidCampaignCounts, setPaidCampaignCounts] = useState<Map<string, number>>(new Map());

  const loadContents = useCallback(
    async (activeFilters: ListContentQuery) => {
      try {
        setContents(await apiClient.listContents(activeFilters));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.push('/login');
          return;
        }
        setError('Failed to load content.');
      }
    },
    [router],
  );

  const loadInitial = useCallback(async () => {
    try {
      const [currentUser, csrf] = await Promise.all([apiClient.me(), apiClient.getCsrfToken()]);
      setUser(currentUser);
      setCsrfToken(csrf.csrfToken);
      await loadContents({});
      // Best-effort — a failure here is non-fatal, the chip just shows "—".
      try {
        const campaigns = await apiClient.listPaidCampaigns();
        const counts = new Map<string, number>();
        for (const campaign of campaigns) {
          if (!campaign.contentId) continue;
          counts.set(campaign.contentId, (counts.get(campaign.contentId) ?? 0) + 1);
        }
        setPaidCampaignCounts(counts);
      } catch {
        // leave uncounted
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }
      setError('Failed to load content.');
    } finally {
      setIsLoading(false);
    }
  }, [router, loadContents]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  function applyFilter(patch: ListContentQuery): void {
    const next = { ...filters, ...patch };
    // Drop undefined values so the list query DTO only ever sees params it
    // accepts (callers already map empty selections to undefined).
    (Object.keys(next) as (keyof ListContentQuery)[]).forEach((key) => {
      if (next[key] === undefined) {
        delete next[key];
      }
    });
    setFilters(next);
    void loadContents(next);
  }

  async function handleArchive(content: Content): Promise<void> {
    if (!csrfToken) return;
    if (!window.confirm(`Archive "${content.title}"? It will no longer be publishable.`)) {
      return;
    }
    setError(null);
    try {
      await apiClient.archiveContent(content.id, csrfToken);
      await loadContents(filters);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to archive content.');
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
        <h1 className="h3 mb-0">Content library</h1>
        <Link href="/content/new" className="btn btn-primary">
          New content
        </Link>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      <div className="row g-2 mb-3">
        <div className="col-12 col-md-4">
          <label htmlFor="filter-search" className="form-label small mb-1">
            Search title
          </label>
          <input
            id="filter-search"
            type="search"
            className="form-control"
            placeholder="Search…"
            onChange={(e) => applyFilter({ search: e.target.value || undefined })}
          />
        </div>
        <div className="col-6 col-md-3">
          <label htmlFor="filter-type" className="form-label small mb-1">
            Type
          </label>
          <select
            id="filter-type"
            className="form-select"
            onChange={(e) => applyFilter({ type: (e.target.value || undefined) as ContentType })}
          >
            <option value="">All types</option>
            {CONTENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {labels.type(value)}
              </option>
            ))}
          </select>
        </div>
        <div className="col-6 col-md-3">
          <label htmlFor="filter-status" className="form-label small mb-1">
            Status
          </label>
          <select
            id="filter-status"
            className="form-select"
            onChange={(e) =>
              applyFilter({ status: (e.target.value || undefined) as ContentStatus })
            }
          >
            <option value="">All statuses</option>
            {CONTENT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {labels.status(value)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {contents.length === 0 ? (
        <div className="text-center text-muted border rounded py-5">
          <p className="mb-2">No content found.</p>
          <Link href="/content/new" className="btn btn-outline-primary btn-sm">
            Create your first content
          </Link>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-hover align-middle">
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Type</th>
                <th scope="col">Pillar</th>
                <th scope="col">Status</th>
                <th scope="col">Copyright</th>
                <th scope="col">Paid</th>
                <th scope="col" className="text-end">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {contents.map((content) => (
                <tr key={content.id}>
                  <td>
                    <Link
                      href={`/content/${content.id}/edit`}
                      className="text-decoration-none fw-semibold"
                    >
                      {content.title}
                    </Link>
                  </td>
                  <td>{labels.type(content.type)}</td>
                  <td>{content.contentPillar ? labels.pillar(content.contentPillar) : '—'}</td>
                  <td>
                    <span className={`badge ${labels.statusBadgeClass(content.status)}`}>
                      {labels.status(content.status)}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${labels.clearanceBadgeClass(content.copyrightCleared)}`}>
                      {labels.clearance(content.copyrightCleared)}
                    </span>
                  </td>
                  <td>
                    {(paidCampaignCounts.get(content.id) ?? 0) > 0 ? (
                      <span className="badge bg-primary">
                        Ad campaign ({paidCampaignCounts.get(content.id)})
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="text-end">
                    <Link
                      href={`/content/${content.id}/edit`}
                      className="btn btn-sm btn-outline-secondary me-2"
                    >
                      Edit
                    </Link>
                    {content.status !== 'archived' && (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger"
                        onClick={() => void handleArchive(content)}
                      >
                        Archive
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

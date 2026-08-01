'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { useRouter } from 'next/navigation';
import {
  apiClient,
  ApiError,
  type AdCampaign,
  type AdCampaignStatus,
  type AdPerformanceEntry,
  type Content,
  type CurrentUser,
  type PaidSummary,
} from '@/lib/api-client';
import {
  canSubmitPaidCampaign,
  canSubmitPerformanceEntry,
  CAMPAIGN_DATE_RANGE_ERROR,
  describePaidEntryError,
  isCorrection,
  isValidCampaignDateRange,
  isValidSourceRef,
  PAID_OBJECTIVE_MAX_LENGTH,
  SOURCE_REF_HELP_TEXT,
} from '@/lib/paid-logic';
import { CAMPAIGN_STATUSES, formatTHB, labels } from '@/lib/content-labels';
import { AppHeader } from '@/components/AppHeader';
import { ModalShell } from '@/components/paid/ModalShell';
import { PaidExportCsvButton } from '@/components/paid/PaidExportCsvButton';

type StatusFilter = 'active' | 'retired' | 'all';

type ModalState =
  | { kind: 'create' }
  | { kind: 'edit'; campaign: AdCampaign }
  | { kind: 'performance'; campaign: AdCampaign }
  | null;

const OVERLAP_DEBOUNCE_MS = 400;

export default function PaidCampaignsPage(): JSX.Element {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [contents, setContents] = useState<Content[]>([]);
  const [summary, setSummary] = useState<PaidSummary | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);

  const contentTitles = useMemo(() => new Map(contents.map((c) => [c.id, c.title])), [contents]);
  const byCampaign = useMemo(
    () => new Map((summary?.byCampaign ?? []).map((row) => [row.campaignId, row])),
    [summary],
  );

  const loadCampaigns = useCallback(async () => {
    try {
      const [rows, paidSummary] = await Promise.all([
        apiClient.listPaidCampaigns({
          isActive: statusFilter === 'all' ? undefined : statusFilter === 'active',
        }),
        apiClient.getPaidSummary(),
      ]);
      setCampaigns(rows);
      setSummary(paidSummary);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }
      setError('Failed to load paid campaigns.');
    }
  }, [statusFilter, router]);

  const loadInitial = useCallback(async () => {
    try {
      const [currentUser, csrf, contentRows] = await Promise.all([
        apiClient.me(),
        apiClient.getCsrfToken(),
        apiClient.listContents().catch(() => []),
      ]);
      setUser(currentUser);
      setCsrfToken(csrf.csrfToken);
      setContents(contentRows);
      await loadCampaigns();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }
      setError('Failed to load paid campaigns.');
    } finally {
      setIsLoading(false);
    }
  }, [router, loadCampaigns]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    if (!isLoading) void loadCampaigns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term === '') return campaigns;
    return campaigns.filter((campaign) => campaign.externalCampaignName.toLowerCase().includes(term));
  }, [campaigns, search]);

  async function handleRetire(campaign: AdCampaign): Promise<void> {
    if (!csrfToken) return;
    if (
      !window.confirm(
        `Retire "${campaign.externalCampaignName}"? It stays on existing performance entries — ` +
          'retiring only removes it from the picker for new performance entries.',
      )
    ) {
      return;
    }
    setError(null);
    try {
      await apiClient.retirePaidCampaign(campaign.id, csrfToken);
      await loadCampaigns();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to retire the campaign.');
    }
  }

  if (isLoading) {
    return <p>Loading…</p>;
  }

  return (
    <div>
      <AppHeader>{user && <span className="text-muted small">{user.email}</span>}</AppHeader>

      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h3 mb-0">Paid / Ads</h1>
        <button type="button" className="btn btn-primary" onClick={() => setModal({ kind: 'create' })}>
          + Add campaign
        </button>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      <div className="d-flex flex-wrap gap-3 align-items-end mb-3">
        <div>
          <label htmlFor="filter-status" className="form-label small mb-1">
            Status
          </label>
          <select
            id="filter-status"
            className="form-select form-select-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="active">Active</option>
            <option value="retired">Retired</option>
            <option value="all">All</option>
          </select>
        </div>
        <div className="flex-grow-1" style={{ maxWidth: 320 }}>
          <label htmlFor="filter-search" className="form-label small mb-1">
            Search
          </label>
          <input
            id="filter-search"
            type="search"
            className="form-control form-control-sm"
            placeholder="Campaign name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center text-muted border rounded py-5">
          <p className="mb-0">
            No paid campaigns logged yet. Add one, then log performance after your first Ads Manager
            check.
          </p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-hover align-middle">
            <thead>
              <tr>
                <th scope="col">Campaign</th>
                <th scope="col">Channel</th>
                <th scope="col">Content</th>
                <th scope="col">Period</th>
                <th scope="col">Status</th>
                <th scope="col" className="text-end">
                  Planned budget*
                </th>
                <th scope="col" className="text-end">
                  Spend / entries
                </th>
                <th scope="col" className="text-end">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((campaign) => {
                const rollup = byCampaign.get(campaign.id);
                return (
                  <tr key={campaign.id}>
                    <td>
                      <div className="fw-semibold">{campaign.externalCampaignName}</div>
                      <div className="small text-muted">
                        {campaign.objective}
                        {' · '}
                        {campaign.isActive ? (
                          'Active in picker'
                        ) : (
                          <>Retired{campaign.retiredAt ? ` · ${campaign.retiredAt.slice(0, 10)}` : ''}</>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${labels.adChannelBadgeClass(campaign.channel)}`}>
                        {labels.adChannel(campaign.channel)}
                      </span>
                    </td>
                    <td className="small">
                      {campaign.contentId ? (contentTitles.get(campaign.contentId) ?? '—') : '—'}
                    </td>
                    <td className="small">
                      {campaign.startDate.slice(0, 10)} –{' '}
                      {campaign.endDate ? campaign.endDate.slice(0, 10) : 'ongoing'}
                    </td>
                    <td>
                      <span className={`badge ${labels.campaignStatusBadgeClass(campaign.status)}`}>
                        {labels.campaignStatus(campaign.status)}
                      </span>
                    </td>
                    <td className="text-end">
                      {campaign.plannedBudget !== null ? formatTHB(campaign.plannedBudget) : '—'}
                    </td>
                    <td className="text-end">
                      {rollup ? (
                        <>
                          {formatTHB(rollup.totalSpend)}
                          <div className="small text-muted">{rollup.entriesCount} entries</div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="text-end">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary me-2"
                        onClick={() => setModal({ kind: 'edit', campaign })}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-primary me-2"
                        onClick={() => setModal({ kind: 'performance', campaign })}
                      >
                        Log performance
                      </button>
                      {campaign.isActive && (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => void handleRetire(campaign)}
                        >
                          Retire
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="small text-muted mt-2">
        * Planned budget is INDICATIVE ONLY — actual cost is always the spend figures you log under
        Performance entries, never this planned figure.
      </p>

      {modal && csrfToken && (modal.kind === 'create' || modal.kind === 'edit') && (
        <CampaignFormModal
          csrfToken={csrfToken}
          campaign={modal.kind === 'edit' ? modal.campaign : null}
          contents={contents}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            void loadCampaigns();
          }}
        />
      )}

      {modal && csrfToken && modal.kind === 'performance' && (
        <PerformanceEntryModal
          csrfToken={csrfToken}
          campaign={modal.campaign}
          onClose={() => setModal(null)}
          onChanged={() => void loadCampaigns()}
        />
      )}
    </div>
  );
}

function CampaignFormModal(props: {
  csrfToken: string;
  campaign: AdCampaign | null;
  contents: Content[];
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const editing = props.campaign;
  const [externalCampaignName, setExternalCampaignName] = useState(editing?.externalCampaignName ?? '');
  const [externalCampaignId, setExternalCampaignId] = useState(editing?.externalCampaignId ?? '');
  const [objective, setObjective] = useState(editing?.objective ?? '');
  const [contentId, setContentId] = useState(editing?.contentId ?? '');
  const [startDate, setStartDate] = useState(editing?.startDate?.slice(0, 10) ?? '');
  const [endDate, setEndDate] = useState(editing?.endDate?.slice(0, 10) ?? '');
  const [plannedBudget, setPlannedBudget] = useState(editing?.plannedBudget?.toString() ?? '');
  const [status, setStatus] = useState<AdCampaignStatus>(editing?.status ?? 'active');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = canSubmitPaidCampaign({ externalCampaignName, objective, startDate, endDate });
  const dateRangeInvalid =
    startDate.trim().length > 0 && !isValidCampaignDateRange(startDate, endDate);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setIsSubmitting(true);
    try {
      if (editing) {
        await apiClient.updatePaidCampaign(
          editing.id,
          {
            externalCampaignName: externalCampaignName.trim(),
            objective: objective.trim(),
            contentId: contentId || undefined,
            startDate,
            endDate: endDate.trim() || undefined,
            plannedBudget: plannedBudget.trim() ? Number(plannedBudget) : undefined,
            status,
          },
          props.csrfToken,
        );
      } else {
        await apiClient.createPaidCampaign(
          {
            channel: 'meta',
            externalCampaignName: externalCampaignName.trim(),
            externalCampaignId: externalCampaignId.trim() || undefined,
            objective: objective.trim(),
            contentId: contentId || undefined,
            startDate,
            endDate: endDate.trim() || undefined,
            plannedBudget: plannedBudget.trim() ? Number(plannedBudget) : undefined,
            status,
          },
          props.csrfToken,
        );
      }
      props.onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save the campaign.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ModalShell
      titleId="campaign-form-title"
      heading={editing ? `Edit "${editing.externalCampaignName}"` : 'Add campaign'}
      onClose={props.onClose}
      size="lg"
    >
      <form onSubmit={(e) => void handleSubmit(e)} noValidate>
        <div className="modal-body">
          <div className="mb-3">
            <span className="form-label d-block">Channel</span>
            <span className="badge bg-primary">Meta</span>
            <div className="form-text">
              Meta is the only channel this phase — no code-level integration with any Meta tool exists;
              this is a manual visibility log.
            </div>
          </div>

          {editing && editing.externalCampaignId && (
            <div className="mb-3">
              <span className="form-label d-block">Campaign ID</span>
              <span className="text-muted small">{editing.externalCampaignId}</span>
              <div className="form-text">Identity fields are not editable after creation.</div>
            </div>
          )}

          <div className="mb-3">
            <label htmlFor="campaign-name" className="form-label">
              Campaign name <span className="text-danger">*</span>
            </label>
            <input
              id="campaign-name"
              type="text"
              className="form-control"
              value={externalCampaignName}
              onChange={(e) => setExternalCampaignName(e.target.value)}
              required
            />
          </div>

          {!editing && (
            <div className="mb-3">
              <label htmlFor="campaign-external-id" className="form-label">
                Campaign ID <span className="text-muted">(optional)</span>
              </label>
              <input
                id="campaign-external-id"
                type="text"
                className="form-control"
                value={externalCampaignId}
                onChange={(e) => setExternalCampaignId(e.target.value)}
              />
            </div>
          )}

          <div className="mb-3">
            <label htmlFor="campaign-objective" className="form-label">
              Objective <span className="text-danger">*</span>
            </label>
            <input
              id="campaign-objective"
              type="text"
              className="form-control"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              maxLength={PAID_OBJECTIVE_MAX_LENGTH}
              required
            />
            <div className="form-text">Copy exactly what Meta Ads Manager shows — this is not a fixed list.</div>
          </div>

          <div className="mb-3">
            <label htmlFor="campaign-content" className="form-label">
              Linked content <span className="text-muted">(optional)</span>
            </label>
            <select
              id="campaign-content"
              className="form-select"
              value={contentId}
              onChange={(e) => setContentId(e.target.value)}
            >
              <option value="">— none —</option>
              {props.contents.map((content) => (
                <option key={content.id} value={content.id}>
                  {content.title}
                </option>
              ))}
            </select>
            <div className="form-text">
              If this campaign promotes more than one piece of content, pick the one that matters most
              for attribution, or leave unlinked.
            </div>
          </div>

          <div className="row g-2 mb-2">
            <div className="col-6">
              <label htmlFor="campaign-start" className="form-label">
                Start date <span className="text-danger">*</span>
              </label>
              <input
                id="campaign-start"
                type="date"
                className="form-control"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
            <div className="col-6">
              <label htmlFor="campaign-end" className="form-label">
                End date <span className="text-muted">(blank = ongoing)</span>
              </label>
              <input
                id="campaign-end"
                type="date"
                className="form-control"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                aria-describedby="campaign-date-range-help"
              />
            </div>
          </div>
          {dateRangeInvalid && (
            <div id="campaign-date-range-help" className="text-danger small mb-2">
              {CAMPAIGN_DATE_RANGE_ERROR}
            </div>
          )}

          <div className="row g-2 mb-3">
            <div className="col-6">
              <label htmlFor="campaign-budget" className="form-label">
                Planned budget (THB) <span className="text-muted">(optional, indicative only)</span>
              </label>
              <input
                id="campaign-budget"
                type="number"
                min={0}
                step="0.01"
                className="form-control"
                value={plannedBudget}
                onChange={(e) => setPlannedBudget(e.target.value)}
              />
            </div>
            <div className="col-6">
              <span className="form-label d-block">Status</span>
              {CAMPAIGN_STATUSES.map((value) => (
                <div className="form-check form-check-inline" key={value}>
                  <input
                    id={`campaign-status-${value}`}
                    type="radio"
                    className="form-check-input"
                    name="campaign-status"
                    value={value}
                    checked={status === value}
                    onChange={() => setStatus(value)}
                  />
                  <label className="form-check-label" htmlFor={`campaign-status-${value}`}>
                    {labels.campaignStatus(value)}
                  </label>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="alert alert-danger mt-3" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-outline-secondary" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? 'Saving…' : editing ? 'Save changes' : 'Add campaign'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function PerformanceEntryModal(props: {
  csrfToken: string;
  campaign: AdCampaign;
  onClose: () => void;
  onChanged: () => void;
}): JSX.Element {
  const { campaign } = props;
  const [entries, setEntries] = useState<AdPerformanceEntry[]>([]);
  const [isLoadingEntries, setIsLoadingEntries] = useState(true);

  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [spend, setSpend] = useState('');
  const [reach, setReach] = useState('');
  const [impressions, setImpressions] = useState('');
  const [clicks, setClicks] = useState('');
  const [resultType, setResultType] = useState('');
  const [resultCount, setResultCount] = useState('');
  const [correctsEntryId, setCorrectsEntryId] = useState('');
  const [sourceRef, setSourceRef] = useState('');
  const [overlaps, setOverlaps] = useState<AdPerformanceEntry[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    setIsLoadingEntries(true);
    try {
      setEntries(await apiClient.listPerformanceEntries(campaign.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load performance history.');
    } finally {
      setIsLoadingEntries(false);
    }
  }, [campaign.id]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    if (!periodStart || !periodEnd) {
      setOverlaps([]);
      return;
    }
    const handle = setTimeout(() => {
      void apiClient
        .checkPerformanceOverlap(campaign.id, { periodStart, periodEnd })
        .then((res) => setOverlaps(res.overlaps))
        .catch(() => setOverlaps([]));
    }, OVERLAP_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [campaign.id, periodStart, periodEnd]);

  const canSubmit = canSubmitPerformanceEntry({ periodStart, periodEnd, spend, sourceRef });

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await apiClient.createPerformanceEntry(
        campaign.id,
        {
          periodStart,
          periodEnd,
          spend: Number(spend),
          reach: reach.trim() ? Number(reach) : undefined,
          impressions: impressions.trim() ? Number(impressions) : undefined,
          clicks: clicks.trim() ? Number(clicks) : undefined,
          resultType: resultType.trim() || undefined,
          resultCount: resultCount.trim() ? Number(resultCount) : undefined,
          correctsEntryId: correctsEntryId || undefined,
          sourceRef: sourceRef.trim() || undefined,
        },
        props.csrfToken,
      );
      setPeriodStart('');
      setPeriodEnd('');
      setSpend('');
      setReach('');
      setImpressions('');
      setClicks('');
      setResultType('');
      setResultCount('');
      setCorrectsEntryId('');
      setSourceRef('');
      await loadEntries();
      props.onChanged();
    } catch (err) {
      const status = err instanceof ApiError ? err.status : undefined;
      const message = err instanceof ApiError ? err.message : 'Failed to add the performance entry.';
      setError(describePaidEntryError({ status, message }).message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ModalShell
      titleId="performance-entry-title"
      heading={`Log performance · ${campaign.externalCampaignName}`}
      onClose={props.onClose}
      size="lg"
    >
      <div className="modal-body">
        <div className="alert alert-info py-2" role="note">
          Enter figures from Meta Ads Manager for this campaign. Records are append-only: to correct
          one, add a new entry noting which it corrects. Nothing here is ever edited or deleted.
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} noValidate>
          <div className="row g-2 mb-2">
            <div className="col-6">
              <label htmlFor="entry-period-start" className="form-label">
                Period from <span className="text-danger">*</span>
              </label>
              <input
                id="entry-period-start"
                type="date"
                className="form-control"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                required
              />
            </div>
            <div className="col-6">
              <label htmlFor="entry-period-end" className="form-label">
                Period to <span className="text-danger">*</span>
              </label>
              <input
                id="entry-period-end"
                type="date"
                className="form-control"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                required
              />
            </div>
          </div>

          {overlaps.length > 0 && (
            <div className="alert alert-warning py-2" role="alert">
              You already logged this campaign overlapping this period ({overlaps.length} record
              {overlaps.length === 1 ? '' : 's'}). Logging again may double-count — this is a warning,
              not a block.
            </div>
          )}

          <div className="mb-2">
            <label htmlFor="entry-spend" className="form-label">
              Spend (THB) <span className="text-danger">*</span>
            </label>
            <input
              id="entry-spend"
              type="number"
              min={0}
              step="0.01"
              className="form-control"
              value={spend}
              onChange={(e) => setSpend(e.target.value)}
              aria-describedby="entry-spend-help"
              required
            />
            <div id="entry-spend-help" className="form-text">
              What Ads Manager reports as amount spent for this period.
            </div>
          </div>

          <div className="row g-2 mb-2">
            <div className="col-4">
              <label htmlFor="entry-reach" className="form-label">
                Reach <span className="text-muted">(optional)</span>
              </label>
              <input
                id="entry-reach"
                type="number"
                min={0}
                className="form-control"
                value={reach}
                onChange={(e) => setReach(e.target.value)}
              />
            </div>
            <div className="col-4">
              <label htmlFor="entry-impressions" className="form-label">
                Impressions <span className="text-muted">(optional)</span>
              </label>
              <input
                id="entry-impressions"
                type="number"
                min={0}
                className="form-control"
                value={impressions}
                onChange={(e) => setImpressions(e.target.value)}
              />
            </div>
            <div className="col-4">
              <label htmlFor="entry-clicks" className="form-label">
                Clicks <span className="text-muted">(optional)</span>
              </label>
              <input
                id="entry-clicks"
                type="number"
                min={0}
                className="form-control"
                value={clicks}
                onChange={(e) => setClicks(e.target.value)}
              />
            </div>
          </div>

          <div className="row g-2 mb-2">
            <div className="col-8">
              <label htmlFor="entry-result-type" className="form-label">
                Result type <span className="text-muted">(optional)</span>
              </label>
              <input
                id="entry-result-type"
                type="text"
                className="form-control"
                placeholder="e.g. Purchases, Leads, Link clicks, Video views"
                value={resultType}
                onChange={(e) => setResultType(e.target.value)}
              />
            </div>
            <div className="col-4">
              <label htmlFor="entry-result-count" className="form-label">
                Result count <span className="text-muted">(optional)</span>
              </label>
              <input
                id="entry-result-count"
                type="number"
                min={0}
                className="form-control"
                value={resultCount}
                onChange={(e) => setResultCount(e.target.value)}
              />
            </div>
          </div>

          <div className="mb-2">
            <label htmlFor="entry-corrects" className="form-label">
              Corrects <span className="text-muted">(optional)</span>
            </label>
            <select
              id="entry-corrects"
              className="form-select form-select-sm"
              value={correctsEntryId}
              onChange={(e) => setCorrectsEntryId(e.target.value)}
            >
              <option value="">— none —</option>
              {entries.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.periodStart.slice(0, 10)}–{entry.periodEnd.slice(0, 10)} ·{' '}
                  {formatTHB(entry.spend)}
                </option>
              ))}
            </select>
            <div className="form-text">
              Pick the entry this one corrects, if it&apos;s a fix — never a reversal; ad spend has no
              &quot;refund,&quot; so just log the right numbers here.
            </div>
          </div>

          <div className="mb-2">
            <label htmlFor="entry-source-ref" className="form-label">
              Source ref <span className="text-muted">(optional)</span>
            </label>
            <input
              id="entry-source-ref"
              type="text"
              className="form-control"
              value={sourceRef}
              onChange={(e) => setSourceRef(e.target.value)}
              maxLength={64}
              aria-describedby="entry-source-ref-help"
            />
            <div
              id="entry-source-ref-help"
              className={`form-text ${sourceRef && !isValidSourceRef(sourceRef) ? 'text-danger' : ''}`}
            >
              {SOURCE_REF_HELP_TEXT}
            </div>
          </div>

          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}

          <div className="d-flex justify-content-end">
            <button type="submit" className="btn btn-primary" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Add entry'}
            </button>
          </div>
        </form>

        <hr className="my-4" />

        <div className="d-flex justify-content-between align-items-center mb-2">
          <h2 className="h6 mb-0">History — {campaign.externalCampaignName}</h2>
          <PaidExportCsvButton
            query={{ campaignId: campaign.id }}
            label="Export paid CSV"
            disabled={entries.length === 0}
          />
        </div>

        {isLoadingEntries ? (
          <p className="text-muted small">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-muted small">No performance entries logged yet.</p>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th scope="col">Period</th>
                  <th scope="col" className="text-end">
                    Spend
                  </th>
                  <th scope="col" className="text-end">
                    Reach
                  </th>
                  <th scope="col">Result</th>
                  <th scope="col">Recorded</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="small">
                      {entry.periodStart.slice(0, 10)} – {entry.periodEnd.slice(0, 10)}
                      {isCorrection(entry) && (
                        <div className="small text-muted">
                          <span className="badge bg-warning text-dark me-1">Correction</span>
                          corrects entry {entry.correctsEntryId?.slice(0, 8)}
                        </div>
                      )}
                    </td>
                    <td className="text-end fw-semibold">{formatTHB(entry.spend)}</td>
                    <td className="text-end">{entry.reach ?? '—'}</td>
                    <td className="small">
                      {entry.resultType ? `${entry.resultType} (${entry.resultCount ?? 0})` : '—'}
                    </td>
                    <td className="small">{new Date(entry.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-outline-secondary" onClick={props.onClose}>
          Done
        </button>
      </div>
    </ModalShell>
  );
}

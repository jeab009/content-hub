'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { useRouter } from 'next/navigation';
import {
  apiClient,
  ApiError,
  type CommerceChannel,
  type CommerceConversion,
  type CommercePlacement,
  type CommerceProduct,
  type CurrentUser,
  type Post,
} from '@/lib/api-client';
import {
  canSubmitCommerceConversion,
  isReversalAmount,
  isValidStatementRef,
  STATEMENT_REF_HELP_TEXT,
} from '@/lib/commerce-logic';
import { COMMERCE_CHANNELS, formatTHB, labels } from '@/lib/content-labels';
import { AppHeader } from '@/components/AppHeader';
import { CommerceTabs } from '@/components/commerce/CommerceTabs';
import { ModalShell } from '@/components/commerce/ModalShell';
import { CommerceExportCsvButton } from '@/components/commerce/CommerceExportCsvButton';

const OVERLAP_DEBOUNCE_MS = 400;

export default function CommerceConversionsPage(): JSX.Element {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [conversions, setConversions] = useState<CommerceConversion[]>([]);
  const [channelFilter, setChannelFilter] = useState<CommerceChannel | ''>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEntryModal, setShowEntryModal] = useState(false);

  const loadConversions = useCallback(async () => {
    try {
      setConversions(await apiClient.listCommerceConversions({ channel: channelFilter || undefined }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }
      setError('Failed to load commission history.');
    }
  }, [channelFilter, router]);

  const loadInitial = useCallback(async () => {
    try {
      const [currentUser, csrf] = await Promise.all([apiClient.me(), apiClient.getCsrfToken()]);
      setUser(currentUser);
      setCsrfToken(csrf.csrfToken);
      await loadConversions();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }
      setError('Failed to load commission history.');
    } finally {
      setIsLoading(false);
    }
  }, [router, loadConversions]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    if (!isLoading) void loadConversions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelFilter]);

  if (isLoading) {
    return <p>Loading…</p>;
  }

  return (
    <div>
      <AppHeader>{user && <span className="text-muted small">{user.email}</span>}</AppHeader>

      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h3 mb-0">Commerce</h1>
        <button type="button" className="btn btn-primary" onClick={() => setShowEntryModal(true)}>
          + Add commission record
        </button>
      </div>

      <CommerceTabs active="conversions" />

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      <p className="text-muted small">
        Records are append-only: to correct one, add a new row with a negative amount. Nothing here
        is ever edited or deleted.
      </p>

      <div className="d-flex justify-content-between align-items-end mb-3">
        <div>
          <label htmlFor="filter-conversion-channel" className="form-label small mb-1">
            Channel
          </label>
          <select
            id="filter-conversion-channel"
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
        <CommerceExportCsvButton
          query={{ channel: channelFilter || undefined }}
          label="Export commerce CSV"
          disabled={conversions.length === 0}
        />
      </div>

      {conversions.length === 0 ? (
        <div className="text-center text-muted border rounded py-5">
          <p className="mb-0">
            No commission records yet. Add them from Commerce → Conversions after your first payout
            statement.
          </p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-hover align-middle">
            <thead>
              <tr>
                <th scope="col">Channel</th>
                <th scope="col">Period</th>
                <th scope="col" className="text-end">
                  Amount
                </th>
                <th scope="col" className="text-end">
                  Orders
                </th>
                <th scope="col">Statement</th>
                <th scope="col">Recorded</th>
              </tr>
            </thead>
            <tbody>
              {conversions.map((conversion) => {
                const reversal = isReversalAmount(conversion.commissionAmount);
                return (
                  <tr key={conversion.id}>
                    <td>
                      <span className={`badge ${labels.channelBadgeClass(conversion.channel)}`}>
                        {labels.channel(conversion.channel)}
                      </span>
                    </td>
                    <td className="small">
                      {conversion.periodStart.slice(0, 10)} – {conversion.periodEnd.slice(0, 10)}
                    </td>
                    <td className={`text-end fw-semibold ${reversal ? 'text-danger' : ''}`}>
                      {formatTHB(conversion.commissionAmount)}
                      {reversal && (
                        <div className="small text-danger fw-normal">
                          Reversal
                          {conversion.reversalOfId ? ' · reverses a prior record' : ''}
                        </div>
                      )}
                    </td>
                    <td className="text-end">{conversion.ordersCount ?? '—'}</td>
                    <td className="small">{conversion.statementRef ?? '—'}</td>
                    <td className="small">{new Date(conversion.createdAt).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showEntryModal && csrfToken && (
        <ConversionEntryModal
          csrfToken={csrfToken}
          onClose={() => setShowEntryModal(false)}
          onSaved={() => {
            setShowEntryModal(false);
            void loadConversions();
          }}
        />
      )}
    </div>
  );
}

function ConversionEntryModal(props: {
  csrfToken: string;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const [channel, setChannel] = useState<CommerceChannel | ''>('shopee');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [commissionAmount, setCommissionAmount] = useState('');
  const [grossSalesAmount, setGrossSalesAmount] = useState('');
  const [ordersCount, setOrdersCount] = useState('');
  const [itemsSold, setItemsSold] = useState('');
  const [postId, setPostId] = useState('');
  const [placementId, setPlacementId] = useState('');
  const [productId, setProductId] = useState('');
  const [reversalOfId, setReversalOfId] = useState('');
  const [statementRef, setStatementRef] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [posts, setPosts] = useState<Post[]>([]);
  const [placements, setPlacements] = useState<CommercePlacement[]>([]);
  const [products, setProducts] = useState<CommerceProduct[]>([]);
  const [priorConversions, setPriorConversions] = useState<CommerceConversion[]>([]);
  const [overlaps, setOverlaps] = useState<CommerceConversion[]>([]);

  useEffect(() => {
    void apiClient.listPosts().then(setPosts).catch(() => setPosts([]));
    void apiClient.listCommercePlacements().then(setPlacements).catch(() => setPlacements([]));
    void apiClient.listCommerceProducts().then(setProducts).catch(() => setProducts([]));
    void apiClient.listCommerceConversions().then(setPriorConversions).catch(() => setPriorConversions([]));
  }, []);

  useEffect(() => {
    if (channel === '' || !periodStart || !periodEnd) {
      setOverlaps([]);
      return;
    }
    const handle = setTimeout(() => {
      void apiClient
        .checkConversionOverlap({ channel, periodStart, periodEnd })
        .then((res) => setOverlaps(res.overlaps))
        .catch(() => setOverlaps([]));
    }, OVERLAP_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [channel, periodStart, periodEnd]);

  const canSubmit =
    channel !== '' &&
    canSubmitCommerceConversion({ channel, periodStart, periodEnd, commissionAmount, statementRef });

  const willBeReversal = useMemo(() => {
    const amount = Number(commissionAmount);
    return commissionAmount.trim() !== '' && !Number.isNaN(amount) && amount < 0;
  }, [commissionAmount]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    // `canSubmit` already required `channel !== ''` (TS narrows `channel` to
    // CommerceChannel for the rest of this function via aliased-condition CFA).
    if (!canSubmit) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await apiClient.createCommerceConversion(
        {
          channel,
          periodStart,
          periodEnd,
          commissionAmount: Number(commissionAmount),
          grossSalesAmount: grossSalesAmount.trim() ? Number(grossSalesAmount) : undefined,
          ordersCount: ordersCount.trim() ? Number(ordersCount) : undefined,
          itemsSold: itemsSold.trim() ? Number(itemsSold) : undefined,
          postId: postId || undefined,
          placementId: placementId || undefined,
          productId: productId || undefined,
          reversalOfId: reversalOfId || undefined,
          statementRef: statementRef.trim() || undefined,
        },
        props.csrfToken,
      );
      props.onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add the commission record.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ModalShell titleId="conversion-entry-title" heading="Add commission record" onClose={props.onClose} size="lg">
      <form onSubmit={(e) => void handleSubmit(e)} noValidate>
        <div className="modal-body">
          <div className="alert alert-info py-2" role="note">
            Enter figures from your payout statement. Records are append-only: to correct one, add a
            new row with a negative amount.
          </div>

          <div className="mb-3">
            <span className="form-label d-block">
              Channel <span className="text-danger">*</span>
            </span>
            {COMMERCE_CHANNELS.map((value) => (
              <div className="form-check form-check-inline" key={value}>
                <input
                  id={`conversion-channel-${value}`}
                  type="radio"
                  className="form-check-input"
                  name="conversion-channel"
                  value={value}
                  checked={channel === value}
                  onChange={() => setChannel(value)}
                />
                <label className="form-check-label" htmlFor={`conversion-channel-${value}`}>
                  {labels.channel(value)}
                </label>
              </div>
            ))}
          </div>

          <div className="row g-2 mb-2">
            <div className="col-6">
              <label htmlFor="conversion-period-start" className="form-label">
                Period from <span className="text-danger">*</span>
              </label>
              <input
                id="conversion-period-start"
                type="date"
                className="form-control"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                required
              />
            </div>
            <div className="col-6">
              <label htmlFor="conversion-period-end" className="form-label">
                Period to <span className="text-danger">*</span>
              </label>
              <input
                id="conversion-period-end"
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
              You already recorded {labels.channel(channel || 'shopee')} commission overlapping this
              period ({overlaps.length} record{overlaps.length === 1 ? '' : 's'}). Recording again may
              double-count — this is a warning, not a block.
            </div>
          )}

          <div className="mb-2">
            <label htmlFor="conversion-amount" className="form-label">
              Commission amount (THB) <span className="text-danger">*</span>
            </label>
            <input
              id="conversion-amount"
              type="number"
              step="0.01"
              className="form-control"
              value={commissionAmount}
              onChange={(e) => setCommissionAmount(e.target.value)}
              aria-describedby="conversion-amount-help"
              required
            />
            <div id="conversion-amount-help" className="form-text">
              Negative amounts are allowed and mean a reversal or refund.
              {willBeReversal && <span className="text-danger fw-semibold"> This will be recorded as a Reversal.</span>}
            </div>
          </div>

          <div className="row g-2 mb-2">
            <div className="col-4">
              <label htmlFor="conversion-gross" className="form-label">
                Gross sales <span className="text-muted">(optional)</span>
              </label>
              <input
                id="conversion-gross"
                type="number"
                step="0.01"
                min={0}
                className="form-control"
                value={grossSalesAmount}
                onChange={(e) => setGrossSalesAmount(e.target.value)}
              />
            </div>
            <div className="col-4">
              <label htmlFor="conversion-orders" className="form-label">
                Orders <span className="text-muted">(optional)</span>
              </label>
              <input
                id="conversion-orders"
                type="number"
                min={0}
                className="form-control"
                value={ordersCount}
                onChange={(e) => setOrdersCount(e.target.value)}
              />
            </div>
            <div className="col-4">
              <label htmlFor="conversion-items" className="form-label">
                Items sold <span className="text-muted">(optional)</span>
              </label>
              <input
                id="conversion-items"
                type="number"
                min={0}
                className="form-control"
                value={itemsSold}
                onChange={(e) => setItemsSold(e.target.value)}
              />
            </div>
          </div>

          <p className="fw-semibold mb-2">Attribute to (all optional)</p>
          <div className="row g-2 mb-2">
            <div className="col-6">
              <label htmlFor="conversion-post" className="form-label">
                Post
              </label>
              <select
                id="conversion-post"
                className="form-select form-select-sm"
                value={postId}
                onChange={(e) => setPostId(e.target.value)}
              >
                <option value="">— none —</option>
                {posts.map((post) => (
                  <option key={post.id} value={post.id}>
                    {labels.postPlatform(post.platform)} · {post.externalPostId ?? post.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-6">
              <label htmlFor="conversion-placement" className="form-label">
                Placement
              </label>
              <select
                id="conversion-placement"
                className="form-select form-select-sm"
                value={placementId}
                onChange={(e) => setPlacementId(e.target.value)}
              >
                <option value="">— none —</option>
                {placements.map((placement) => (
                  <option key={placement.id} value={placement.id}>
                    {labels.channel(placement.channel)} · {placement.externalMediaId}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="row g-2 mb-2">
            <div className="col-6">
              <label htmlFor="conversion-product" className="form-label">
                Product
              </label>
              <select
                id="conversion-product"
                className="form-select form-select-sm"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
              >
                <option value="">— none —</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-6">
              <label htmlFor="conversion-reverses" className="form-label">
                Reverses
              </label>
              <select
                id="conversion-reverses"
                className="form-select form-select-sm"
                value={reversalOfId}
                onChange={(e) => setReversalOfId(e.target.value)}
              >
                <option value="">— none —</option>
                {priorConversions.map((conversion) => (
                  <option key={conversion.id} value={conversion.id}>
                    {conversion.periodStart.slice(0, 10)}–{conversion.periodEnd.slice(0, 10)} ·{' '}
                    {formatTHB(conversion.commissionAmount)}
                  </option>
                ))}
              </select>
              <div className="form-text">Pick the record this one cancels, if it is a correction.</div>
            </div>
          </div>

          <div className="mb-2">
            <label htmlFor="conversion-statement-ref" className="form-label">
              Statement ref <span className="text-muted">(optional)</span>
            </label>
            <input
              id="conversion-statement-ref"
              type="text"
              className="form-control"
              value={statementRef}
              onChange={(e) => setStatementRef(e.target.value)}
              maxLength={64}
              aria-describedby="conversion-statement-ref-help"
            />
            <div
              id="conversion-statement-ref-help"
              className={`form-text ${statementRef && !isValidStatementRef(statementRef) ? 'text-danger' : ''}`}
            >
              {STATEMENT_REF_HELP_TEXT}
            </div>
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
          <button type="submit" className="btn btn-primary" disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Add record'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

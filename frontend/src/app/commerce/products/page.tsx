'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { useRouter } from 'next/navigation';
import {
  apiClient,
  ApiError,
  type AffiliateLink,
  type CommerceChannel,
  type CommerceProduct,
  type CurrentUser,
} from '@/lib/api-client';
import { canSubmitAffiliateLink, canSubmitCommerceProduct } from '@/lib/commerce-logic';
import { COMMERCE_CHANNELS, labels } from '@/lib/content-labels';
import { AppHeader } from '@/components/AppHeader';
import { CommerceTabs } from '@/components/commerce/CommerceTabs';
import { ModalShell } from '@/components/commerce/ModalShell';

type StatusFilter = 'active' | 'retired' | 'all';

type ModalState =
  | { kind: 'create' }
  | { kind: 'edit'; product: CommerceProduct }
  | { kind: 'links'; product: CommerceProduct }
  | null;

export default function CommerceProductsPage(): JSX.Element {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [products, setProducts] = useState<CommerceProduct[]>([]);
  const [linkCounts, setLinkCounts] = useState<Map<string, number>>(new Map());
  const [channelFilter, setChannelFilter] = useState<CommerceChannel | ''>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);

  const loadProducts = useCallback(async () => {
    try {
      const rows = await apiClient.listCommerceProducts({
        channel: channelFilter || undefined,
        isActive: statusFilter === 'all' ? undefined : statusFilter === 'active',
      });
      setProducts(rows);
      // Link counts are fetched best-effort per product for the list column;
      // failures here are non-fatal (the row still renders, count shows "—").
      const counts = new Map<string, number>();
      await Promise.all(
        rows.map(async (product) => {
          try {
            const links = await apiClient.listAffiliateLinks(product.id);
            counts.set(product.id, links.filter((link) => link.isActive).length);
          } catch {
            // leave uncounted
          }
        }),
      );
      setLinkCounts(counts);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }
      setError('Failed to load the product catalog.');
    }
  }, [channelFilter, statusFilter, router]);

  const loadInitial = useCallback(async () => {
    try {
      const [currentUser, csrf] = await Promise.all([apiClient.me(), apiClient.getCsrfToken()]);
      setUser(currentUser);
      setCsrfToken(csrf.csrfToken);
      await loadProducts();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }
      setError('Failed to load the product catalog.');
    } finally {
      setIsLoading(false);
    }
  }, [router, loadProducts]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    if (!isLoading) void loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelFilter, statusFilter]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term === '') return products;
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(term) ||
        product.externalProductId.toLowerCase().includes(term),
    );
  }, [products, search]);

  async function handleRetire(product: CommerceProduct): Promise<void> {
    if (!csrfToken) return;
    if (
      !window.confirm(
        `Retire "${product.name}"? It stays on existing anchors and conversion records — retiring only removes it from the picker for new anchors.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      await apiClient.retireCommerceProduct(product.id, csrfToken);
      await loadProducts();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to retire the product.');
    }
  }

  if (isLoading) {
    return <p>Loading…</p>;
  }

  return (
    <div>
      <AppHeader>{user && <span className="text-muted small">{user.email}</span>}</AppHeader>

      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h3 mb-0">Commerce</h1>
        <button type="button" className="btn btn-primary" onClick={() => setModal({ kind: 'create' })}>
          + Add product
        </button>
      </div>

      <CommerceTabs active="products" />

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      <div className="d-flex flex-wrap gap-3 align-items-end mb-3">
        <div>
          <label htmlFor="filter-channel" className="form-label small mb-1">
            Channel
          </label>
          <select
            id="filter-channel"
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
            placeholder="Name or product id"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center text-muted border rounded py-5">
          <p className="mb-0">No products yet. Add one to start anchoring it on posts and placements.</p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-hover align-middle">
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Channel</th>
                <th scope="col">Product ID</th>
                <th scope="col" className="text-end">
                  List price
                </th>
                <th scope="col" className="text-end">
                  Rate*
                </th>
                <th scope="col" className="text-end">
                  Links
                </th>
                <th scope="col" className="text-end">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((product) => (
                <tr key={product.id}>
                  <td>
                    <div className="fw-semibold">{product.name}</div>
                    <div className="small text-muted">
                      {product.isActive ? (
                        'Active'
                      ) : (
                        <>Retired{product.retiredAt ? ` · ${product.retiredAt.slice(0, 10)}` : ''}</>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${labels.channelBadgeClass(product.channel)}`}>
                      {labels.channel(product.channel)}
                    </span>
                  </td>
                  <td className="small text-muted">{product.externalProductId}</td>
                  <td className="text-end">
                    {product.listPrice !== null ? `฿${product.listPrice.toFixed(2)}` : '—'}
                  </td>
                  <td className="text-end">
                    {product.commissionRatePct !== null ? `${product.commissionRatePct.toFixed(2)}%` : '—'}
                  </td>
                  <td className="text-end">{linkCounts.get(product.id) ?? '—'}</td>
                  <td className="text-end">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary me-2"
                      onClick={() => setModal({ kind: 'edit', product })}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary me-2"
                      onClick={() => setModal({ kind: 'links', product })}
                    >
                      Manage links
                    </button>
                    {product.isActive && (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger"
                        onClick={() => void handleRetire(product)}
                      >
                        Retire
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="small text-muted mt-2">
        * Commission rate is INDICATIVE ONLY — taken from the channel listing at entry time. Actual
        earnings are always the commission amounts you enter from the payout statement, never rate ×
        sales.
      </p>

      {modal && csrfToken && (modal.kind === 'create' || modal.kind === 'edit') && (
        <ProductFormModal
          csrfToken={csrfToken}
          product={modal.kind === 'edit' ? modal.product : null}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            void loadProducts();
          }}
        />
      )}

      {modal && csrfToken && modal.kind === 'links' && (
        <ManageLinksModal
          csrfToken={csrfToken}
          product={modal.product}
          onClose={() => setModal(null)}
          onChanged={() => void loadProducts()}
        />
      )}
    </div>
  );
}

function ProductFormModal(props: {
  csrfToken: string;
  product: CommerceProduct | null;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const editing = props.product;
  const [channel, setChannel] = useState<CommerceChannel | ''>(editing?.channel ?? '');
  const [externalProductId, setExternalProductId] = useState(editing?.externalProductId ?? '');
  const [name, setName] = useState(editing?.name ?? '');
  const [sku, setSku] = useState(editing?.sku ?? '');
  const [productUrl, setProductUrl] = useState(editing?.productUrl ?? '');
  const [listPrice, setListPrice] = useState(editing?.listPrice?.toString() ?? '');
  const [commissionRatePct, setCommissionRatePct] = useState(
    editing?.commissionRatePct?.toString() ?? '',
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = editing
    ? name.trim().length > 0
    : canSubmitCommerceProduct({ channel, externalProductId, name });

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setIsSubmitting(true);
    try {
      if (editing) {
        await apiClient.updateCommerceProduct(
          editing.id,
          {
            name: name.trim(),
            sku: sku.trim() || undefined,
            productUrl: productUrl.trim() || undefined,
            listPrice: listPrice.trim() ? Number(listPrice) : undefined,
            commissionRatePct: commissionRatePct.trim() ? Number(commissionRatePct) : undefined,
          },
          props.csrfToken,
        );
      } else if (channel !== '') {
        await apiClient.createCommerceProduct(
          {
            channel,
            externalProductId: externalProductId.trim(),
            name: name.trim(),
            sku: sku.trim() || undefined,
            productUrl: productUrl.trim() || undefined,
            listPrice: listPrice.trim() ? Number(listPrice) : undefined,
            commissionRatePct: commissionRatePct.trim() ? Number(commissionRatePct) : undefined,
          },
          props.csrfToken,
        );
      }
      props.onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save the product.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ModalShell
      titleId="product-form-title"
      heading={editing ? `Edit “${editing.name}”` : 'Add product'}
      onClose={props.onClose}
      size="lg"
    >
      <form onSubmit={(e) => void handleSubmit(e)} noValidate>
        <div className="modal-body">
          {!editing && (
            <>
              <div className="mb-3">
                <label htmlFor="product-channel" className="form-label">
                  Channel <span className="text-danger">*</span>
                </label>
                <select
                  id="product-channel"
                  className="form-select"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value as CommerceChannel)}
                  required
                >
                  <option value="">Choose a channel…</option>
                  {COMMERCE_CHANNELS.map((value) => (
                    <option key={value} value={value}>
                      {labels.channel(value)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mb-3">
                <label htmlFor="product-external-id" className="form-label">
                  Channel product ID <span className="text-danger">*</span>
                </label>
                <input
                  id="product-external-id"
                  type="text"
                  className="form-control"
                  value={externalProductId}
                  onChange={(e) => setExternalProductId(e.target.value)}
                  required
                />
              </div>
            </>
          )}
          <div className="mb-3">
            <label htmlFor="product-name" className="form-label">
              Name <span className="text-danger">*</span>
            </label>
            <input
              id="product-name"
              type="text"
              className="form-control"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="row g-2 mb-3">
            <div className="col-6">
              <label htmlFor="product-sku" className="form-label">
                SKU <span className="text-muted">(optional)</span>
              </label>
              <input
                id="product-sku"
                type="text"
                className="form-control"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
              />
            </div>
            <div className="col-6">
              <label htmlFor="product-url" className="form-label">
                Product URL <span className="text-muted">(optional)</span>
              </label>
              <input
                id="product-url"
                type="url"
                className="form-control"
                placeholder="https://…"
                value={productUrl}
                onChange={(e) => setProductUrl(e.target.value)}
              />
            </div>
          </div>
          <div className="row g-2">
            <div className="col-6">
              <label htmlFor="product-list-price" className="form-label">
                List price (THB) <span className="text-muted">(optional)</span>
              </label>
              <input
                id="product-list-price"
                type="number"
                min={0}
                step="0.01"
                className="form-control"
                value={listPrice}
                onChange={(e) => setListPrice(e.target.value)}
              />
            </div>
            <div className="col-6">
              <label htmlFor="product-rate" className="form-label">
                Commission rate % <span className="text-muted">(optional, indicative only)</span>
              </label>
              <input
                id="product-rate"
                type="number"
                min={0}
                max={100}
                step="0.01"
                className="form-control"
                value={commissionRatePct}
                onChange={(e) => setCommissionRatePct(e.target.value)}
              />
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
            {isSubmitting ? 'Saving…' : editing ? 'Save changes' : 'Add product'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ManageLinksModal(props: {
  csrfToken: string;
  product: CommerceProduct;
  onClose: () => void;
  onChanged: () => void;
}): JSX.Element {
  const { product } = props;
  const [links, setLinks] = useState<AffiliateLink[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [url, setUrl] = useState('');
  const [trackingCode, setTrackingCode] = useState('');
  const [subId, setSubId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLinks = useCallback(async () => {
    setIsLoading(true);
    try {
      setLinks(await apiClient.listAffiliateLinks(product.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load links.');
    } finally {
      setIsLoading(false);
    }
  }, [product.id]);

  useEffect(() => {
    void loadLinks();
  }, [loadLinks]);

  async function handleAdd(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmitAffiliateLink(url)) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await apiClient.createAffiliateLink(
        product.id,
        { url: url.trim(), trackingCode: trackingCode.trim() || undefined, subId: subId.trim() || undefined },
        props.csrfToken,
      );
      setUrl('');
      setTrackingCode('');
      setSubId('');
      await loadLinks();
      props.onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add the link.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRetire(link: AffiliateLink): Promise<void> {
    setError(null);
    try {
      await apiClient.retireAffiliateLink(link.id, props.csrfToken);
      await loadLinks();
      props.onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to retire the link.');
    }
  }

  return (
    <ModalShell
      titleId="links-modal-title"
      heading={`Manage links · ${product.name}`}
      onClose={props.onClose}
      size="lg"
    >
      <div className="modal-body">
        <p className="text-muted small mb-3">
          Links belong to this product on {labels.channel(product.channel)}.
        </p>

        {error && (
          <div className="alert alert-danger" role="alert">
            {error}
          </div>
        )}

        {isLoading ? (
          <p className="text-muted small">Loading…</p>
        ) : links.length === 0 ? (
          <p className="text-muted small">No links yet.</p>
        ) : (
          <div className="table-responsive mb-3">
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th scope="col">URL</th>
                  <th scope="col">Tracking</th>
                  <th scope="col">Sub-id</th>
                  <th scope="col">Status</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {links.map((link) => (
                  <tr key={link.id}>
                    <td className="text-break small">{link.url}</td>
                    <td className="small">{link.trackingCode ?? '—'}</td>
                    <td className="small">{link.subId ?? '—'}</td>
                    <td className="small">{link.isActive ? 'Active' : 'Retired'}</td>
                    <td className="text-end">
                      {link.isActive && (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => void handleRetire(link)}
                        >
                          Retire
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form onSubmit={(e) => void handleAdd(e)} noValidate>
          <p className="fw-semibold mb-2">+ Add link</p>
          <div className="mb-2">
            <label htmlFor="link-url" className="form-label">
              URL <span className="text-danger">*</span>
            </label>
            <input
              id="link-url"
              type="url"
              className="form-control"
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
          </div>
          <div className="row g-2 mb-2">
            <div className="col-6">
              <label htmlFor="link-tracking" className="form-label">
                Tracking code <span className="text-muted">(optional)</span>
              </label>
              <input
                id="link-tracking"
                type="text"
                className="form-control"
                value={trackingCode}
                onChange={(e) => setTrackingCode(e.target.value)}
              />
            </div>
            <div className="col-6">
              <label htmlFor="link-subid" className="form-label">
                Sub-id <span className="text-muted">(optional)</span>
              </label>
              <input
                id="link-subid"
                type="text"
                className="form-control"
                value={subId}
                onChange={(e) => setSubId(e.target.value)}
              />
            </div>
          </div>
          <div className="d-flex justify-content-end">
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={!canSubmitAffiliateLink(url) || isSubmitting}
            >
              {isSubmitting ? 'Adding…' : 'Add link'}
            </button>
          </div>
        </form>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-outline-secondary" onClick={props.onClose}>
          Done
        </button>
      </div>
    </ModalShell>
  );
}


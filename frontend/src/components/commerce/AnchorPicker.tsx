'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import {
  apiClient,
  ApiError,
  type AffiliateLink,
  type AnchorItemInput,
  type CommerceChannel,
  type CommerceProduct,
} from '@/lib/api-client';
import { buildAnchorsPayload, moveEarlier, moveLater } from '@/lib/commerce-logic';
import { labels } from '@/lib/content-labels';

export interface AnchorPickerValue {
  order: string[];
  linkByProduct: Map<string, string>;
}

export const EMPTY_ANCHOR_SELECTION: AnchorPickerValue = { order: [], linkByProduct: new Map() };

interface AnchorPickerProps {
  channel: CommerceChannel;
  value: AnchorPickerValue;
  onChange: (value: AnchorPickerValue) => void;
  disabled?: boolean;
}

/**
 * "Products anchored (ปักตะกร้า)" — ONE component, used in three places (the
 * manual-external post modal, the Shopee placement modal, and inline on
 * post/placement list rows), so the mental model is identical everywhere
 * (design §4.3). It only manages SELECTION state; the two API calls it feeds
 * (record, then anchor) are sequenced by the host component, which is what
 * makes the partial-failure UX (§4.7) possible — this component has no
 * knowledge of "recorded yet or not".
 *
 * Retired products are shown, DISABLED, with the reason in text rather than
 * filtered out — a silently missing product reads as a bug (design §4.3).
 */
export function AnchorPicker(props: AnchorPickerProps): JSX.Element {
  const { channel, value, onChange, disabled } = props;
  const [products, setProducts] = useState<CommerceProduct[]>([]);
  const [linksByProductId, setLinksByProductId] = useState<Map<string, AffiliateLink[]>>(new Map());
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setProducts(await apiClient.listCommerceProducts({ channel }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load the product catalog.');
    } finally {
      setIsLoading(false);
    }
  }, [channel]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term === '') return products;
    return products.filter((product) => product.name.toLowerCase().includes(term));
  }, [products, search]);

  async function ensureLinksLoaded(productId: string): Promise<void> {
    if (linksByProductId.has(productId)) return;
    try {
      const links = await apiClient.listAffiliateLinks(productId);
      setLinksByProductId((current) => new Map(current).set(productId, links));
    } catch {
      // Non-fatal: the picker still works without a link, just shows "no link".
      setLinksByProductId((current) => new Map(current).set(productId, []));
    }
  }

  function toggleProduct(product: CommerceProduct, checked: boolean): void {
    if (checked) {
      void ensureLinksLoaded(product.id);
      onChange({
        order: [...value.order, product.id],
        linkByProduct: value.linkByProduct,
      });
    } else {
      const linkByProduct = new Map(value.linkByProduct);
      linkByProduct.delete(product.id);
      onChange({
        order: value.order.filter((id) => id !== product.id),
        linkByProduct,
      });
    }
  }

  function setLink(productId: string, affiliateLinkId: string): void {
    const linkByProduct = new Map(value.linkByProduct);
    if (affiliateLinkId) {
      linkByProduct.set(productId, affiliateLinkId);
    } else {
      linkByProduct.delete(productId);
    }
    onChange({ order: value.order, linkByProduct });
  }

  function move(index: number, direction: 'up' | 'down'): void {
    const order = direction === 'up' ? moveEarlier(value.order, index) : moveLater(value.order, index);
    onChange({ order, linkByProduct: value.linkByProduct });
  }

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  return (
    <div className="border rounded p-3" aria-labelledby="anchor-picker-heading">
      <p id="anchor-picker-heading" className="fw-semibold mb-2">
        Products anchored (ปักตะกร้า)
      </p>

      {error && (
        <div className="alert alert-warning py-2" role="alert">
          {error}
        </div>
      )}

      <div className="mb-2">
        <label htmlFor="anchor-picker-search" className="visually-hidden">
          Search products
        </label>
        <input
          id="anchor-picker-search"
          type="search"
          className="form-control form-control-sm"
          placeholder="Search products by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={disabled}
        />
      </div>

      {isLoading ? (
        <p className="text-muted small mb-0">Loading products…</p>
      ) : filtered.length === 0 ? (
        <p className="text-muted small mb-0">
          No {labels.channel(channel)} products yet. Add one from Commerce → Products.
        </p>
      ) : (
        <ul className="list-unstyled mb-3">
          {filtered.map((product) => (
            <li key={product.id} className="mb-2">
              <ProductRow
                product={product}
                checked={value.order.includes(product.id)}
                disabled={disabled}
                links={linksByProductId.get(product.id) ?? []}
                selectedLinkId={value.linkByProduct.get(product.id) ?? ''}
                onToggle={(checked) => toggleProduct(product, checked)}
                onSelectLink={(linkId) => setLink(product.id, linkId)}
              />
            </li>
          ))}
        </ul>
      )}

      {value.order.length > 0 && (
        <div className="mb-2">
          <p className="small text-muted mb-1">Order in basket: use ↑ / ↓ to reorder.</p>
          <ol className="mb-0 ps-3">
            {value.order.map((productId, index) => {
              const product = productById.get(productId);
              return (
                <li key={productId} className="d-flex align-items-center gap-2 mb-1">
                  <span>{product?.name ?? productId}</span>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    aria-label={`Move ${product?.name ?? 'product'} up`}
                    disabled={disabled || index === 0}
                    onClick={() => move(index, 'up')}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    aria-label={`Move ${product?.name ?? 'product'} down`}
                    disabled={disabled || index === value.order.length - 1}
                    onClick={() => move(index, 'down')}
                  >
                    ↓
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <p className="small text-muted mb-0">
        {value.order.length} product{value.order.length === 1 ? '' : 's'} selected. This records what
        you pinned on the platform — it does not pin anything for you.
      </p>
    </div>
  );
}

function ProductRow(props: {
  product: CommerceProduct;
  checked: boolean;
  disabled?: boolean;
  links: AffiliateLink[];
  selectedLinkId: string;
  onToggle: (checked: boolean) => void;
  onSelectLink: (linkId: string) => void;
}): JSX.Element {
  const { product } = props;
  const inputId = `anchor-product-${product.id}`;
  return (
    <div className="d-flex align-items-start gap-2">
      <input
        id={inputId}
        type="checkbox"
        className="form-check-input mt-1"
        checked={props.checked}
        disabled={props.disabled || !product.isActive}
        onChange={(e) => props.onToggle(e.target.checked)}
      />
      <div className="flex-grow-1">
        <label htmlFor={inputId} className="mb-0">
          {product.name}
          {product.listPrice !== null && (
            <span className="text-muted small ms-2">฿{product.listPrice.toFixed(2)}</span>
          )}
        </label>
        {!product.isActive && (
          <div className="small text-muted">Retired — cannot be anchored</div>
        )}
        {props.checked && product.isActive && (
          <div className="mt-1">
            <label htmlFor={`${inputId}-link`} className="visually-hidden">
              Affiliate link for {product.name}
            </label>
            <select
              id={`${inputId}-link`}
              className="form-select form-select-sm w-auto"
              value={props.selectedLinkId}
              onChange={(e) => props.onSelectLink(e.target.value)}
              disabled={props.disabled}
            >
              <option value="">— no link —</option>
              {props.links
                .filter((link) => link.isActive)
                .map((link) => (
                  <option key={link.id} value={link.id}>
                    {link.trackingCode ?? link.url}
                  </option>
                ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

/** Builds the anchor request body from the picker's current selection. */
export function toAnchorsInput(value: AnchorPickerValue): AnchorItemInput[] {
  return buildAnchorsPayload(value.order, value.linkByProduct);
}

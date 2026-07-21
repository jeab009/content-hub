'use client';

import { useEffect, useState } from 'react';
import {
  ApiError,
  type CommerceChannel,
  type ProductAnchor,
  type RecordProductAnchorsInput,
} from '@/lib/api-client';
import { AnchorPicker, EMPTY_ANCHOR_SELECTION, toAnchorsInput, type AnchorPickerValue } from '@/components/commerce/AnchorPicker';
import { ModalShell } from '@/components/commerce/ModalShell';

interface AnchorPickerModalProps {
  heading: string;
  channel: CommerceChannel;
  listExisting: () => Promise<ProductAnchor[]>;
  onAnchor: (body: RecordProductAnchorsInput) => Promise<ProductAnchor[]>;
  onRemove: (anchorId: string) => Promise<void>;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Standalone anchor management for an EXISTING post/placement (reached from
 * the "Anchor products" / "No products anchored" chip on a list row — design
 * §4.7's persistent affordance so unfinished anchoring can never be lost by
 * dismissing a notification). Unlike the record modals, there is no
 * "record-then-anchor" sequencing here: the target already exists, so this
 * only ever calls the anchor endpoint (idempotent per product) and, for a
 * product the admin unchecked, the un-anchor endpoint (soft-remove).
 */
export function AnchorPickerModal(props: AnchorPickerModalProps): JSX.Element {
  const [value, setValue] = useState<AnchorPickerValue>(EMPTY_ANCHOR_SELECTION);
  const [existingIdByProduct, setExistingIdByProduct] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void props
      .listExisting()
      .then((anchors) => {
        if (cancelled) return;
        const order = anchors.map((a) => a.productId);
        const linkByProduct = new Map(
          anchors.filter((a) => a.affiliateLinkId).map((a) => [a.productId, a.affiliateLinkId as string]),
        );
        const idByProduct = new Map(anchors.map((a) => [a.productId, a.id]));
        setValue({ order, linkByProduct });
        setExistingIdByProduct(idByProduct);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load existing anchors.');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave(): Promise<void> {
    setError(null);
    setIsSaving(true);
    try {
      const removed = [...existingIdByProduct.entries()].filter(
        ([productId]) => !value.order.includes(productId),
      );
      if (value.order.length > 0) {
        await props.onAnchor({ anchors: toAnchorsInput(value) });
      }
      for (const [, anchorId] of removed) {
        await props.onRemove(anchorId);
      }
      props.onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save the anchor changes.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <ModalShell titleId="anchor-picker-modal-title" heading={props.heading} onClose={props.onClose} size="lg">
      <div className="modal-body">
        {isLoading ? (
          <p className="text-muted small mb-0">Loading…</p>
        ) : (
          <AnchorPicker channel={props.channel} value={value} onChange={setValue} disabled={isSaving} />
        )}
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
        <button type="button" className="btn btn-primary" disabled={isLoading || isSaving} onClick={() => void handleSave()}>
          {isSaving ? 'Saving…' : 'Save anchors'}
        </button>
      </div>
    </ModalShell>
  );
}

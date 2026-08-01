'use client';

import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import {
  apiClient,
  ApiError,
  type AspectRatio,
  type AssetPlatform,
  type ContentAsset,
} from '@/lib/api-client';
import { ASPECT_RATIOS, ASSET_PLATFORMS, labels } from '@/lib/content-labels';

interface AssetsSectionProps {
  contentId: string;
  csrfToken: string | null;
}

/** Per-platform variant management for an existing piece of content. */
export function AssetsSection({ contentId, csrfToken }: AssetsSectionProps): JSX.Element {
  const [assets, setAssets] = useState<ContentAsset[]>([]);
  const [platform, setPlatform] = useState<AssetPlatform>('facebook');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('ratio_1_1');
  const [mediaUrl, setMediaUrl] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAssets = useCallback(async () => {
    try {
      setAssets(await apiClient.listAssets(contentId));
    } catch {
      setError('Failed to load assets.');
    }
  }, [contentId]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  async function handleUpload(file: File | undefined): Promise<void> {
    if (!file || !csrfToken) return;
    setError(null);
    setIsBusy(true);
    try {
      const result = await apiClient.uploadMedia(file, csrfToken);
      setMediaUrl(result.mediaUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleAdd(): Promise<void> {
    if (!csrfToken || !mediaUrl) return;
    setError(null);
    setIsBusy(true);
    try {
      await apiClient.addAsset(contentId, { platform, aspectRatio, mediaUrl }, csrfToken);
      setMediaUrl('');
      await loadAssets();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add asset.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRemove(assetId: string): Promise<void> {
    if (!csrfToken) return;
    setError(null);
    try {
      await apiClient.removeAsset(contentId, assetId, csrfToken);
      await loadAssets();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove asset.');
    }
  }

  return (
    <section className="card mb-4">
      <div className="card-header">
        <strong>Per-platform assets</strong>
      </div>
      <div className="card-body">
        {error && (
          <div className="alert alert-danger py-2" role="alert">
            {error}
          </div>
        )}

        {assets.length === 0 ? (
          <p className="text-muted">No platform variants yet.</p>
        ) : (
          <ul className="list-group mb-3">
            {assets.map((asset) => (
              <li
                key={asset.id}
                className="list-group-item d-flex justify-content-between align-items-center"
              >
                <span>
                  <strong>{labels.platform(asset.platform)}</strong> — {labels.aspect(asset.aspectRatio)}
                  <span className="text-muted small ms-2">{asset.mediaUrl}</span>
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-danger"
                  onClick={() => void handleRemove(asset.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="row g-2 align-items-end">
          <div className="col-12 col-md-3">
            <label htmlFor="asset-platform" className="form-label">
              Platform
            </label>
            <select
              id="asset-platform"
              className="form-select"
              value={platform}
              onChange={(e) => setPlatform(e.target.value as AssetPlatform)}
            >
              {ASSET_PLATFORMS.map((value) => (
                <option key={value} value={value}>
                  {labels.platform(value)}
                </option>
              ))}
            </select>
          </div>
          <div className="col-12 col-md-3">
            <label htmlFor="asset-aspect" className="form-label">
              Aspect ratio
            </label>
            <select
              id="asset-aspect"
              className="form-select"
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
            >
              {ASPECT_RATIOS.map((value) => (
                <option key={value} value={value}>
                  {labels.aspect(value)}
                </option>
              ))}
            </select>
          </div>
          <div className="col-12 col-md-4">
            <label htmlFor="asset-file" className="form-label">
              Media file
            </label>
            <input
              id="asset-file"
              type="file"
              className="form-control"
              accept="image/png,image/jpeg,video/mp4"
              disabled={isBusy || !csrfToken}
              onChange={(e) => void handleUpload(e.target.files?.[0])}
            />
          </div>
          <div className="col-12 col-md-2 d-grid">
            <button
              type="button"
              className="btn btn-outline-primary"
              disabled={isBusy || !mediaUrl}
              onClick={() => void handleAdd()}
            >
              Add asset
            </button>
          </div>
        </div>
        {mediaUrl && <div className="form-text mt-1">Ready to add: {mediaUrl}</div>}
      </div>
    </section>
  );
}

'use client';

import { useId, useState } from 'react';
import type { JSX } from 'react';
import { apiClient, ApiError } from '@/lib/api-client';

interface MediaUploadFieldProps {
  label: string;
  /** Current stored media path (e.g. `/uploads/…`), or empty. */
  value: string;
  csrfToken: string | null;
  helpText?: string;
  showPreview?: boolean;
  disabled?: boolean;
  onUploaded: (result: { mediaUrl: string; fileSizeBytes: number; mimeType: string }) => void;
}

/**
 * File input that uploads via the backend upload endpoint and reports the
 * returned mediaUrl to the parent. mediaUrl is NEVER free-typed — it always
 * comes from an upload, per the binding business rule.
 */
export function MediaUploadField({
  label,
  value,
  csrfToken,
  helpText,
  showPreview = true,
  disabled = false,
  onUploaded,
}: MediaUploadFieldProps): JSX.Element {
  const inputId = useId();
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file || !csrfToken) return;
    setError(null);
    setIsUploading(true);
    try {
      const result = await apiClient.uploadMedia(file, csrfToken);
      onUploaded(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed. Please try again.');
    } finally {
      setIsUploading(false);
      // Allow re-selecting the same file after an error.
      event.target.value = '';
    }
  }

  const isImage = /\.(png|jpe?g)$/i.test(value);

  return (
    <div className="mb-3">
      <label htmlFor={inputId} className="form-label">
        {label}
      </label>
      <input
        id={inputId}
        type="file"
        className="form-control"
        accept="image/png,image/jpeg,video/mp4"
        disabled={disabled || isUploading || !csrfToken}
        onChange={handleChange}
      />
      {helpText && <div className="form-text">{helpText}</div>}
      {isUploading && (
        <div className="form-text" role="status">
          Uploading…
        </div>
      )}
      {error && (
        <div className="alert alert-danger py-2 mt-2 mb-0" role="alert">
          {error}
        </div>
      )}
      {value && (
        <div className="mt-2">
          <span className="badge bg-light text-dark border">Uploaded: {value}</span>
          {showPreview && isImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={apiClient.mediaSrc(value)}
              alt="Uploaded media preview"
              className="d-block mt-2 img-thumbnail"
              style={{ maxWidth: 240, maxHeight: 240 }}
            />
          )}
        </div>
      )}
    </div>
  );
}

'use client';

import type { JSX } from 'react';

import type {
  ContentPillar,
  ContentType,
  LicensingStatus,
} from '@/lib/api-client';
import {
  CONTENT_PILLARS,
  CONTENT_TYPES,
  LICENSING_STATUSES,
  labels,
} from '@/lib/content-labels';
import { MediaUploadField } from '@/components/content/MediaUploadField';
import type { EditorForm } from '@/components/content/editor-form';

interface ContentDetailsFieldsProps {
  form: EditorForm;
  csrfToken: string | null;
  onChange: (patch: Partial<EditorForm>) => void;
}

/** Basic (non-copyright) content fields plus the main media upload. */
export function ContentDetailsFields({
  form,
  csrfToken,
  onChange,
}: ContentDetailsFieldsProps): JSX.Element {
  return (
    <section className="card mb-4">
      <div className="card-header">
        <strong>Details</strong>
      </div>
      <div className="card-body">
        <div className="mb-3">
          <label htmlFor="content-title" className="form-label">
            Title
          </label>
          <input
            id="content-title"
            type="text"
            className="form-control"
            required
            maxLength={200}
            value={form.title}
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </div>

        <div className="row">
          <div className="col-12 col-md-4 mb-3">
            <label htmlFor="content-type" className="form-label">
              Type
            </label>
            <select
              id="content-type"
              className="form-select"
              value={form.type}
              onChange={(e) => onChange({ type: e.target.value as ContentType })}
            >
              {CONTENT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {labels.type(value)}
                </option>
              ))}
            </select>
          </div>

          <div className="col-12 col-md-4 mb-3">
            <label htmlFor="content-pillar" className="form-label">
              Content pillar
            </label>
            <select
              id="content-pillar"
              className="form-select"
              value={form.contentPillar}
              onChange={(e) => onChange({ contentPillar: e.target.value as ContentPillar | '' })}
            >
              <option value="">— None —</option>
              {CONTENT_PILLARS.map((value) => (
                <option key={value} value={value}>
                  {labels.pillar(value)}
                </option>
              ))}
            </select>
          </div>

          <div className="col-12 col-md-4 mb-3">
            <label htmlFor="content-licensing" className="form-label">
              Licensing status
            </label>
            <select
              id="content-licensing"
              className="form-select"
              value={form.licensingStatus}
              onChange={(e) => onChange({ licensingStatus: e.target.value as LicensingStatus })}
            >
              {LICENSING_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {labels.licensing(value)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="row">
          <div className="col-6 col-md-3 mb-3">
            <label htmlFor="content-age-min" className="form-label">
              Target age (min)
            </label>
            <input
              id="content-age-min"
              type="number"
              min={0}
              max={120}
              className="form-control"
              value={form.targetAgeMin}
              onChange={(e) => onChange({ targetAgeMin: Number(e.target.value) })}
            />
          </div>
          <div className="col-6 col-md-3 mb-3">
            <label htmlFor="content-age-max" className="form-label">
              Target age (max)
            </label>
            <input
              id="content-age-max"
              type="number"
              min={0}
              max={120}
              className="form-control"
              value={form.targetAgeMax}
              onChange={(e) => onChange({ targetAgeMax: Number(e.target.value) })}
            />
          </div>
        </div>

        <div className="mb-3">
          <label htmlFor="content-caption" className="form-label">
            Caption
          </label>
          <textarea
            id="content-caption"
            className="form-control"
            rows={2}
            maxLength={2000}
            value={form.caption}
            onChange={(e) => onChange({ caption: e.target.value })}
          />
        </div>

        <div className="mb-3">
          <label htmlFor="content-license-notes" className="form-label">
            License notes
          </label>
          <textarea
            id="content-license-notes"
            className="form-control"
            rows={2}
            maxLength={2000}
            value={form.licenseNotes}
            onChange={(e) => onChange({ licenseNotes: e.target.value })}
          />
        </div>

        <MediaUploadField
          label="Media file"
          value={form.mediaUrl}
          csrfToken={csrfToken}
          helpText="Upload a jpg, png, or mp4. The stored path becomes this content's media."
          onUploaded={(result) =>
            onChange({
              mediaUrl: result.mediaUrl,
              fileSizeBytes: result.fileSizeBytes,
              mimeType: result.mimeType,
            })
          }
        />
      </div>
    </section>
  );
}

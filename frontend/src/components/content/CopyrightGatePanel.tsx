'use client';

import type { CopyrightClearance } from '@/lib/api-client';
import { COPYRIGHT_CLEARANCES, labels } from '@/lib/content-labels';
import { readyBlockers, type CopyrightGateState } from '@/lib/copyright-gate';
import { MediaUploadField } from '@/components/content/MediaUploadField';

interface CopyrightGatePanelProps {
  gate: CopyrightGateState;
  copyrightNotes: string;
  csrfToken: string | null;
  onClearanceChange: (value: CopyrightClearance) => void;
  onEvidenceChange: (value: string) => void;
  onNotesChange: (value: string) => void;
}

/**
 * Visually-distinct legal-risk panel. The copyright ready-gate is enforced by
 * the backend (400) and pre-checked here; this panel makes the requirements
 * explicit and shows exactly what is still missing.
 */
export function CopyrightGatePanel({
  gate,
  copyrightNotes,
  csrfToken,
  onClearanceChange,
  onEvidenceChange,
  onNotesChange,
}: CopyrightGatePanelProps): JSX.Element {
  const blockers = readyBlockers(gate);
  const isSatisfied = blockers.length === 0;

  return (
    <section className="card border-warning mb-4">
      <div className="card-header bg-warning-subtle d-flex align-items-center justify-content-between">
        <strong>Copyright gate</strong>
        <span className={`badge ${isSatisfied ? 'bg-success' : 'bg-secondary'}`}>
          {isSatisfied ? 'Ready-eligible' : 'Not ready-eligible'}
        </span>
      </div>
      <div className="card-body">
        <p className="text-muted small mb-3">
          Content can only be marked <strong>Ready</strong> once copyright is cleared. Drama and
          product content require an evidence link; comedy is exempt.
        </p>

        <div className="mb-3">
          <label htmlFor="copyright-cleared" className="form-label">
            Copyright cleared
          </label>
          <select
            id="copyright-cleared"
            className="form-select"
            value={gate.copyrightCleared}
            onChange={(e) => onClearanceChange(e.target.value as CopyrightClearance)}
          >
            {COPYRIGHT_CLEARANCES.map((value) => (
              <option key={value} value={value}>
                {labels.clearance(value)}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-3">
          <label htmlFor="copyright-evidence" className="form-label">
            Copyright evidence link
          </label>
          <input
            id="copyright-evidence"
            type="text"
            className="form-control"
            placeholder="/uploads/… or an evidence URL"
            value={gate.copyrightEvidenceUrl}
            onChange={(e) => onEvidenceChange(e.target.value)}
          />
          <div className="form-text">Paste an evidence link, or upload a document below.</div>
          <MediaUploadField
            label="Upload evidence document (optional)"
            value=""
            csrfToken={csrfToken}
            showPreview={false}
            onUploaded={(result) => onEvidenceChange(result.mediaUrl)}
          />
        </div>

        <div className="mb-3">
          <label htmlFor="copyright-notes" className="form-label">
            Copyright notes
          </label>
          <textarea
            id="copyright-notes"
            className="form-control"
            rows={2}
            value={copyrightNotes}
            onChange={(e) => onNotesChange(e.target.value)}
          />
        </div>

        {isSatisfied ? (
          <div className="alert alert-success py-2 mb-0" role="status">
            Copyright gate satisfied — this content can be marked Ready.
          </div>
        ) : (
          <div className="alert alert-warning py-2 mb-0" role="status">
            <strong>Not ready yet:</strong>
            <ul className="mb-0 mt-1">
              {blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

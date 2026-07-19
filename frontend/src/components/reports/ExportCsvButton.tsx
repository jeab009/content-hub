'use client';

import { apiClient, type ReportName, type ReportQuery } from '@/lib/api-client';

interface ExportCsvButtonProps {
  report: ReportName;
  /** Filters passed through to ReportQueryDto (from/to/platform/contentId). */
  query?: ReportQuery;
  /** Visible button text — always text, never an icon alone. */
  label: string;
  /** Disable when there is nothing to export (renders a real disabled button). */
  disabled?: boolean;
  className?: string;
}

/**
 * Downloads one of the Phase 5A.6 CSV reports.
 *
 * Rendered as an anchor rather than a fetch+blob on purpose: these endpoints
 * are admin-only GETs that already return `Content-Disposition: attachment`,
 * they carry no CSRF header by convention (read-only), and the session cookie
 * is SameSite=Lax — so a top-level navigation authenticates fine and the
 * browser saves the file under the server's own filename. Fetching it into a
 * blob would only reimplement that, worse.
 *
 * When disabled we render a `<button disabled>` instead of a dead anchor: an
 * anchor with no href is not focusable and communicates nothing to a screen
 * reader, whereas a disabled button announces its state.
 */
export function ExportCsvButton(props: ExportCsvButtonProps): JSX.Element {
  const className = props.className ?? 'btn btn-outline-secondary btn-sm';

  if (props.disabled) {
    return (
      <button type="button" className={className} disabled>
        {props.label}
      </button>
    );
  }

  return (
    <a
      className={className}
      href={apiClient.reportCsvUrl(props.report, props.query)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {props.label}
    </a>
  );
}

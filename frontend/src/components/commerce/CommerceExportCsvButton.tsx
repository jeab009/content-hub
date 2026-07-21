'use client';

import { apiClient, type ReportQuery } from '@/lib/api-client';

interface CommerceExportCsvButtonProps {
  /** Filters passed through to CommerceReportQueryDto (from/to/channel/productId). */
  query?: Pick<ReportQuery, 'from' | 'to' | 'channel' | 'productId'>;
  label: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Downloads `commerce.csv` — a SEPARATE report from `revenue.csv`
 * (design §4.6: "Two export buttons in two separate places, never a shared
 * toolbar"). This is a small, deliberate DUPLICATE of the payout side's
 * ExportCsvButton (ADR-6.8: "some Bootstrap markup is duplicated on
 * purpose") rather than a shared import: the frontend commerce/payout
 * ESLint zone (frontend/.eslintrc.js) bans every commerce file from
 * importing anything from the reports component directory, precisely so no
 * commerce surface can reach for a payout-side component "for convenience"
 * — the same reasoning that gives commerce its own DTO vocabulary. Same
 * anchor-not-fetch rationale as the original: the endpoint already sets
 * `Content-Disposition: attachment`, carries no CSRF header (read-only),
 * and the SameSite=Lax session cookie rides a top-level navigation fine.
 */
export function CommerceExportCsvButton(props: CommerceExportCsvButtonProps): JSX.Element {
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
      href={apiClient.reportCsvUrl('commerce', props.query)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {props.label}
    </a>
  );
}

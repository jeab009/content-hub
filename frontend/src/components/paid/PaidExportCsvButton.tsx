'use client';

import type { JSX } from 'react';

import { apiClient, type ReportQuery } from '@/lib/api-client';

interface PaidExportCsvButtonProps {
  /** Filters passed through to PaidReportQueryDto (from/to/campaignId). */
  query?: Pick<ReportQuery, 'from' | 'to' | 'campaignId'>;
  label: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Downloads `paid.csv` — a SEPARATE report from `revenue.csv` AND
 * `commerce.csv` (design §4.4: "Three export buttons in three places, never
 * a shared toolbar"). This is a small, deliberate DUPLICATE of
 * `CommerceExportCsvButton` (ADR-7.6, same reasoning as ADR-6.8: "some
 * Bootstrap markup is duplicated on purpose") rather than a shared import —
 * the frontend paid/commerce/payout ESLint zone (frontend/.eslintrc.js) bans
 * every paid file from importing anything from `components/commerce/**` or
 * `components/reports/**`, precisely so no paid surface can reach for
 * another stream's component "for convenience" — the same reasoning that
 * gives paid its own DTO vocabulary. Same anchor-not-fetch rationale as the
 * original: the endpoint already sets `Content-Disposition: attachment`,
 * carries no CSRF header (read-only), and the SameSite=Lax session cookie
 * rides a top-level navigation fine.
 */
export function PaidExportCsvButton(props: PaidExportCsvButtonProps): JSX.Element {
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
      href={apiClient.reportCsvUrl('paid', props.query)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {props.label}
    </a>
  );
}

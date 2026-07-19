'use client';

import type { EscalationAlert } from '@/lib/api-client';

interface EscalationBannerProps {
  alerts: EscalationAlert[];
  /** Id currently being acknowledged (button spinner + disable). */
  acknowledgingId: string | null;
  onAcknowledge: (alert: EscalationAlert) => void;
}

/**
 * Prominent surface for active (unacknowledged) negative-sentiment spike
 * alerts. Renders nothing when there are none. Acknowledge soft-dismisses the
 * alert on the server (the row is kept, not deleted, so it can re-fire).
 */
export function EscalationBanner(props: EscalationBannerProps): JSX.Element | null {
  if (props.alerts.length === 0) {
    return null;
  }

  return (
    <div className="alert alert-danger" role="alert">
      <h2 className="h6 alert-heading">
        Negative sentiment spike detected ({props.alerts.length} active)
      </h2>
      <ul className="list-unstyled mb-0">
        {props.alerts.map((alert) => (
          <li
            key={alert.id}
            className="d-flex flex-wrap justify-content-between align-items-center gap-2 py-1"
          >
            <span>
              {alert.negativeCount} negative comments (threshold {alert.threshold}) between{' '}
              {new Date(alert.windowStart).toLocaleString()} and{' '}
              {new Date(alert.windowEnd).toLocaleString()}
            </span>
            <button
              type="button"
              className="btn btn-sm btn-outline-dark"
              disabled={props.acknowledgingId === alert.id}
              onClick={() => props.onAcknowledge(alert)}
            >
              {props.acknowledgingId === alert.id ? 'Acknowledging…' : 'Acknowledge'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

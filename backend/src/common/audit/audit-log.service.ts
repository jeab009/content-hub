import { Injectable, Logger } from '@nestjs/common';
import { redactSensitive } from '../utils/redact.util';

/**
 * Actions this Phase 1 build audits. Kept as a union type (not a free-form
 * string) so call sites can't silently typo an action name that nothing
 * downstream will ever alert on.
 */
export type AuditAction =
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.logout'
  | 'auth.account.locked'
  | 'connected_account.oauth.connect'
  | 'connected_account.oauth.error'
  | 'connected_account.disconnect'
  | 'connected_account.token_refresh.failure'
  // Phase 2 — CMS
  | 'content_created'
  | 'content_updated'
  | 'content_archived'
  | 'content_uploaded'
  | 'content_asset_added'
  | 'content_asset_removed'
  // Phase 2 — ranking
  | 'ranking_recomputed'
  // Phase 2 — publish orchestration (see docs/publish-orchestration-addendum.md)
  | 'publish_attempt_started'
  | 'publish_succeeded'
  | 'publish_failed'
  | 'publish_unconfirmed'
  | 'publish_ambiguity_resolved'
  // Phase 3 — metrics ingestion
  | 'metrics_sync_run'
  | 'metric_manual_added'
  // Phase 4 — comment aggregation
  | 'comment_sync_run'
  | 'comment_reply_sent'
  | 'comment_reply_failed'
  | 'comment_escalation_raised'
  | 'comment_retention_purged'
  | 'comment_erased'
  | 'comment_template_created'
  | 'comment_template_updated'
  | 'comment_template_deleted';

export type AuditResult = 'success' | 'failure';

export interface AuditEntry {
  actor: string; // user id, email, or "anonymous" for pre-auth events
  action: AuditAction;
  result: AuditResult;
  ip?: string;
  meta?: Record<string, unknown>;
}

/**
 * Structured audit logging (security decision #7). Phase 1 has no dedicated
 * audit-log table (not in the approved 5-table schema), so entries are
 * emitted as structured JSON log lines. This is a deliberate scope decision,
 * not an oversight — see docs/security-decisions.md. Wiring this to a
 * persistent, queryable sink (DB table or log aggregator) is a Phase 2+
 * concern.
 *
 * Every entry is passed through redactSensitive so a future call site can't
 * accidentally leak a token into `meta` without a code review catching it —
 * defense in depth alongside the exception filter and logging interceptor.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger('AuditLog');

  record(entry: AuditEntry): void {
    const safeEntry = {
      timestamp: new Date().toISOString(),
      actor: entry.actor,
      action: entry.action,
      result: entry.result,
      ip: entry.ip,
      meta: entry.meta ? redactSensitive(entry.meta) : undefined,
    };

    if (entry.result === 'failure') {
      this.logger.warn(JSON.stringify(safeEntry));
    } else {
      this.logger.log(JSON.stringify(safeEntry));
    }
  }
}

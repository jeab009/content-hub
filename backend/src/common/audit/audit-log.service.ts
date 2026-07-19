import { Injectable, Logger } from '@nestjs/common';
import { AuditLogResult, Prisma } from '@prisma/client';
import { PrismaService } from '../../modules/prisma/prisma.service';
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
  | 'comment_template_deleted'
  // Phase 5 — manual-external-record path (TikTok/LINE OA are published
  // natively by the admin, then recorded here; see phase5-project-plan.md
  // Decision 1). Ranking v2 deliberately has NO new action: it reuses
  // 'ranking_recomputed', which already carries engineVersion in its meta, so
  // any existing alert aggregating on that action keeps seeing every recompute.
  | 'manual_external_post_recorded'
  // Phase 5 — report export. Meta carries who/when/report/filters and NEVER
  // any PII (comment exports are aggregate-only; see the export service).
  | 'report_exported';

export type AuditResult = 'success' | 'failure';

export interface AuditEntry {
  actor: string; // user id, email, or "anonymous" for pre-auth events
  action: AuditAction;
  result: AuditResult;
  ip?: string;
  meta?: Record<string, unknown>;
}

/**
 * Structured audit logging (security decision #7).
 *
 * Phase 1 emitted entries as JSON log lines only and deferred a persistent
 * sink as "a Phase 2+ concern". Phase 5D.1 closes that: every entry is now
 * ALSO written to the `audit_logs` table. The stdout line is deliberately
 * kept — it is useful in dev and some deployments tail it — so this is purely
 * additive to the existing behaviour.
 *
 * Why persistence had to happen: stdout audit lines are destroyed by any
 * container recreate, which was proved empirically (eight manual_external
 * posts, zero surviving audit lines — docs/phase5-bugfix-feedback.md §5.3),
 * and bussiness_rule.md rests the copyright gate on the manual-external path
 * entirely on the audit trail existing.
 *
 * Every entry is passed through redactSensitive so a future call site can't
 * accidentally leak a token into `meta` without a code review catching it —
 * defense in depth alongside the exception filter and logging interceptor.
 * The SAME redacted object is used for the log line and the persisted row, so
 * the two can never diverge: there is no code path that writes raw meta.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger('AuditLog');

  constructor(private readonly prisma: PrismaService) {}

  record(entry: AuditEntry): void {
    const timestamp = new Date();
    // Redact ONCE, then reuse. Both sinks get the identical, already-safe
    // object — persisting raw meta is not expressible from here.
    const safeMeta = entry.meta ? redactSensitive(entry.meta) : undefined;
    const safeEntry = {
      timestamp: timestamp.toISOString(),
      actor: entry.actor,
      action: entry.action,
      result: entry.result,
      ip: entry.ip,
      meta: safeMeta,
    };

    if (entry.result === 'failure') {
      this.logger.warn(JSON.stringify(safeEntry));
    } else {
      this.logger.log(JSON.stringify(safeEntry));
    }

    // Fire-and-forget: see persist(). `void` marks the floating promise as
    // intentional — record() stays synchronous so no caller can accidentally
    // couple its own latency or failure handling to the audit write.
    void this.persist(timestamp, entry, safeMeta);
  }

  /**
   * Persists one audit row. NON-BLOCKING and NON-TRANSACTIONAL with respect
   * to the operation being audited — a deliberate choice.
   *
   * Joining the audited operation's transaction would mean an audit-write
   * failure rolls back a publish, a reply, or a disconnect. For this system
   * that trade is wrong in both directions: the business operations are the
   * things with real-world side effects (a post is already live on the
   * platform; a token is already revoked at the provider), so aborting them
   * to protect a log record cannot un-do anything — it would only desynchronise
   * the DB from the outside world while still losing the audit row. The
   * failure mode we accept instead is a missing audit row, which is loudly
   * logged as an ERROR and is strictly better than today's baseline, where
   * EVERY row was lost on restart.
   *
   * This is an explicit, tested contract, not incidental behaviour — see
   * audit-log.service.spec.ts ("a failed audit write never breaks the audited
   * operation").
   */
  private async persist(timestamp: Date, entry: AuditEntry, safeMeta: unknown): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          timestamp,
          actor: entry.actor,
          action: entry.action,
          result: entry.result as AuditLogResult,
          ip: entry.ip,
          // Cast is safe: safeMeta is the output of redactSensitive over a
          // plain Record — JSON-serializable by construction. Prisma's
          // InputJsonValue just cannot see that through `unknown`.
          meta: (safeMeta ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      // Swallow deliberately — the audited operation has already happened and
      // must not be affected. Loud enough to alert on.
      this.logger.error(
        `Failed to persist audit row for action=${entry.action} result=${entry.result}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

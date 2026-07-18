import { Injectable, Logger } from '@nestjs/common';
import { Content, Post, PostStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { ConnectedAccountsService } from '../connected-accounts/connected-accounts.service';
import { PlatformAdapterRegistry } from './adapters/platform-adapter.registry';
import { isConfirmedNotPosted } from './adapters/publisher.errors';
import { DISPATCHABLE_STATUSES } from './post-state';
import { PublishJobData } from './publish-orchestrator.service';

export type ExecutionOutcome =
  'posted' | 'failed' | 'posted_unconfirmed' | 'lost_claim' | 'missing';

/**
 * Executes one publish job, implementing the revised PublisherPort sequence
 * from docs/publish-orchestration-addendum.md §3 exactly:
 *
 * 1. Conditional claim (status IN draft/failed AND version match) — a
 *    retried/duplicate job that loses the claim exits without EVER calling
 *    the platform, so double-posting is structurally impossible.
 * 2. Failures before the network dispatch → `failed` (safe to retry).
 * 3. Exception/timeout after dispatch, or a terminal-write failure after
 *    platform success → `posted_unconfirmed` (never auto-retried; human
 *    resolves via the resolution endpoints).
 * Every status write sets executed_by and bumps version (SEC-C / Item 3).
 */
@Injectable()
export class PublishExecutionService {
  private readonly logger = new Logger(PublishExecutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connectedAccounts: ConnectedAccountsService,
    private readonly adapterRegistry: PlatformAdapterRegistry,
    private readonly auditLog: AuditLogService,
  ) {}

  async execute(job: PublishJobData): Promise<ExecutionOutcome> {
    const post = await this.prisma.post.findUnique({
      where: { id: job.postId },
      include: { content: true },
    });
    if (!post || !post.selectedPlatform) {
      this.logger.warn(`Publish job for missing/legacy post ${job.postId} — nothing to do`);
      return 'missing';
    }

    const claimedVersion = await this.claim(post, job.requestedBy);
    if (claimedVersion === null) {
      // Someone else (concurrent request, duplicate delivery, cancel) got
      // here first. Exiting WITHOUT touching the platform is the whole
      // idempotency guarantee.
      this.logger.warn(`Lost publish claim for post ${post.id} — exiting without dispatch`);
      return 'lost_claim';
    }

    const accessToken = await this.getTokenOrNull(job);
    if (accessToken === null) {
      await this.markFailed(post.id, claimedVersion, job.requestedBy, 'token_invalid');
      return 'failed';
    }

    return this.dispatchAndRecord(post, post.content, claimedVersion, job, accessToken);
  }

  /** Addendum §3 pre-write: conditional UPDATE claiming the publish attempt. */
  private async claim(post: Post, requestedBy: string): Promise<number | null> {
    const result = await this.prisma.post.updateMany({
      where: {
        id: post.id,
        status: { in: [...DISPATCHABLE_STATUSES] },
        version: post.version,
      },
      data: {
        status: PostStatus.scheduled,
        scheduledAt: new Date(),
        executedBy: requestedBy,
        version: { increment: 1 },
      },
    });
    return result.count === 1 ? post.version + 1 : null;
  }

  private async getTokenOrNull(job: PublishJobData): Promise<string | null> {
    try {
      return await this.connectedAccounts.getValidToken(job.connectedAccountId, job.requestedBy);
    } catch (error) {
      // Failure BEFORE the platform call was ever dispatched — unambiguous.
      this.logger.warn(`Token retrieval failed for publish job: ${(error as Error).message}`);
      return null;
    }
  }

  private async dispatchAndRecord(
    post: Post,
    content: Content,
    claimedVersion: number,
    job: PublishJobData,
    accessToken: string,
  ): Promise<ExecutionOutcome> {
    const account = await this.prisma.connectedAccount.findUnique({
      where: { id: job.connectedAccountId },
    });
    if (!account) {
      await this.markFailed(post.id, claimedVersion, job.requestedBy, 'account_missing');
      return 'failed';
    }

    // selectedPlatform checked non-null in execute().
    const adapter = this.adapterRegistry.getFor(post.selectedPlatform!);

    try {
      const result = await adapter.publish({ post, content, account, accessToken });
      return this.recordSuccess(post, claimedVersion, job, result.externalPostId);
    } catch (error) {
      if (isConfirmedNotPosted(error)) {
        // Rejected before/at dispatch, or the platform answered "no" —
        // confirmed nothing went live. Safe, retryable failure.
        await this.markFailed(post.id, claimedVersion, job.requestedBy, (error as Error).message);
        return 'failed';
      }
      // Anything else (timeout, connection drop, unknown error type):
      // outcome at the platform is UNKNOWN. Do NOT write `failed`.
      await this.markUnconfirmed(post.id, job.requestedBy, null, (error as Error).message);
      return 'posted_unconfirmed';
    }
  }

  private async recordSuccess(
    post: Post,
    claimedVersion: number,
    job: PublishJobData,
    externalPostId: string,
  ): Promise<ExecutionOutcome> {
    try {
      const result = await this.prisma.post.updateMany({
        where: { id: post.id, version: claimedVersion },
        data: {
          status: PostStatus.posted,
          externalPostId,
          postedAt: new Date(),
          executedBy: job.requestedBy,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        throw new Error(`terminal write matched ${result.count} rows`);
      }
    } catch (error) {
      // Platform confirmed success but we could not durably record it —
      // THE REL-002 orphaned-live-post case. Best-effort unconfirmed write.
      await this.markUnconfirmed(
        post.id,
        job.requestedBy,
        externalPostId,
        `terminal_write_failed: ${(error as Error).message}`,
      );
      return 'posted_unconfirmed';
    }

    this.auditLog.record({
      actor: job.requestedBy,
      action: 'publish_succeeded',
      result: 'success',
      meta: { postId: post.id, platform: post.selectedPlatform, externalPostId },
    });
    return 'posted';
  }

  private async markFailed(
    postId: string,
    claimedVersion: number,
    requestedBy: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.post.updateMany({
      where: { id: postId, version: claimedVersion },
      data: {
        status: PostStatus.failed,
        executedBy: requestedBy,
        version: { increment: 1 },
      },
    });
    this.auditLog.record({
      actor: requestedBy,
      action: 'publish_failed',
      result: 'failure',
      meta: { postId, reason, retryable: true },
    });
  }

  /**
   * Best-effort `posted_unconfirmed` write (no version condition — the
   * ambiguity must be recorded if at all possible) + ALERT-severity audit.
   * If even this write fails, the row stays `scheduled` with executed_by
   * set; DevOps monitoring alerts on that signature as the second,
   * independent detection path (addendum §3 note).
   */
  private async markUnconfirmed(
    postId: string,
    requestedBy: string,
    externalPostId: string | null,
    reason: string,
  ): Promise<void> {
    try {
      await this.prisma.post.updateMany({
        where: { id: postId },
        data: {
          status: PostStatus.posted_unconfirmed,
          ...(externalPostId && { externalPostId }),
          executedBy: requestedBy,
          version: { increment: 1 },
        },
      });
    } catch (writeError) {
      this.logger.error(
        `ALERT: could not record posted_unconfirmed for post ${postId}: ` +
          `${(writeError as Error).message} — row left at scheduled/executed_by for monitoring`,
      );
    }
    this.auditLog.record({
      actor: requestedBy,
      action: 'publish_unconfirmed',
      result: 'failure',
      meta: { postId, externalPostId, reason, severity: 'ALERT', requiresManualVerification: true },
    });
  }
}

import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { CommentSnapshot } from '../publish/adapters/platform-adapter.interface';
import { ConnectedAccount, Post } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { ConnectedAccountsService } from '../connected-accounts/connected-accounts.service';
import { PlatformAdapterRegistry } from '../publish/adapters/platform-adapter.registry';
import { toAssetPlatform } from '../../common/utils/platform-map.util';
import { COMMENT_API_CAPABLE_PLATFORMS, COMMENT_ELIGIBLE_STATUSES } from './comments.constants';
import { CommentTriageService } from './comment-triage.service';
import { EscalationService } from './escalation.service';
import {
  SENTIMENT_CLASSIFIER,
  SentimentClassifier,
} from './sentiment/sentiment-classifier.interface';
import { CommentSyncItemResult, CommentSyncResultDto } from './dto/comment-sync-result.dto';

/**
 * Pulls comments from the platform adapters (mock or live per PUBLISHER_IMPL_*)
 * and APPENDS them, deduped on (platform, externalCommentId). Structurally
 * identical to MetricIngestionService: append-only, per-post failure isolation
 * (one stale token fails that post alone, never the batch), audit counts only,
 * no raw comment text in logs (C6b/C7).
 *
 * Dedup leans on the DB partial unique index via createMany({ skipDuplicates:
 * true }) — re-sync inserts ZERO duplicates (exit #1). After the batch,
 * escalation runs once over the current negative set.
 */
@Injectable()
export class CommentIngestionService {
  private readonly logger = new Logger(CommentIngestionService.name);
  /**
   * In-flight guard (System Analyst condition C6c): a full re-poll burns FB/YT
   * API quota, so concurrent syncs must not stack. Single-process MVP, so a
   * per-instance flag is sufficient; combined with the route @Throttle it
   * prevents hammered/looped syncs from exhausting the platform quota (R4).
   */
  private syncInFlight = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly connectedAccounts: ConnectedAccountsService,
    private readonly adapterRegistry: PlatformAdapterRegistry,
    private readonly triage: CommentTriageService,
    private readonly escalation: EscalationService,
    @Inject(SENTIMENT_CLASSIFIER) private readonly classifier: SentimentClassifier,
  ) {}

  async syncComments(userId: string): Promise<CommentSyncResultDto> {
    if (this.syncInFlight) {
      throw new ConflictException('A comment sync is already in progress');
    }
    this.syncInFlight = true;
    try {
      return await this.runSync(userId);
    } finally {
      this.syncInFlight = false;
    }
  }

  private async runSync(userId: string): Promise<CommentSyncResultDto> {
    const posts = await this.prisma.post.findMany({
      where: {
        status: { in: [...COMMENT_ELIGIBLE_STATUSES] },
        platform: { in: [...COMMENT_API_CAPABLE_PLATFORMS] },
      },
      orderBy: { postedAt: 'asc' },
    });

    const items: CommentSyncItemResult[] = [];
    for (const post of posts) {
      items.push(await this.syncOnePost(post, userId));
    }

    const inserted = items.reduce((sum, item) => sum + (item.inserted ?? 0), 0);
    const result: CommentSyncResultDto = {
      ranAt: new Date(),
      eligible: posts.length,
      synced: items.filter((item) => item.outcome === 'synced').length,
      skipped: items.filter((item) => item.outcome === 'skipped').length,
      failed: items.filter((item) => item.outcome === 'failed').length,
      inserted,
      items,
    };

    this.auditLog.record({
      actor: userId,
      action: 'comment_sync_run',
      result: result.failed > 0 ? 'failure' : 'success',
      meta: {
        eligible: result.eligible,
        synced: result.synced,
        skipped: result.skipped,
        failed: result.failed,
        inserted: result.inserted,
      },
    });

    // Escalation runs once per sync over the current rolling window; DB-deduped
    // so a spike raises at most one alert per hourly bucket (C5).
    await this.escalation.evaluate(userId);

    return result;
  }

  private async syncOnePost(post: Post, userId: string): Promise<CommentSyncItemResult> {
    const base = { postId: post.id, platform: post.platform };
    try {
      const account = await this.findConnectedAccount(post, userId);
      if (!account) {
        return { ...base, outcome: 'skipped', reason: 'no_connected_account' };
      }

      const accessToken = await this.connectedAccounts.getValidToken(account.id, userId);
      const adapter = this.adapterRegistry.getFor(toAssetPlatform(post.platform));
      const snapshots = await adapter.fetchComments({ post, account, accessToken });

      let inserted = 0;
      for (const snapshot of snapshots) {
        inserted += await this.persistSnapshot(post, snapshot);
      }
      return { ...base, outcome: 'synced', inserted };
    } catch (error) {
      // Never log raw comment text — only the error reason (C6b/C7).
      const reason = error instanceof Error ? error.message : 'unknown_error';
      this.logger.warn(`Comment sync failed for post ${post.id}: ${reason}`);
      return { ...base, outcome: 'failed', reason };
    }
  }

  /**
   * Classify + triage one snapshot, then dedup-insert. Returns the number of
   * rows actually written (0 if the dedup index skipped a duplicate). Append-
   * only: an existing row is never updated (an edited on-platform comment is
   * intentionally not re-synced — accepted staleness, analyst §2).
   */
  private async persistSnapshot(post: Post, snapshot: CommentSnapshot): Promise<number> {
    const { sentiment, source } = await this.classifier.classify(snapshot.text);
    const collectedAt = snapshot.createdAt;
    const { priority, slaDueAt } = this.triage.triage(snapshot.text, sentiment, collectedAt);

    const { count } = await this.prisma.comment.createMany({
      data: [
        {
          postId: post.id,
          platform: post.platform,
          externalCommentId: snapshot.externalCommentId,
          authorExternalId: snapshot.authorExternalId,
          author: snapshot.author,
          text: snapshot.text,
          sentiment,
          sentimentSource: source,
          priority,
          slaDueAt,
          replyable: snapshot.replyable,
          collectedAt,
        },
      ],
      skipDuplicates: true, // (platform, externalCommentId) partial unique -> idempotent re-sync
    });
    return count;
  }

  private async findConnectedAccount(post: Post, userId: string): Promise<ConnectedAccount | null> {
    return this.prisma.connectedAccount.findFirst({
      where: { userId, platform: post.platform, status: 'connected' },
    });
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConnectedAccount, MetricSource, Post } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { ConnectedAccountsService } from '../connected-accounts/connected-accounts.service';
import { PlatformAdapterRegistry } from '../publish/adapters/platform-adapter.registry';
import { toAssetPlatform } from '../../common/utils/platform-map.util';
import { API_CAPABLE_PLATFORMS, METRIC_ELIGIBLE_STATUSES } from './metrics.constants';
import { SyncItemResult, SyncResultDto } from './dto/sync-result.dto';

/**
 * Pulls post metrics from the platform adapters (mock or live per the
 * PUBLISHER_IMPL_* flags) and appends them as source=api rows. Runs only for
 * API-capable platforms (FB/YouTube) — TikTok/LINE arrive via manual entry.
 *
 * Every write is append-only and every per-post failure is isolated: one
 * stale token or one adapter error is reported against that post alone and
 * never aborts the batch, so a single bad account can't blank the whole
 * dashboard.
 */
@Injectable()
export class MetricIngestionService {
  private readonly logger = new Logger(MetricIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly connectedAccounts: ConnectedAccountsService,
    private readonly adapterRegistry: PlatformAdapterRegistry,
  ) {}

  async syncApiMetrics(userId: string): Promise<SyncResultDto> {
    const posts = await this.prisma.post.findMany({
      where: {
        status: { in: [...METRIC_ELIGIBLE_STATUSES] },
        platform: { in: [...API_CAPABLE_PLATFORMS] },
      },
      orderBy: { postedAt: 'asc' },
    });

    const items: SyncItemResult[] = [];
    for (const post of posts) {
      items.push(await this.syncOnePost(post, userId));
    }

    const result: SyncResultDto = {
      ranAt: new Date(),
      eligible: posts.length,
      synced: items.filter((item) => item.outcome === 'synced').length,
      skipped: items.filter((item) => item.outcome === 'skipped').length,
      failed: items.filter((item) => item.outcome === 'failed').length,
      items,
    };

    this.auditLog.record({
      actor: userId,
      action: 'metrics_sync_run',
      result: result.failed > 0 ? 'failure' : 'success',
      meta: {
        eligible: result.eligible,
        synced: result.synced,
        skipped: result.skipped,
        failed: result.failed,
      },
    });

    return result;
  }

  private async syncOnePost(post: Post, userId: string): Promise<SyncItemResult> {
    const base = { postId: post.id, platform: post.platform };
    try {
      const account = await this.findConnectedAccount(post, userId);
      if (!account) {
        return { ...base, outcome: 'skipped', reason: 'no_connected_account' };
      }

      // getValidToken is the ONLY sanctioned decryption path (it also
      // re-checks ownership + connected status), so a stale/absent token
      // surfaces here as a caught failure rather than a thrown batch abort.
      const accessToken = await this.connectedAccounts.getValidToken(account.id, userId);
      const adapter = this.adapterRegistry.getFor(toAssetPlatform(post.platform));
      const snapshot = await adapter.fetchMetrics({ post, account, accessToken });

      await this.prisma.metric.create({
        data: {
          postId: post.id,
          platform: post.platform,
          reach: snapshot.reach,
          engagement: snapshot.engagement,
          revenue: snapshot.revenue,
          source: MetricSource.api,
          collectedAt: new Date(),
        },
      });

      return { ...base, outcome: 'synced' };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown_error';
      this.logger.warn(`Metric sync failed for post ${post.id}: ${reason}`);
      return { ...base, outcome: 'failed', reason };
    }
  }

  /** The connected account for this post's platform, owned by the user. */
  private async findConnectedAccount(post: Post, userId: string): Promise<ConnectedAccount | null> {
    return this.prisma.connectedAccount.findFirst({
      where: { userId, platform: post.platform, status: 'connected' },
    });
  }
}

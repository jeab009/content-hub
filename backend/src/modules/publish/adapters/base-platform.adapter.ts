import { Logger } from '@nestjs/common';
import { AssetPlatform, Post } from '@prisma/client';
import { AppConfig } from '../../../config/configuration';
import {
  FetchMetricsArgs,
  MetricSnapshot,
  PlatformAdapter,
  PublishArgs,
  PublishResult,
  buildDryRunExternalId,
} from './platform-adapter.interface';
import {
  PlatformCapabilityNotImplementedError,
  PublisherRejectedError,
  PublisherTokenError,
} from './publisher.errors';

/**
 * Shared adapter skeleton: token presence check, pre-dispatch validation
 * hook, dry-run short-circuit, and the Phase 3/4 capability stubs. The
 * dry-run path runs the SAME token + validation checks as live (a rehearsal
 * that skips the checks would hide exactly the failures it exists to
 * catch), then performs zero network I/O and returns a deterministic
 * `dry-run-<platform>-<postId>` external id.
 */
export abstract class BasePlatformAdapter implements PlatformAdapter {
  abstract readonly platform: AssetPlatform;
  protected readonly logger = new Logger(this.constructor.name);

  constructor(protected readonly publisherConfig: AppConfig['publisher']) {}

  /** True when the PUBLISHER_IMPL_* flag for this platform is non-mock. */
  protected abstract isLiveMode(): boolean;

  /** The real platform API call. Only ever reached in live mode. */
  protected abstract publishLive(args: PublishArgs, accessToken: string): Promise<PublishResult>;

  /** The real platform metrics read. Only ever reached in live mode. */
  protected abstract fetchMetricsLive(
    args: FetchMetricsArgs,
    accessToken: string,
  ): Promise<MetricSnapshot>;

  /** Per-platform pre-dispatch validation hook (throw PublisherValidationError). */
  protected validateArgs(_args: PublishArgs): void {
    // Default: no extra validation.
  }

  async publish(args: PublishArgs): Promise<PublishResult> {
    const accessToken = args.accessToken;
    if (!accessToken || accessToken.trim().length === 0) {
      throw new PublisherTokenError(
        `No decrypted access token available for connected account ${args.account.id}`,
      );
    }
    this.validateArgs(args);

    if (!this.isLiveMode()) {
      return this.publishDryRun(args);
    }
    return this.publishLive(args, accessToken);
  }

  /**
   * Reads one post's metrics. Mirrors publish()'s gating exactly: a faithful
   * token check first (mock included), then either a deterministic synthetic
   * snapshot (mock) or the live platform read. Never throws
   * PlatformCapabilityNotImplementedError — that stub was retired in Phase 3.
   */
  async fetchMetrics(args: FetchMetricsArgs): Promise<MetricSnapshot> {
    const accessToken = args.accessToken;
    if (!accessToken || accessToken.trim().length === 0) {
      throw new PublisherTokenError(
        `No decrypted access token available for connected account ${args.account.id}`,
      );
    }
    if (!this.isLiveMode()) {
      return this.mockSnapshot(args.post);
    }
    return this.fetchMetricsLive(args, accessToken);
  }

  fetchComments(_post: Post): Promise<never> {
    return Promise.reject(
      new PlatformCapabilityNotImplementedError('fetchComments is not implemented until Phase 4'),
    );
  }

  replyComment(_post: Post, _externalCommentId: string, _message: string): Promise<never> {
    return Promise.reject(
      new PlatformCapabilityNotImplementedError('replyComment is not implemented until Phase 4'),
    );
  }

  private async publishDryRun(args: PublishArgs): Promise<PublishResult> {
    await this.simulateLatency();
    if (Math.random() < this.publisherConfig.mockFailureRate) {
      throw new PublisherRejectedError(
        'Mock publisher failure injected (MOCK_PUBLISHER_FAILURE_RATE)',
      );
    }
    const externalPostId = buildDryRunExternalId(this.platform, args.post.id);
    this.logger.log(
      `[dry-run] ${this.platform}: would publish post ${args.post.id} ` +
        `(content ${args.content.id}, account ${args.account.platformAccountName}) — ` +
        `no network call made, returning ${externalPostId}`,
    );
    return { externalPostId };
  }

  private simulateLatency(): Promise<void> {
    const latencyMs = Math.max(0, this.publisherConfig.mockLatencyMs);
    return new Promise((resolve) => setTimeout(resolve, latencyMs));
  }

  /**
   * Deterministic synthetic metrics for mock mode. Seeded by the post id so
   * a given post always yields the same base numbers, and scaled by how many
   * days the post has been live so repeated syncs produce a rising
   * cumulative trend (what a real dashboard would show) rather than noise.
   * No network I/O — the mock analogue of publishDryRun.
   */
  private mockSnapshot(post: Post): MetricSnapshot {
    const seed = hashString(post.id);
    const postedAt = post.postedAt ?? post.createdAt ?? new Date();
    const msLive = Math.max(0, Date.now() - new Date(postedAt).getTime());
    const daysLive = Math.max(1, Math.ceil(msLive / (24 * 60 * 60 * 1000)));

    const reachPerDay = 500 + (seed % 4500); // 500..5000 impressions/day
    const reach = reachPerDay * daysLive;
    const engagementRate = 0.02 + (seed % 60) / 1000; // 2%..8%
    const engagement = Math.round(reach * engagementRate);
    const rpm = 0.4 + (seed % 61) / 100; // THB 0.40..1.00 per 1000 reach
    const revenue = Math.round((reach / 1000) * rpm * 100) / 100;

    return { reach, engagement, revenue };
  }
}

/** Small, stable string hash (djb2-ish) for deterministic mock seeding. */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

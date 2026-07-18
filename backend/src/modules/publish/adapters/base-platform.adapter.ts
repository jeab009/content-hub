import { Logger } from '@nestjs/common';
import { AssetPlatform, Post } from '@prisma/client';
import { AppConfig } from '../../../config/configuration';
import {
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

  fetchMetrics(_post: Post): Promise<never> {
    return Promise.reject(
      new PlatformCapabilityNotImplementedError('fetchMetrics is not implemented until Phase 3'),
    );
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
}

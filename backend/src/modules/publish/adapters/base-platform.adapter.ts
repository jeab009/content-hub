import { Logger } from '@nestjs/common';
import { AssetPlatform, Post } from '@prisma/client';
import { AppConfig } from '../../../config/configuration';
import {
  CommentReplyResult,
  CommentSnapshot,
  FetchCommentsArgs,
  FetchMetricsArgs,
  MetricSnapshot,
  PlatformAdapter,
  PublishArgs,
  PublishResult,
  ReplyCommentArgs,
  buildDryRunExternalId,
  buildDryRunReplyId,
  buildMockCommentId,
} from './platform-adapter.interface';
import { PublisherRejectedError, PublisherTokenError } from './publisher.errors';

/**
 * Deterministic synthetic comment bank for mock mode. Thai text spanning the
 * sentiment classes and triage priorities so the inbox, filters, and
 * escalation are demoable offline (D2). `text`/`author` are synthetic — no
 * real person — but still flow through the same redaction path as live data.
 */
interface MockCommentSample {
  author: string;
  authorSuffix: string;
  text: string;
  replyable: boolean;
}

const MOCK_COMMENT_SAMPLES: readonly MockCommentSample[] = [
  {
    author: 'สมชาย ใจดี',
    authorSuffix: 'a',
    text: 'บริการแย่มาก ผิดหวังมากครับ ไม่ประทับใจเลย',
    replyable: true,
  },
  {
    author: 'มานี รักไทย',
    authorSuffix: 'b',
    text: 'สินค้านี้ราคาเท่าไหร่ครับ มีส่งต่างจังหวัดไหม?',
    replyable: true,
  },
  {
    author: 'ปิติ ยินดี',
    authorSuffix: 'c',
    text: 'ดีมากเลยค่ะ ชอบมากๆ ประทับใจสุดๆ',
    replyable: true,
  },
  {
    author: 'Spam Bot',
    authorSuffix: 'd',
    text: 'โปรโมชั่นพิเศษ คลิกเลย http://promo.example/win รับฟรี',
    replyable: true,
  },
  {
    author: 'วิภา สงบ',
    authorSuffix: 'e',
    text: 'รับทราบครับ ขอบคุณสำหรับข้อมูล',
    replyable: false,
  },
];

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

  /** The real platform comment read. Only ever reached in live mode. */
  protected abstract fetchCommentsLive(
    args: FetchCommentsArgs,
    accessToken: string,
  ): Promise<CommentSnapshot[]>;

  /** The real platform reply write. Only ever reached in live mode. */
  protected abstract replyCommentLive(
    args: ReplyCommentArgs,
    accessToken: string,
  ): Promise<CommentReplyResult>;

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

  /**
   * Reads one post's comments. Mirrors fetchMetrics()'s gating exactly: a
   * faithful token check first (mock included), then either a deterministic
   * synthetic thread (mock) or the live platform read. Never logs raw
   * author/text (System Analyst condition C6b) — only counts.
   */
  async fetchComments(args: FetchCommentsArgs): Promise<CommentSnapshot[]> {
    const accessToken = args.accessToken;
    if (!accessToken || accessToken.trim().length === 0) {
      throw new PublisherTokenError(
        `No decrypted access token available for connected account ${args.account.id}`,
      );
    }
    if (!this.isLiveMode()) {
      return this.mockComments(args.post);
    }
    return this.fetchCommentsLive(args, accessToken);
  }

  /**
   * Posts one reply. Same gating as publish/fetchMetrics — faithful token
   * check first, then a deterministic dry-run reply id (mock, honoring
   * mockFailureRate so clean-fail is testable) or the live reply write.
   */
  async replyComment(args: ReplyCommentArgs): Promise<CommentReplyResult> {
    const accessToken = args.accessToken;
    if (!accessToken || accessToken.trim().length === 0) {
      throw new PublisherTokenError(
        `No decrypted access token available for connected account ${args.account.id}`,
      );
    }
    if (!this.isLiveMode()) {
      return this.replyDryRun(args);
    }
    return this.replyCommentLive(args, accessToken);
  }

  private async replyDryRun(args: ReplyCommentArgs): Promise<CommentReplyResult> {
    await this.simulateLatency();
    if (Math.random() < this.publisherConfig.mockFailureRate) {
      throw new PublisherRejectedError('Mock reply failure injected (MOCK_PUBLISHER_FAILURE_RATE)');
    }
    const replyExternalId = buildDryRunReplyId(this.platform, args.externalCommentId);
    // Counts/refs only — never the reply message body (C6b/C7).
    this.logger.log(
      `[dry-run] ${this.platform}: would reply to comment ${args.externalCommentId} ` +
        `on post ${args.post.id} — no network call, returning ${replyExternalId}`,
    );
    return { replyExternalId };
  }

  /**
   * Deterministic synthetic comment thread for mock mode, seeded by post id so
   * a given post always yields the same comments (and thus the same
   * externalCommentIds, making re-sync dedup idempotent — exit #1). No network
   * I/O — the mock analogue of publishDryRun. Every id is non-null/non-empty
   * (C3).
   */
  private mockComments(post: Post): CommentSnapshot[] {
    const seed = hashString(post.id);
    const postedAt = post.postedAt ?? post.createdAt ?? new Date();
    const baseTime = new Date(postedAt).getTime();
    const count = 3 + (seed % (MOCK_COMMENT_SAMPLES.length - 2)); // 3..4 comments
    const comments: CommentSnapshot[] = [];
    for (let index = 0; index < count; index += 1) {
      const sample = MOCK_COMMENT_SAMPLES[(seed + index) % MOCK_COMMENT_SAMPLES.length];
      comments.push({
        externalCommentId: buildMockCommentId(this.platform, post.id, index),
        author: sample.author,
        authorExternalId: `${this.platform}-user-${sample.authorSuffix}`,
        text: sample.text,
        createdAt: new Date(baseTime + index * 60_000),
        replyable: sample.replyable,
      });
    }
    return comments;
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

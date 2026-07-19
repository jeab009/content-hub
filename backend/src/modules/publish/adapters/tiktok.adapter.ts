import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssetPlatform, ContentType } from '@prisma/client';
import { AppConfig } from '../../../config/configuration';
import { BasePlatformAdapter } from './base-platform.adapter';
import {
  CommentReplyResult,
  CommentSnapshot,
  FetchCommentsArgs,
  FetchMetricsArgs,
  MetricSnapshot,
  PublishArgs,
  PublishResult,
  ReplyCommentArgs,
} from './platform-adapter.interface';
import {
  PlatformCapabilityNotImplementedError,
  PublisherValidationError,
} from './publisher.errors';

/**
 * TikTok adapter — MOCK IS THE DELIVERED PATH.
 *
 * Read this before assuming any live capability exists: TikTok's Content
 * Posting API requires an *audited* app (an unaudited app can only post
 * SELF_ONLY/private), and this system has no TikTok credentials at all. So
 * there is no live path to verify and none is claimed here. Every `*Live`
 * method below rejects with a clear, typed error rather than attempting an
 * HTTP call that has never run — a plausible-looking but unexercised fetch()
 * would be theater, and it would fail at the worst possible moment.
 *
 * The path this system actually delivers for TikTok is the
 * manual-external-record endpoint (POST /api/posts/manual-external): the admin
 * posts natively in the TikTok app, then records the resulting external id +
 * URL here so the post becomes a first-class tracked entity (metrics and
 * comments attach to it, and it counts toward cadence and ranking). See
 * docs/phase5-project-plan.md Decision 1.
 *
 * In mock mode (the default) this adapter behaves exactly like the FB/YT mocks
 * via BasePlatformAdapter: faithful token check, deterministic dry-run ids,
 * zero network I/O.
 */
@Injectable()
export class TikTokAdapter extends BasePlatformAdapter {
  readonly platform = AssetPlatform.tiktok;

  constructor(configService: ConfigService) {
    const app = configService.get<AppConfig>('app');
    if (!app) {
      throw new Error('App config not loaded');
    }
    super(app.publisher);
  }

  protected isLiveMode(): boolean {
    return this.publisherConfig.tiktokImpl !== 'mock';
  }

  /** TikTok is a video-first feed; text/image posts have no representation. */
  protected validateArgs(args: PublishArgs): void {
    if (args.content.type !== ContentType.video) {
      throw new PublisherValidationError(
        `TikTok only accepts video content; content ${args.content.id} is "${args.content.type}"`,
      );
    }
  }

  /**
   * Pre-dispatch rejection, NOT a network call. PublisherValidationError maps
   * to post status `failed` (confirmed nothing was created), so enabling the
   * flag without an audited app fails safely and audibly instead of leaving a
   * post in `posted_unconfirmed` limbo.
   */
  protected publishLive(_args: PublishArgs, _accessToken: string): Promise<PublishResult> {
    return Promise.reject(
      new PublisherValidationError(
        'PUBLISHER_IMPL_TIKTOK is set to live, but no verified TikTok Content Posting API ' +
          'integration exists (it requires an audited app and credentials this system does not ' +
          'have). Set PUBLISHER_IMPL_TIKTOK=mock and record posts via POST /api/posts/manual-external.',
      ),
    );
  }

  /** No TikTok metrics API is wired — revenue/reach for TikTok stay manual. */
  protected fetchMetricsLive(
    _args: FetchMetricsArgs,
    _accessToken: string,
  ): Promise<MetricSnapshot> {
    return Promise.reject(
      new PlatformCapabilityNotImplementedError(
        'TikTok metrics are not available via API in this system; enter them manually ' +
          '(metrics.source = "manual").',
      ),
    );
  }

  /** Comment aggregation was Phase 4 = Facebook + YouTube only. */
  protected fetchCommentsLive(
    _args: FetchCommentsArgs,
    _accessToken: string,
  ): Promise<CommentSnapshot[]> {
    return Promise.reject(
      new PlatformCapabilityNotImplementedError(
        'TikTok comment aggregation is not implemented (Phase 4 covered Facebook and YouTube only).',
      ),
    );
  }

  protected replyCommentLive(
    _args: ReplyCommentArgs,
    _accessToken: string,
  ): Promise<CommentReplyResult> {
    return Promise.reject(
      new PlatformCapabilityNotImplementedError(
        'TikTok comment reply is not implemented (Phase 4 covered Facebook and YouTube only).',
      ),
    );
  }
}

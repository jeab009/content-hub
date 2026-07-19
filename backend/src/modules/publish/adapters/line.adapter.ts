import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssetPlatform } from '@prisma/client';
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
 * LINE Official Account adapter — MOCK IS THE DELIVERED PATH.
 *
 * Two things make a live LINE path different from Facebook/YouTube, and both
 * are reasons nothing live is claimed here:
 *
 * 1. No credentials exist for this system (same as TikTok).
 * 2. More fundamentally, the LINE Messaging API *broadcasts/pushes a message
 *    to OA followers* — it does not create a durable feed "post" the way FB
 *    and YT do. A broadcast is a send, not a publish: it cannot be edited, its
 *    "external id" is a message id rather than a permalink, and it has no
 *    comment thread. Mapping that onto this system's Post model is a design
 *    question, not just an integration task.
 *
 * So `publishLive` rejects cleanly rather than pretending. The delivered path
 * is the manual-external-record endpoint (POST /api/posts/manual-external) —
 * see docs/phase5-project-plan.md Decision 1. In mock mode (the default) this
 * behaves exactly like the FB/YT mocks via BasePlatformAdapter.
 */
@Injectable()
export class LineAdapter extends BasePlatformAdapter {
  readonly platform = AssetPlatform.line_oa;

  constructor(configService: ConfigService) {
    const app = configService.get<AppConfig>('app');
    if (!app) {
      throw new Error('App config not loaded');
    }
    super(app.publisher);
  }

  protected isLiveMode(): boolean {
    return this.publisherConfig.lineImpl !== 'mock';
  }

  /**
   * A LINE OA broadcast always carries a message body, so content with no
   * caption has nothing to send. Deliberately permissive on content type:
   * LINE messages can carry text, image, or video.
   */
  protected validateArgs(args: PublishArgs): void {
    const caption = args.content.caption?.trim() ?? '';
    if (caption.length === 0) {
      throw new PublisherValidationError(
        `LINE OA messages need a caption to use as the message body; content ${args.content.id} has none`,
      );
    }
  }

  /**
   * Pre-dispatch rejection, NOT a network call. PublisherValidationError maps
   * to post status `failed` (confirmed nothing was sent) — important here,
   * because a broadcast that MIGHT have gone out to every follower is exactly
   * the ambiguity this system refuses to create.
   */
  protected publishLive(_args: PublishArgs, _accessToken: string): Promise<PublishResult> {
    return Promise.reject(
      new PublisherValidationError(
        'PUBLISHER_IMPL_LINE is set to live, but no verified LINE Messaging API integration ' +
          'exists (no credentials, and a LINE broadcast is a push to followers rather than a ' +
          'feed post — see the adapter docblock). Set PUBLISHER_IMPL_LINE=mock and record posts ' +
          'via POST /api/posts/manual-external.',
      ),
    );
  }

  /** LINE OA gives no per-message revenue/reach API — metrics stay manual. */
  protected fetchMetricsLive(
    _args: FetchMetricsArgs,
    _accessToken: string,
  ): Promise<MetricSnapshot> {
    return Promise.reject(
      new PlatformCapabilityNotImplementedError(
        'LINE OA metrics are not available via API in this system; enter them manually ' +
          '(metrics.source = "manual").',
      ),
    );
  }

  /** A broadcast has no comment thread; Phase 4 covered FB/YT only. */
  protected fetchCommentsLive(
    _args: FetchCommentsArgs,
    _accessToken: string,
  ): Promise<CommentSnapshot[]> {
    return Promise.reject(
      new PlatformCapabilityNotImplementedError(
        'LINE OA comment aggregation is not implemented (a broadcast has no comment thread; ' +
          'Phase 4 covered Facebook and YouTube only).',
      ),
    );
  }

  protected replyCommentLive(
    _args: ReplyCommentArgs,
    _accessToken: string,
  ): Promise<CommentReplyResult> {
    return Promise.reject(
      new PlatformCapabilityNotImplementedError(
        'LINE OA comment reply is not implemented (Phase 4 covered Facebook and YouTube only).',
      ),
    );
  }
}

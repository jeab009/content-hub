import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssetPlatform, ContentType } from '@prisma/client';
import { AppConfig } from '../../../config/configuration';
import { BasePlatformAdapter } from './base-platform.adapter';
import { PublishArgs, PublishResult } from './platform-adapter.interface';
import {
  PublisherAmbiguousError,
  PublisherRejectedError,
  PublisherValidationError,
} from './publisher.errors';

interface GraphPublishResponse {
  id?: string;
  post_id?: string;
}

/**
 * Facebook Page publishing via the Graph API, using the ConnectedAccount's
 * decrypted Page token. Route per content type: image → /{page}/photos,
 * video → /{page}/videos, text → /{page}/feed.
 *
 * DELIBERATE DEVIATION from the OAuth code's retry-once-on-network-failure
 * pattern: the publish POST is NEVER retried at this layer. A network error
 * after dispatch means the outcome is unknown (the post may be live), and a
 * blind retry is exactly the double-post scenario REL-002 exists to
 * prevent — the error is surfaced as PublisherAmbiguousError instead and
 * resolved by a human. Retry-once remains correct for idempotent reads
 * (token exchange, page listing) and stays in ConnectedAccountsService.
 */
@Injectable()
export class FacebookAdapter extends BasePlatformAdapter {
  readonly platform = AssetPlatform.facebook;
  private readonly graphBaseUrl: string;

  constructor(configService: ConfigService) {
    const app = configService.get<AppConfig>('app');
    if (!app) {
      throw new Error('App config not loaded');
    }
    super(app.publisher);
    this.graphBaseUrl = `https://graph.facebook.com/${app.facebook.graphApiVersion}`;
  }

  protected isLiveMode(): boolean {
    return this.publisherConfig.facebookImpl !== 'mock';
  }

  protected async publishLive(args: PublishArgs, accessToken: string): Promise<PublishResult> {
    const { path, body } = this.buildGraphRequest(args, accessToken);

    let response: Response;
    try {
      response = await fetch(`${this.graphBaseUrl}${path}`, { method: 'POST', body });
    } catch (error) {
      // The request was dispatched; the platform may or may not have
      // created the post. Do NOT retry — see class doc.
      throw new PublisherAmbiguousError(
        `Network failure after dispatching Facebook publish: ${(error as Error).message}`,
      );
    }

    if (!response.ok) {
      throw new PublisherRejectedError(
        `Facebook Graph API rejected the publish (HTTP ${response.status})`,
      );
    }

    let payload: GraphPublishResponse;
    try {
      payload = (await response.json()) as GraphPublishResponse;
    } catch {
      throw new PublisherAmbiguousError(
        'Facebook returned a success status but an unreadable body; post may be live',
      );
    }

    const externalPostId = payload.post_id ?? payload.id;
    if (!externalPostId) {
      throw new PublisherAmbiguousError(
        'Facebook returned a success status without a post id; post may be live',
      );
    }
    return { externalPostId };
  }

  protected validateArgs(args: PublishArgs): void {
    const isMediaPost = args.content.type !== ContentType.text;
    if (isMediaPost && this.isLiveMode() && !/^https?:\/\//i.test(args.content.mediaUrl)) {
      // Graph photo/video publishing fetches the media BY URL, so a
      // local-relative /uploads/... path can never work live. Pre-dispatch
      // check → safe, retryable failure.
      throw new PublisherValidationError(
        `Facebook media posts require a publicly reachable media URL; got "${args.content.mediaUrl}"`,
      );
    }
  }

  private buildGraphRequest(
    args: PublishArgs,
    accessToken: string,
  ): { path: string; body: URLSearchParams } {
    const pageId = args.account.platformAccountId;
    const caption = args.content.caption ?? args.content.title;

    switch (args.content.type) {
      case ContentType.image:
        return {
          path: `/${pageId}/photos`,
          body: new URLSearchParams({
            url: args.content.mediaUrl,
            caption,
            access_token: accessToken,
          }),
        };
      case ContentType.video:
        return {
          path: `/${pageId}/videos`,
          body: new URLSearchParams({
            file_url: args.content.mediaUrl,
            description: caption,
            access_token: accessToken,
          }),
        };
      default:
        return {
          path: `/${pageId}/feed`,
          body: new URLSearchParams({ message: caption, access_token: accessToken }),
        };
    }
  }
}

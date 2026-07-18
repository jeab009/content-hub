import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssetPlatform, ContentType } from '@prisma/client';
import { readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { AppConfig } from '../../../config/configuration';
import { BasePlatformAdapter } from './base-platform.adapter';
import { PublishArgs, PublishResult } from './platform-adapter.interface';
import {
  PublisherAmbiguousError,
  PublisherRejectedError,
  PublisherValidationError,
} from './publisher.errors';

const YOUTUBE_RESUMABLE_UPLOAD_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

interface YouTubeVideoResponse {
  id?: string;
}

/**
 * YouTube video publishing via the Data API v3 resumable-upload flow:
 * (1) initiate an upload session (safe — nothing exists until bytes land),
 * (2) PUT the media bytes to the session URL (the dispatch — a network
 * failure here is ambiguous and maps to posted_unconfirmed).
 *
 * Like FacebookAdapter, the upload PUT is deliberately never retried at
 * this layer (double-post risk); session initiation failures ARE safe and
 * map to a retryable rejection. Without real Google credentials this
 * adapter only ever runs in dry-run mode locally — expected and fine.
 * Uploads are created as `private` so even a live misfire never goes
 * public without a human touching YouTube Studio.
 */
@Injectable()
export class YouTubeAdapter extends BasePlatformAdapter {
  readonly platform = AssetPlatform.youtube;
  private readonly uploadStorageDir: string;

  constructor(configService: ConfigService) {
    const app = configService.get<AppConfig>('app');
    if (!app) {
      throw new Error('App config not loaded');
    }
    super(app.publisher);
    this.uploadStorageDir = app.upload.storageDir;
  }

  protected isLiveMode(): boolean {
    return this.publisherConfig.youtubeImpl !== 'mock';
  }

  protected validateArgs(args: PublishArgs): void {
    if (args.content.type !== ContentType.video) {
      throw new PublisherValidationError(
        `YouTube only accepts video content; content ${args.content.id} is "${args.content.type}"`,
      );
    }
  }

  protected async publishLive(args: PublishArgs, accessToken: string): Promise<PublishResult> {
    const mediaPath = await this.resolveLocalMediaPath(args.content.mediaUrl);
    const sessionUrl = await this.initiateUploadSession(args, accessToken);
    return this.uploadMediaBytes(sessionUrl, mediaPath, accessToken);
  }

  /**
   * The stored mediaUrl is a server-local /uploads/<uuid>.<ext> path (see
   * LocalDiskStorageAdapter); resolve it back to a file on disk. Using only
   * the basename keeps any unexpected path segments from escaping the
   * storage dir.
   */
  private async resolveLocalMediaPath(mediaUrl: string): Promise<string> {
    const mediaPath = join(this.uploadStorageDir, basename(mediaUrl));
    const fileInfo = await stat(mediaPath).catch(() => null);
    if (!fileInfo || !fileInfo.isFile()) {
      throw new PublisherValidationError(`Media file not found on disk for "${mediaUrl}"`);
    }
    return mediaPath;
  }

  /** Step 1 — safe: no video exists until the media bytes are uploaded. */
  private async initiateUploadSession(args: PublishArgs, accessToken: string): Promise<string> {
    let response: Response;
    try {
      response = await fetch(YOUTUBE_RESUMABLE_UPLOAD_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
          snippet: {
            title: args.content.title,
            description: args.content.caption ?? '',
          },
          status: { privacyStatus: 'private' },
        }),
      });
    } catch (error) {
      throw new PublisherRejectedError(
        `Could not reach YouTube to initiate the upload session: ${(error as Error).message}`,
      );
    }

    if (!response.ok) {
      throw new PublisherRejectedError(
        `YouTube rejected the upload session request (HTTP ${response.status})`,
      );
    }
    const sessionUrl = response.headers.get('location');
    if (!sessionUrl) {
      throw new PublisherRejectedError('YouTube did not return a resumable upload session URL');
    }
    return sessionUrl;
  }

  /** Step 2 — the dispatch. Network failure here is ambiguous; never retried. */
  private async uploadMediaBytes(
    sessionUrl: string,
    mediaPath: string,
    accessToken: string,
  ): Promise<PublishResult> {
    const mediaBytes = await readFile(mediaPath);

    let response: Response;
    try {
      response = await fetch(sessionUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Length': String(mediaBytes.byteLength),
        },
        body: mediaBytes,
      });
    } catch (error) {
      throw new PublisherAmbiguousError(
        `Network failure after dispatching YouTube upload: ${(error as Error).message}`,
      );
    }

    if (!response.ok) {
      throw new PublisherRejectedError(
        `YouTube rejected the media upload (HTTP ${response.status})`,
      );
    }

    let payload: YouTubeVideoResponse;
    try {
      payload = (await response.json()) as YouTubeVideoResponse;
    } catch {
      throw new PublisherAmbiguousError(
        'YouTube returned a success status but an unreadable body; video may exist',
      );
    }
    if (!payload.id) {
      throw new PublisherAmbiguousError(
        'YouTube returned a success status without a video id; video may exist',
      );
    }
    return { externalPostId: payload.id };
  }
}

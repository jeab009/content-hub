import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssetPlatform, ContentType } from '@prisma/client';
import { readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
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
  PublisherAmbiguousError,
  PublisherRejectedError,
  PublisherValidationError,
} from './publisher.errors';

const YOUTUBE_RESUMABLE_UPLOAD_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

const YOUTUBE_ANALYTICS_URL = 'https://youtubeanalytics.googleapis.com/v2/reports';

const YOUTUBE_DATA_API_URL = 'https://www.googleapis.com/youtube/v3';

interface YouTubeVideoResponse {
  id?: string;
}

interface YouTubeAnalyticsResponse {
  columnHeaders?: Array<{ name?: string }>;
  rows?: Array<Array<number>>;
}

interface YouTubeCommentThreadsResponse {
  items?: Array<{
    snippet?: {
      canReply?: boolean;
      topLevelComment?: {
        id?: string;
        snippet?: {
          textOriginal?: string;
          authorDisplayName?: string;
          authorChannelId?: { value?: string };
          publishedAt?: string;
        };
      };
    };
  }>;
  nextPageToken?: string;
}

interface YouTubeCommentInsertResponse {
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

  /**
   * Live video metrics via the YouTube Analytics API (reports.query, which
   * is synchronous — unlike the bulk Reporting API). reach = views,
   * engagement = likes+comments+shares, revenue = estimatedRevenue (requires
   * the yt-analytics-monetary.readonly scope; makedown.md §6). Only reached
   * when PUBLISHER_IMPL_YOUTUBE != 'mock'.
   */
  protected async fetchMetricsLive(
    args: FetchMetricsArgs,
    accessToken: string,
  ): Promise<MetricSnapshot> {
    const videoId = args.post.externalPostId;
    if (!videoId) {
      throw new PublisherValidationError(
        `Post ${args.post.id} has no externalPostId; cannot read YouTube analytics`,
      );
    }
    const postedAt = args.post.postedAt ?? args.post.createdAt;
    const startDate = new Date(postedAt).toISOString().slice(0, 10);
    const endDate = new Date().toISOString().slice(0, 10);
    const query = new URLSearchParams({
      ids: 'channel==MINE',
      startDate,
      endDate,
      metrics: 'views,likes,comments,shares,estimatedRevenue',
      filters: `video==${videoId}`,
    });
    let response: Response;
    try {
      response = await fetch(`${YOUTUBE_ANALYTICS_URL}?${query.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (error) {
      throw new PublisherRejectedError(
        `Network failure reading YouTube analytics: ${(error as Error).message}`,
      );
    }
    if (!response.ok) {
      throw new PublisherRejectedError(
        `YouTube Analytics API rejected the read (HTTP ${response.status})`,
      );
    }
    const payload = (await response.json().catch(() => ({}))) as YouTubeAnalyticsResponse;
    const headers = payload.columnHeaders?.map((column) => column.name) ?? [];
    const row = payload.rows?.[0] ?? [];
    const read = (name: string): number => {
      const index = headers.indexOf(name);
      const value = index >= 0 ? row[index] : 0;
      return typeof value === 'number' && Number.isFinite(value) ? value : 0;
    };
    return {
      reach: read('views'),
      engagement: read('likes') + read('comments') + read('shares'),
      revenue: Math.round(read('estimatedRevenue') * 100) / 100,
    };
  }

  /**
   * Live comments via the Data API v3 `commentThreads.list` (top-level
   * comments for the video). Only reached when PUBLISHER_IMPL_YOUTUBE !=
   * 'mock'. Threads missing a comment id or text are dropped (C3: never emit a
   * null external id).
   */
  protected async fetchCommentsLive(
    args: FetchCommentsArgs,
    accessToken: string,
  ): Promise<CommentSnapshot[]> {
    const videoId = args.post.externalPostId;
    if (!videoId) {
      throw new PublisherValidationError(
        `Post ${args.post.id} has no externalPostId; cannot read YouTube comments`,
      );
    }
    const query = new URLSearchParams({
      part: 'snippet',
      videoId,
      maxResults: '100',
      textFormat: 'plainText',
    });
    if (args.sincePageToken) {
      query.set('pageToken', args.sincePageToken);
    }
    let response: Response;
    try {
      response = await fetch(`${YOUTUBE_DATA_API_URL}/commentThreads?${query.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (error) {
      throw new PublisherRejectedError(
        `Network failure reading YouTube comments: ${(error as Error).message}`,
      );
    }
    if (!response.ok) {
      throw new PublisherRejectedError(
        `YouTube Data API rejected the comments read (HTTP ${response.status})`,
      );
    }
    const payload = (await response.json().catch(() => ({}))) as YouTubeCommentThreadsResponse;
    return (payload.items ?? [])
      .map((item) => ({ top: item.snippet?.topLevelComment, canReply: item.snippet?.canReply }))
      .filter(
        (entry) =>
          entry.top?.id &&
          entry.top.id.length > 0 &&
          typeof entry.top.snippet?.textOriginal === 'string',
      )
      .map(({ top, canReply }) => ({
        externalCommentId: top?.id as string,
        author: top?.snippet?.authorDisplayName ?? 'YouTube user',
        authorExternalId: top?.snippet?.authorChannelId?.value ?? null,
        text: top?.snippet?.textOriginal ?? '',
        createdAt: top?.snippet?.publishedAt ? new Date(top.snippet.publishedAt) : new Date(),
        replyable: canReply !== false,
      }));
  }

  /**
   * Live reply via the Data API v3 `comments.insert` (a reply to a top-level
   * comment). Only reached in live mode.
   */
  protected async replyCommentLive(
    args: ReplyCommentArgs,
    accessToken: string,
  ): Promise<CommentReplyResult> {
    let response: Response;
    try {
      response = await fetch(`${YOUTUBE_DATA_API_URL}/comments?part=snippet`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
          snippet: { parentId: args.externalCommentId, textOriginal: args.message },
        }),
      });
    } catch (error) {
      throw new PublisherRejectedError(
        `Network failure posting YouTube reply: ${(error as Error).message}`,
      );
    }
    if (!response.ok) {
      throw new PublisherRejectedError(
        `YouTube Data API rejected the reply (HTTP ${response.status})`,
      );
    }
    const payload = (await response.json().catch(() => ({}))) as YouTubeCommentInsertResponse;
    if (!payload.id) {
      throw new PublisherRejectedError('YouTube returned no reply id');
    }
    return { replyExternalId: payload.id };
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

import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssetPlatform, ConnectedAccount, Content, ContentType, Post } from '@prisma/client';
import { AppConfig } from '../../../config/configuration';
import {
  FetchCommentsArgs,
  FetchMetricsArgs,
  PlatformAdapter,
  PublishArgs,
  ReplyCommentArgs,
} from './platform-adapter.interface';
import { FacebookAdapter } from './facebook.adapter';
import { YouTubeAdapter } from './youtube.adapter';
import { PlatformAdapterRegistry } from './platform-adapter.registry';
import { PublisherTokenError, PublisherValidationError } from './publisher.errors';

/**
 * Shared contract spec, run against every adapter in dry-run (mock) mode —
 * the interface behavior all adapters must uphold regardless of platform.
 */

const dryRunAppConfig = {
  publisher: {
    facebookImpl: 'mock',
    youtubeImpl: 'mock',
    mockLatencyMs: 0,
    mockFailureRate: 0,
  },
  facebook: { graphApiVersion: 'v21.0' },
  upload: { storageDir: './storage/uploads' },
} as AppConfig;

const configService = {
  get: jest.fn().mockReturnValue(dryRunAppConfig),
} as unknown as ConfigService;

function buildArgs(overrides: Partial<PublishArgs> = {}): PublishArgs {
  return {
    post: { id: 'post-1' } as Post,
    content: {
      id: 'content-1',
      type: ContentType.video,
      title: 'Test clip',
      caption: 'caption',
      mediaUrl: '/uploads/clip.mp4',
    } as Content,
    account: {
      id: 'acct-1',
      platformAccountId: 'page-1',
      platformAccountName: 'Test Page',
    } as ConnectedAccount,
    accessToken: 'decrypted-token',
    ...overrides,
  };
}

interface AdapterCase {
  name: string;
  platform: AssetPlatform;
  build: () => PlatformAdapter;
}

const adapterCases: AdapterCase[] = [
  {
    name: 'FacebookAdapter',
    platform: AssetPlatform.facebook,
    build: () => new FacebookAdapter(configService),
  },
  {
    name: 'YouTubeAdapter',
    platform: AssetPlatform.youtube,
    build: () => new YouTubeAdapter(configService),
  },
];

describe.each(adapterCases)('PlatformAdapter contract — $name (dry-run)', ({ platform, build }) => {
  let adapter: PlatformAdapter;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    adapter = build();
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('exposes its platform', () => {
    expect(adapter.platform).toBe(platform);
  });

  it('publishes in dry-run mode: returns a deterministic dry-run external id with ZERO network I/O', async () => {
    const result = await adapter.publish(buildArgs());

    expect(result.externalPostId).toBe(`dry-run-${platform}-post-1`);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws PublisherTokenError on a missing token — even in dry-run, so the rehearsal is faithful', async () => {
    await expect(adapter.publish(buildArgs({ accessToken: null }))).rejects.toThrow(
      PublisherTokenError,
    );
    await expect(adapter.publish(buildArgs({ accessToken: '  ' }))).rejects.toThrow(
      PublisherTokenError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reads metrics in dry-run mode: deterministic synthetic snapshot with ZERO network I/O', async () => {
    const metricsArgs: FetchMetricsArgs = {
      post: { id: 'post-1', postedAt: new Date('2026-07-10T00:00:00Z') } as Post,
      account: { id: 'acct-1' } as ConnectedAccount,
      accessToken: 'decrypted-token',
    };
    const first = await adapter.fetchMetrics(metricsArgs);
    const second = await adapter.fetchMetrics(metricsArgs);

    expect(first).toEqual(second); // deterministic for a given post
    expect(first.reach).toBeGreaterThan(0);
    expect(first.engagement).toBeGreaterThanOrEqual(0);
    expect(first.revenue).toBeGreaterThanOrEqual(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects fetchMetrics with a missing token — even in dry-run, so the rehearsal is faithful', async () => {
    const metricsArgs: FetchMetricsArgs = {
      post: { id: 'post-1' } as Post,
      account: { id: 'acct-1' } as ConnectedAccount,
      accessToken: null,
    };
    await expect(adapter.fetchMetrics(metricsArgs)).rejects.toThrow(PublisherTokenError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reads comments in dry-run mode: deterministic synthetic thread with ZERO network I/O', async () => {
    const commentsArgs: FetchCommentsArgs = {
      post: { id: 'post-1', postedAt: new Date('2026-07-10T00:00:00Z') } as Post,
      account: { id: 'acct-1' } as ConnectedAccount,
      accessToken: 'decrypted-token',
    };
    const first = await adapter.fetchComments(commentsArgs);
    const second = await adapter.fetchComments(commentsArgs);

    expect(first).toEqual(second); // deterministic for a given post
    expect(first.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // System Analyst condition C3 — a null/empty external id gets ZERO dedup
  // protection from the partial unique index, so every mock/live snapshot MUST
  // carry a non-null, non-empty external id.
  it('emits only non-null, non-empty externalCommentId values (C3)', async () => {
    const comments = await adapter.fetchComments({
      post: { id: 'post-42', postedAt: new Date('2026-07-10T00:00:00Z') } as Post,
      account: { id: 'acct-1' } as ConnectedAccount,
      accessToken: 'decrypted-token',
    });
    for (const comment of comments) {
      expect(typeof comment.externalCommentId).toBe('string');
      expect(comment.externalCommentId.length).toBeGreaterThan(0);
    }
  });

  it('rejects fetchComments with a missing token — even in dry-run, so the rehearsal is faithful', async () => {
    await expect(
      adapter.fetchComments({
        post: { id: 'post-1' } as Post,
        account: { id: 'acct-1' } as ConnectedAccount,
        accessToken: null,
      }),
    ).rejects.toThrow(PublisherTokenError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('replies in dry-run mode: deterministic reply id with ZERO network I/O', async () => {
    const replyArgs: ReplyCommentArgs = {
      post: { id: 'post-1' } as Post,
      account: { id: 'acct-1' } as ConnectedAccount,
      accessToken: 'decrypted-token',
      externalCommentId: 'c-1',
      message: 'ขอบคุณครับ',
    };
    const result = await adapter.replyComment(replyArgs);

    expect(result.replyExternalId).toBe(`dry-run-reply-${platform}-c-1`);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects replyComment with a missing token — even in dry-run, so the rehearsal is faithful', async () => {
    await expect(
      adapter.replyComment({
        post: { id: 'post-1' } as Post,
        account: { id: 'acct-1' } as ConnectedAccount,
        accessToken: null,
        externalCommentId: 'c-1',
        message: 'hi',
      }),
    ).rejects.toThrow(PublisherTokenError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('PlatformAdapterRegistry — TikTok / LINE OA stay unimplemented (Phase 5)', () => {
  const registry = new PlatformAdapterRegistry(
    new FacebookAdapter(configService),
    new YouTubeAdapter(configService),
  );

  it('serves FB + YouTube adapters', () => {
    expect(registry.getFor(AssetPlatform.facebook)).toBeInstanceOf(FacebookAdapter);
    expect(registry.getFor(AssetPlatform.youtube)).toBeInstanceOf(YouTubeAdapter);
  });

  it('rejects TikTok and LINE OA — no adapter for any capability yet', () => {
    expect(() => registry.getFor(AssetPlatform.tiktok)).toThrow(BadRequestException);
    expect(() => registry.getFor(AssetPlatform.line_oa)).toThrow(BadRequestException);
  });
});

describe('YouTubeAdapter platform-specific validation', () => {
  it('rejects non-video content pre-dispatch, dry-run included', async () => {
    const adapter = new YouTubeAdapter(configService);
    const args = buildArgs();
    args.content = { ...args.content, type: ContentType.image } as Content;

    await expect(adapter.publish(args)).rejects.toThrow(PublisherValidationError);
  });
});

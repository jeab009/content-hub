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
import { TikTokAdapter } from './tiktok.adapter';
import { LineAdapter } from './line.adapter';
import { PlatformAdapterRegistry } from './platform-adapter.registry';
import {
  PlatformCapabilityNotImplementedError,
  PublisherTokenError,
  PublisherValidationError,
} from './publisher.errors';

/**
 * Shared contract spec, run against every adapter in dry-run (mock) mode —
 * the interface behavior all adapters must uphold regardless of platform.
 */

const dryRunAppConfig = {
  publisher: {
    facebookImpl: 'mock',
    youtubeImpl: 'mock',
    tiktokImpl: 'mock',
    lineImpl: 'mock',
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
  {
    name: 'TikTokAdapter',
    platform: AssetPlatform.tiktok,
    build: () => new TikTokAdapter(configService),
  },
  {
    name: 'LineAdapter',
    platform: AssetPlatform.line_oa,
    build: () => new LineAdapter(configService),
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

// Phase 5 retargets (rather than deletes) the old "TikTok/LINE stay
// unimplemented" block: the coverage that mattered was "the registry maps
// exactly the platforms it claims to", which is still worth asserting now that
// the expected answer flipped. Risk R6.
describe('PlatformAdapterRegistry — all four platforms resolve (Phase 5)', () => {
  const registry = new PlatformAdapterRegistry(
    new FacebookAdapter(configService),
    new YouTubeAdapter(configService),
    new TikTokAdapter(configService),
    new LineAdapter(configService),
  );

  it('serves an adapter for every AssetPlatform value', () => {
    expect(registry.getFor(AssetPlatform.facebook)).toBeInstanceOf(FacebookAdapter);
    expect(registry.getFor(AssetPlatform.youtube)).toBeInstanceOf(YouTubeAdapter);
    expect(registry.getFor(AssetPlatform.tiktok)).toBeInstanceOf(TikTokAdapter);
    expect(registry.getFor(AssetPlatform.line_oa)).toBeInstanceOf(LineAdapter);

    for (const platform of Object.values(AssetPlatform)) {
      expect(registry.supports(platform)).toBe(true);
    }
  });

  it('still rejects a genuinely unknown platform value', () => {
    const notAPlatform = 'myspace' as AssetPlatform;

    expect(registry.supports(notAPlatform)).toBe(false);
    expect(() => registry.getFor(notAPlatform)).toThrow(BadRequestException);
  });
});

describe('TikTok / LINE OA adapters — live paths are unverified stubs', () => {
  /**
   * These two ship registered and mock-default, but NOTHING here has ever run
   * against a real API. The point of these assertions is that enabling the
   * live flag fails CLEANLY and pre-dispatch (PublisherValidationError maps to
   * post status `failed` = "confirmed nothing was created"), never leaving a
   * post stranded in posted_unconfirmed.
   */
  const liveConfig = {
    get: jest.fn().mockReturnValue({
      ...dryRunAppConfig,
      publisher: { ...dryRunAppConfig.publisher, tiktokImpl: 'tiktok', lineImpl: 'line' },
    }),
  } as unknown as ConfigService;

  const liveCases = [
    { name: 'TikTokAdapter', build: () => new TikTokAdapter(liveConfig) },
    { name: 'LineAdapter', build: () => new LineAdapter(liveConfig) },
  ];

  it.each(liveCases)(
    '$name rejects live publish pre-dispatch with no network I/O',
    async ({ build }) => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch');
      try {
        await expect(build().publish(buildArgs())).rejects.toThrow(PublisherValidationError);
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
      }
    },
  );

  it.each(liveCases)(
    '$name reports metrics/comments/reply as not implemented',
    async ({ build }) => {
      const adapter = build();
      const base = {
        post: { id: 'post-1' } as Post,
        account: { id: 'acct-1' } as ConnectedAccount,
        accessToken: 'decrypted-token',
      };

      await expect(adapter.fetchMetrics(base)).rejects.toThrow(
        PlatformCapabilityNotImplementedError,
      );
      await expect(adapter.fetchComments(base)).rejects.toThrow(
        PlatformCapabilityNotImplementedError,
      );
      await expect(
        adapter.replyComment({ ...base, externalCommentId: 'c-1', message: 'hi' }),
      ).rejects.toThrow(PlatformCapabilityNotImplementedError);
    },
  );
});

describe('TikTokAdapter platform-specific validation', () => {
  it('rejects non-video content pre-dispatch, dry-run included', async () => {
    const adapter = new TikTokAdapter(configService);
    const args = buildArgs();
    args.content = { ...args.content, type: ContentType.image } as Content;

    await expect(adapter.publish(args)).rejects.toThrow(PublisherValidationError);
  });
});

describe('LineAdapter platform-specific validation', () => {
  it('rejects content with no caption — a broadcast needs a message body', async () => {
    const adapter = new LineAdapter(configService);
    const args = buildArgs();
    args.content = { ...args.content, caption: '   ' } as Content;

    await expect(adapter.publish(args)).rejects.toThrow(PublisherValidationError);
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

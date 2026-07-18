import { ConfigService } from '@nestjs/config';
import { AssetPlatform, ConnectedAccount, Content, ContentType, Post } from '@prisma/client';
import { AppConfig } from '../../../config/configuration';
import { PlatformAdapter, PublishArgs } from './platform-adapter.interface';
import { FacebookAdapter } from './facebook.adapter';
import { YouTubeAdapter } from './youtube.adapter';
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

  it('stubs Phase 3/4 capabilities with a typed not-implemented error', async () => {
    const post = { id: 'post-1' } as Post;
    await expect(adapter.fetchMetrics(post)).rejects.toThrow(PlatformCapabilityNotImplementedError);
    await expect(adapter.fetchComments(post)).rejects.toThrow(
      PlatformCapabilityNotImplementedError,
    );
    await expect(adapter.replyComment(post, 'c1', 'hi')).rejects.toThrow(
      PlatformCapabilityNotImplementedError,
    );
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

import { ConfigService } from '@nestjs/config';
import { CommerceChannel } from '@prisma/client';
import { AppConfig } from '../../../config/configuration';
import { AuditLogService } from '../../../common/audit/audit-log.service';
import { CommerceAdapter, buildMockMediaId } from './commerce-adapter.interface';
import { CommerceCredentialsError, CommerceIntegrationUnavailableError } from './commerce.errors';
import { MockShopeeAdapter } from './mock-shopee.adapter';
import { MockTikTokShopAdapter } from './mock-tiktok-shop.adapter';
import { ShopeeAdapter } from './shopee.adapter';
import { TikTokShopAdapter } from './tiktok-shop.adapter';
import { CommerceAdapterRegistry } from './commerce-adapter.registry';

/**
 * Shared contract spec, mirroring `platform-adapter.contract.spec.ts`: the
 * interface behavior every mock commerce adapter must uphold, run against
 * both channels via `describe.each`.
 */

const credentials = { partnerId: 'p-1', partnerKey: 'k-1' };

interface MockAdapterCase {
  name: string;
  channel: CommerceChannel;
  build: () => CommerceAdapter;
}

const mockCases: MockAdapterCase[] = [
  {
    name: 'MockShopeeAdapter',
    channel: CommerceChannel.shopee,
    build: () => new MockShopeeAdapter(),
  },
  {
    name: 'MockTikTokShopAdapter',
    channel: CommerceChannel.tiktok_shop,
    build: () => new MockTikTokShopAdapter(),
  },
];

describe.each(mockCases)('CommerceAdapter contract — $name (mock)', ({ channel, build }) => {
  let adapter: CommerceAdapter;

  beforeEach(() => {
    adapter = build();
  });

  it('exposes its channel', () => {
    expect(adapter.channel).toBe(channel);
  });

  it('uploads a video deterministically with no credentials rejection when supplied', async () => {
    const args = {
      placementDraft: { contentId: 'content-1', mediaUrl: '/uploads/a.mp4', durationSeconds: 30 },
      credentials,
    };
    const result = await adapter.uploadVideo(args);
    expect(result.externalMediaId).toBe(buildMockMediaId(channel, 'content-1'));

    const second = await adapter.uploadVideo(args);
    expect(second).toEqual(result);
  });

  it('rejects uploadVideo with CommerceCredentialsError on null credentials — faithful to live', async () => {
    await expect(
      adapter.uploadVideo({
        placementDraft: { contentId: 'content-1', mediaUrl: '/uploads/a.mp4', durationSeconds: 30 },
        credentials: null,
      }),
    ).rejects.toThrow(CommerceCredentialsError);
  });

  it('reports upload status as ready with zero I/O', async () => {
    const status = await adapter.getUploadStatus({
      uploadJobId: 'mock-job-content-1',
      credentials,
    });
    expect(status.state).toBe('ready');
    expect(status.externalMediaId).toBe(buildMockMediaId(channel, 'content-1'));
  });

  it('rejects getUploadStatus with null credentials', async () => {
    await expect(
      adapter.getUploadStatus({ uploadJobId: 'mock-job-content-1', credentials: null }),
    ).rejects.toThrow(CommerceCredentialsError);
  });

  it('fetches a deterministic, non-empty product fixture with no buyer fields', async () => {
    const first = await adapter.fetchProducts({ credentials });
    const second = await adapter.fetchProducts({ credentials });
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it('rejects fetchProducts with null credentials', async () => {
    await expect(adapter.fetchProducts({ credentials: null })).rejects.toThrow(
      CommerceCredentialsError,
    );
  });

  it('fetches a deterministic, aggregate-only conversion fixture', async () => {
    const args = {
      credentials,
      periodStart: new Date('2026-07-01'),
      periodEnd: new Date('2026-07-07'),
    };
    const snapshots = await adapter.fetchConversions(args);
    expect(snapshots.length).toBeGreaterThan(0);
    for (const snapshot of snapshots) {
      expect(snapshot).not.toHaveProperty('buyerName');
      expect(snapshot).not.toHaveProperty('orderId');
    }
  });

  it('rejects fetchConversions with null credentials', async () => {
    await expect(
      adapter.fetchConversions({
        credentials: null,
        periodStart: new Date('2026-07-01'),
        periodEnd: new Date('2026-07-07'),
      }),
    ).rejects.toThrow(CommerceCredentialsError);
  });
});

describe('Live commerce adapters — rejecting stubs, audited, zero I/O (Decision 5)', () => {
  const liveCases: {
    name: string;
    channel: CommerceChannel;
    build: (audit: AuditLogService) => CommerceAdapter;
  }[] = [
    {
      name: 'ShopeeAdapter',
      channel: CommerceChannel.shopee,
      build: (audit) => new ShopeeAdapter(audit),
    },
    {
      name: 'TikTokShopAdapter',
      channel: CommerceChannel.tiktok_shop,
      build: (audit) => new TikTokShopAdapter(audit),
    },
  ];

  it.each(liveCases)(
    '$name rejects every method with CommerceIntegrationUnavailableError',
    async ({ build }) => {
      const record = jest.fn();
      const audit = { record } as unknown as AuditLogService;
      const adapter = build(audit);
      const fetchSpy = jest.spyOn(globalThis, 'fetch');

      try {
        await expect(
          adapter.uploadVideo({
            placementDraft: {
              contentId: 'content-1',
              mediaUrl: '/uploads/a.mp4',
              durationSeconds: 30,
            },
            credentials: null,
          }),
        ).rejects.toThrow(CommerceIntegrationUnavailableError);
        await expect(
          adapter.getUploadStatus({ uploadJobId: 'job-1', credentials: null }),
        ).rejects.toThrow(CommerceIntegrationUnavailableError);
        await expect(adapter.fetchProducts({ credentials: null })).rejects.toThrow(
          CommerceIntegrationUnavailableError,
        );
        await expect(
          adapter.fetchConversions({
            credentials: null,
            periodStart: new Date('2026-07-01'),
            periodEnd: new Date('2026-07-07'),
          }),
        ).rejects.toThrow(CommerceIntegrationUnavailableError);

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(record).toHaveBeenCalledTimes(4);
        for (const call of record.mock.calls) {
          expect(call[0]).toMatchObject({
            action: 'commerce_adapter_unavailable',
            result: 'failure',
          });
        }
      } finally {
        fetchSpy.mockRestore();
      }
    },
  );

  it.each(liveCases)(
    "$name's rejection message names missing credentials and points at the 6D spec doc",
    async ({ build }) => {
      const audit = { record: jest.fn() } as unknown as AuditLogService;
      const adapter = build(audit);

      await expect(adapter.fetchProducts({ credentials: null })).rejects.toThrow(
        /credentials that do not exist yet/i,
      );
      await expect(adapter.fetchProducts({ credentials: null })).rejects.toThrow(
        /docs\/phase6d-live-integration-spec\.md/,
      );
    },
  );
});

describe('CommerceAdapterRegistry', () => {
  function buildRegistry(shopeeImpl: 'mock' | 'shopee', tiktokShopImpl: 'mock' | 'tiktok_shop') {
    const configService = {
      get: jest
        .fn()
        .mockReturnValue({ commerce: { shopeeImpl, tiktokShopImpl } } as Partial<AppConfig>),
    } as unknown as ConfigService;
    const audit = { record: jest.fn() } as unknown as AuditLogService;

    return new CommerceAdapterRegistry(
      configService,
      new MockShopeeAdapter(),
      new MockTikTokShopAdapter(),
      new ShopeeAdapter(audit),
      new TikTokShopAdapter(audit),
    );
  }

  it('resolves both channels in mock mode (the mandatory default)', () => {
    const registry = buildRegistry('mock', 'mock');

    expect(registry.supports(CommerceChannel.shopee)).toBe(true);
    expect(registry.supports(CommerceChannel.tiktok_shop)).toBe(true);
    expect(registry.getFor(CommerceChannel.shopee)).toBeInstanceOf(MockShopeeAdapter);
    expect(registry.getFor(CommerceChannel.tiktok_shop)).toBeInstanceOf(MockTikTokShopAdapter);
  });

  it('resolves to the live rejecting stub when a channel flag is non-mock', () => {
    const registry = buildRegistry('shopee', 'mock');

    expect(registry.getFor(CommerceChannel.shopee)).toBeInstanceOf(ShopeeAdapter);
    expect(registry.getFor(CommerceChannel.tiktok_shop)).toBeInstanceOf(MockTikTokShopAdapter);
  });

  it('rejects a genuinely unknown channel', () => {
    const registry = buildRegistry('mock', 'mock');
    const notAChannel = 'lazada' as CommerceChannel;

    expect(registry.supports(notAChannel)).toBe(false);
    expect(() => registry.getFor(notAChannel)).toThrow('No commerce adapter for channel "lazada"');
  });
});

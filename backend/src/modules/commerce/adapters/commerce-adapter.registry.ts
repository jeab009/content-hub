import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommerceChannel } from '@prisma/client';
import { AppConfig } from '../../../config/configuration';
import { CommerceAdapter } from './commerce-adapter.interface';
import { MockShopeeAdapter } from './mock-shopee.adapter';
import { MockTikTokShopAdapter } from './mock-tiktok-shop.adapter';
import { ShopeeAdapter } from './shopee.adapter';
import { TikTokShopAdapter } from './tiktok-shop.adapter';

/**
 * Single lookup point from `CommerceChannel` to its adapter. A direct
 * structural copy of `PlatformAdapterRegistry` (`modules/publish/adapters/
 * platform-adapter.registry.ts`) — DELIBERATELY PARALLEL, not an extension:
 * see `commerce-adapter.interface.ts` for why the contract itself is
 * separate.
 *
 * Resolution reads `COMMERCE_IMPL_SHOPEE` / `COMMERCE_IMPL_TIKTOK_SHOP`
 * (mirroring `PUBLISHER_IMPL_*`): `mock` (the default) resolves to the
 * deterministic, no-I/O mock adapter; anything else resolves to the live
 * rejecting stub. `main.ts`'s `assertAdapterFlagsAreSafe()` already refuses
 * to boot with a non-mock value outside `NODE_ENV=production`, so this class
 * does not need to repeat that check — it only needs to route correctly once
 * boot has allowed the flag through.
 */
@Injectable()
export class CommerceAdapterRegistry {
  private readonly adapters: ReadonlyMap<CommerceChannel, CommerceAdapter>;

  constructor(
    configService: ConfigService,
    mockShopee: MockShopeeAdapter,
    mockTikTokShop: MockTikTokShopAdapter,
    liveShopee: ShopeeAdapter,
    liveTikTokShop: TikTokShopAdapter,
  ) {
    const app = configService.get<AppConfig>('app');
    if (!app) {
      throw new Error('App config not loaded');
    }

    this.adapters = new Map<CommerceChannel, CommerceAdapter>([
      [CommerceChannel.shopee, app.commerce.shopeeImpl === 'mock' ? mockShopee : liveShopee],
      [
        CommerceChannel.tiktok_shop,
        app.commerce.tiktokShopImpl === 'mock' ? mockTikTokShop : liveTikTokShop,
      ],
    ]);
  }

  supports(channel: CommerceChannel): boolean {
    return this.adapters.has(channel);
  }

  getFor(channel: CommerceChannel): CommerceAdapter {
    const adapter = this.adapters.get(channel);
    if (!adapter) {
      // Every current CommerceChannel value is registered above, so this is
      // only reachable if a new enum value is added without an adapter —
      // kept as the guard that makes that mistake loud instead of a silent
      // undefined-deref.
      throw new BadRequestException(`No commerce adapter for channel "${channel}"`);
    }
    return adapter;
  }
}

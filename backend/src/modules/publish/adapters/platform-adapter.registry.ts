import { BadRequestException, Injectable } from '@nestjs/common';
import { AssetPlatform } from '@prisma/client';
import { PlatformAdapter } from './platform-adapter.interface';
import { FacebookAdapter } from './facebook.adapter';
import { YouTubeAdapter } from './youtube.adapter';
import { TikTokAdapter } from './tiktok.adapter';
import { LineAdapter } from './line.adapter';

/**
 * Single lookup point from AssetPlatform to its adapter. Pass B shipped
 * Facebook and YouTube; Phase 5 added TikTok and LINE OA, so all four
 * AssetPlatform values now resolve and getFor no longer throws for any of
 * them.
 *
 * Registration is NOT a claim of live capability: TikTok/LINE resolve to
 * mock-first adapters whose live paths reject cleanly (no credentials, and no
 * verified integration — see those adapters' docblocks). The delivered publish
 * path for those two platforms is the manual-external-record endpoint.
 */
@Injectable()
export class PlatformAdapterRegistry {
  private readonly adapters: ReadonlyMap<AssetPlatform, PlatformAdapter>;

  constructor(
    facebookAdapter: FacebookAdapter,
    youtubeAdapter: YouTubeAdapter,
    tiktokAdapter: TikTokAdapter,
    lineAdapter: LineAdapter,
  ) {
    this.adapters = new Map<AssetPlatform, PlatformAdapter>([
      [AssetPlatform.facebook, facebookAdapter],
      [AssetPlatform.youtube, youtubeAdapter],
      [AssetPlatform.tiktok, tiktokAdapter],
      [AssetPlatform.line_oa, lineAdapter],
    ]);
  }

  supports(platform: AssetPlatform): boolean {
    return this.adapters.has(platform);
  }

  getFor(platform: AssetPlatform): PlatformAdapter {
    const adapter = this.adapters.get(platform);
    if (!adapter) {
      // Every current AssetPlatform value is registered above, so this is now
      // only reachable if a new enum value is added without an adapter — kept
      // as the guard that makes that mistake loud instead of a silent
      // undefined-deref at publish time.
      throw new BadRequestException(`No publish adapter for platform "${platform}"`);
    }
    return adapter;
  }
}

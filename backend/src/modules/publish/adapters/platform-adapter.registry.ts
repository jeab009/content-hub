import { BadRequestException, Injectable } from '@nestjs/common';
import { AssetPlatform } from '@prisma/client';
import { PlatformAdapter } from './platform-adapter.interface';
import { FacebookAdapter } from './facebook.adapter';
import { YouTubeAdapter } from './youtube.adapter';

/**
 * Single lookup point from AssetPlatform to its adapter. Pass B ships
 * Facebook and YouTube; TikTok/LINE OA (Phase 5) join by adding their
 * adapters here — nothing else in the publish flow changes.
 */
@Injectable()
export class PlatformAdapterRegistry {
  private readonly adapters: ReadonlyMap<AssetPlatform, PlatformAdapter>;

  constructor(facebookAdapter: FacebookAdapter, youtubeAdapter: YouTubeAdapter) {
    this.adapters = new Map<AssetPlatform, PlatformAdapter>([
      [AssetPlatform.facebook, facebookAdapter],
      [AssetPlatform.youtube, youtubeAdapter],
    ]);
  }

  supports(platform: AssetPlatform): boolean {
    return this.adapters.has(platform);
  }

  getFor(platform: AssetPlatform): PlatformAdapter {
    const adapter = this.adapters.get(platform);
    if (!adapter) {
      throw new BadRequestException(
        `No publish adapter for platform "${platform}" (Phase 5 scope)`,
      );
    }
    return adapter;
  }
}

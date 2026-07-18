import { AssetPlatform, Platform } from '@prisma/client';

/**
 * Bridges the two platform enums that deliberately coexist in the schema:
 * `AssetPlatform` (Phase 1.5+, used by content assets, ranking scores,
 * cadence targets — names LINE as `line_oa`) and Phase 1's `Platform`
 * (posts, metrics, comments, connected accounts — names it `line`). The
 * enums must never be merged (additive-only rule + Phase 1 data untouched),
 * so this map is the single sanctioned translation point.
 */
export const ASSET_TO_POST_PLATFORM: Record<AssetPlatform, Platform> = {
  [AssetPlatform.facebook]: Platform.facebook,
  [AssetPlatform.youtube]: Platform.youtube,
  [AssetPlatform.tiktok]: Platform.tiktok,
  [AssetPlatform.line_oa]: Platform.line,
};

export function toPostPlatform(assetPlatform: AssetPlatform): Platform {
  return ASSET_TO_POST_PLATFORM[assetPlatform];
}

/** Reverse of ASSET_TO_POST_PLATFORM (Platform → AssetPlatform). */
export const POST_TO_ASSET_PLATFORM: Record<Platform, AssetPlatform> = {
  [Platform.facebook]: AssetPlatform.facebook,
  [Platform.youtube]: AssetPlatform.youtube,
  [Platform.tiktok]: AssetPlatform.tiktok,
  [Platform.line]: AssetPlatform.line_oa,
};

export function toAssetPlatform(postPlatform: Platform): AssetPlatform {
  return POST_TO_ASSET_PLATFORM[postPlatform];
}

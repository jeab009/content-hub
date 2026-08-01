import type {
  AdCampaignStatus,
  AdChannel,
  AspectRatio,
  AssetPlatform,
  CadencePaceStatus,
  CommerceChannel,
  CommercePlacementStatus,
  ContentPillar,
  ContentStatus,
  ContentType,
  CopyrightClearance,
  EngineVersion,
  LicensingStatus,
  MetricSource,
  PostPlatform,
  PostStatus,
  PublishMethod,
} from '@/lib/api-client';

export const CONTENT_TYPES: ContentType[] = ['video', 'image', 'text'];
export const CONTENT_PILLARS: ContentPillar[] = ['product', 'drama', 'comedy'];
export const LICENSING_STATUSES: LicensingStatus[] = [
  'unlicensed',
  'pending_review',
  'licensed',
  'exempt',
];
export const CONTENT_STATUSES: ContentStatus[] = ['draft', 'ready', 'archived'];
export const COPYRIGHT_CLEARANCES: CopyrightClearance[] = ['not_checked', 'cleared', 'blocked'];
export const ASSET_PLATFORMS: AssetPlatform[] = ['facebook', 'youtube', 'tiktok', 'line_oa'];
export const ASPECT_RATIOS: AspectRatio[] = ['ratio_1_1', 'ratio_4_5', 'ratio_9_16', 'ratio_16_9'];

const LICENSING_LABELS: Record<LicensingStatus, string> = {
  unlicensed: 'Unlicensed',
  pending_review: 'Pending review',
  licensed: 'Licensed',
  exempt: 'Exempt',
};

const PLATFORM_LABELS: Record<AssetPlatform, string> = {
  facebook: 'Facebook',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  line_oa: 'LINE OA',
};

const ASPECT_LABELS: Record<AspectRatio, string> = {
  ratio_1_1: '1:1 (Square)',
  ratio_4_5: '4:5 (Portrait)',
  ratio_9_16: '9:16 (Vertical)',
  ratio_16_9: '16:9 (Landscape)',
};

const CLEARANCE_LABELS: Record<CopyrightClearance, string> = {
  not_checked: 'Not checked',
  cleared: 'Cleared',
  blocked: 'Blocked',
};

const STATUS_BADGE: Record<ContentStatus, string> = {
  draft: 'bg-secondary',
  ready: 'bg-success',
  archived: 'bg-dark',
};

/** Copyright chip colour paired with text — colour alone never conveys state. */
const CLEARANCE_BADGE: Record<CopyrightClearance, string> = {
  not_checked: 'bg-secondary',
  cleared: 'bg-success',
  blocked: 'bg-danger',
};

/** Post target platform (Prisma `Platform`, distinct from AssetPlatform). */
const POST_PLATFORM_LABELS: Record<PostPlatform, string> = {
  facebook: 'Facebook',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  line: 'LINE OA',
};

/** How a post reached the platform (Prisma `PublishMethod`, Phase 5). */
const PUBLISH_METHOD_LABELS: Record<PublishMethod, string> = {
  adapter: 'Dispatched',
  manual_external: 'Recorded manually',
};

/** Publish-method chip colour paired with PUBLISH_METHOD_LABELS — never colour alone. */
const PUBLISH_METHOD_BADGE: Record<PublishMethod, string> = {
  adapter: 'bg-info text-dark',
  manual_external: 'bg-secondary',
};

/** Engine badge (v1/v2) so the admin knows which ranking engine produced a score. */
const ENGINE_VERSION_LABELS: Record<EngineVersion, string> = {
  v1: 'Engine v1 · 4 factors',
  v2: 'Engine v2 · 5 factors',
};

const POST_STATUS_LABELS: Record<PostStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  posted: 'Posted',
  posted_unconfirmed: 'Posted (unconfirmed)',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const POST_STATUS_BADGE: Record<PostStatus, string> = {
  draft: 'bg-secondary',
  scheduled: 'bg-info',
  posted: 'bg-success',
  posted_unconfirmed: 'bg-warning text-dark',
  failed: 'bg-danger',
  cancelled: 'bg-dark',
};

const PACE_LABELS: Record<CadencePaceStatus, string> = {
  on_pace: 'On pace',
  under_target: 'Under target',
  target_met: 'Target met',
};

/** Pace chip colour paired with the PACE_LABELS text — colour never alone. */
const PACE_BADGE: Record<CadencePaceStatus, string> = {
  on_pace: 'bg-success',
  under_target: 'bg-warning text-dark',
  target_met: 'bg-primary',
};

const METRIC_SOURCE_LABELS: Record<MetricSource, string> = {
  api: 'API',
  manual: 'Manual',
};

// --- Commerce / Affiliate (Phase 6). CommerceChannel is a NEW enum, distinct
// from AssetPlatform/PostPlatform — never merged into those maps (ADR-6.2). ---

export const COMMERCE_CHANNELS: CommerceChannel[] = ['shopee', 'tiktok_shop'];

const CHANNEL_LABELS: Record<CommerceChannel, string> = {
  shopee: 'Shopee',
  tiktok_shop: 'TikTok Shop',
};

/** Colour PAIRED with text — colour is never the sole channel for channel identity. */
const CHANNEL_BADGE: Record<CommerceChannel, string> = {
  shopee: 'bg-warning text-dark',
  tiktok_shop: 'bg-dark',
};

const PLACEMENT_STATUS_LABELS: Record<CommercePlacementStatus, string> = {
  recorded: 'Recorded',
  removed: 'Removed',
};

const PLACEMENT_STATUS_BADGE: Record<CommercePlacementStatus, string> = {
  recorded: 'bg-success',
  removed: 'bg-secondary',
};

// --- Paid / Ads (Phase 7). AdChannel is a NEW enum, distinct from
// AssetPlatform/PostPlatform/CommerceChannel — never merged into those maps
// (design §1.1/Decision 3: Meta-only, no generic multi-channel abstraction). ---

export const PAID_CHANNELS: AdChannel[] = ['meta'];

const AD_CHANNEL_LABELS: Record<AdChannel, string> = { meta: 'Meta' };

/** bg-primary's default white text already clears contrast — no text-dark pairing needed
 * (global_config §2.2's forced-pairing rule applies only to warning/info). */
const AD_CHANNEL_BADGE: Record<AdChannel, string> = { meta: 'bg-primary' };

export const CAMPAIGN_STATUSES: AdCampaignStatus[] = ['active', 'paused', 'ended'];

const CAMPAIGN_STATUS_LABELS: Record<AdCampaignStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  ended: 'Ended',
};

/** Mirrors the existing PostStatus pattern: live=success, caution=warning+dark, archived=dark. */
const CAMPAIGN_STATUS_BADGE: Record<AdCampaignStatus, string> = {
  active: 'bg-success',
  paused: 'bg-warning text-dark',
  ended: 'bg-dark',
};

/** THB currency, 2 dp (revenue = platform payout, makedown.md §6). */
export function formatTHB(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Compact integer with thousands separators (reach/engagement counts). */
export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

/** Humanizes a ranking factor name (e.g. `engagement_history`). */
function humanizeFactor(value: string): string {
  return value
    .split('_')
    .map((part) => titleCase(part))
    .join(' ');
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export const labels = {
  licensing: (value: LicensingStatus): string => LICENSING_LABELS[value],
  platform: (value: AssetPlatform): string => PLATFORM_LABELS[value],
  aspect: (value: AspectRatio): string => ASPECT_LABELS[value],
  clearance: (value: CopyrightClearance): string => CLEARANCE_LABELS[value],
  type: (value: ContentType): string => titleCase(value),
  pillar: (value: ContentPillar): string => titleCase(value),
  status: (value: ContentStatus): string => titleCase(value),
  statusBadgeClass: (value: ContentStatus): string => STATUS_BADGE[value],
  clearanceBadgeClass: (value: CopyrightClearance): string => CLEARANCE_BADGE[value],
  postPlatform: (value: PostPlatform): string => POST_PLATFORM_LABELS[value],
  postStatus: (value: PostStatus): string => POST_STATUS_LABELS[value],
  postStatusBadgeClass: (value: PostStatus): string => POST_STATUS_BADGE[value],
  pace: (value: CadencePaceStatus): string => PACE_LABELS[value],
  paceBadgeClass: (value: CadencePaceStatus): string => PACE_BADGE[value],
  factor: (value: string): string => humanizeFactor(value),
  metricSource: (value: MetricSource): string => METRIC_SOURCE_LABELS[value],
  publishMethod: (value: PublishMethod): string => PUBLISH_METHOD_LABELS[value],
  publishMethodBadgeClass: (value: PublishMethod): string => PUBLISH_METHOD_BADGE[value],
  /** Falls back to the raw string for an engine version this build predates. */
  engineVersion: (value: string): string =>
    ENGINE_VERSION_LABELS[value as EngineVersion] ?? `Engine ${value}`,
  channel: (value: CommerceChannel): string => CHANNEL_LABELS[value],
  channelBadgeClass: (value: CommerceChannel): string => CHANNEL_BADGE[value],
  placementStatus: (value: CommercePlacementStatus): string => PLACEMENT_STATUS_LABELS[value],
  placementStatusBadgeClass: (value: CommercePlacementStatus): string =>
    PLACEMENT_STATUS_BADGE[value],
  adChannel: (value: AdChannel): string => AD_CHANNEL_LABELS[value],
  adChannelBadgeClass: (value: AdChannel): string => AD_CHANNEL_BADGE[value],
  campaignStatus: (value: AdCampaignStatus): string => CAMPAIGN_STATUS_LABELS[value],
  campaignStatusBadgeClass: (value: AdCampaignStatus): string => CAMPAIGN_STATUS_BADGE[value],
};

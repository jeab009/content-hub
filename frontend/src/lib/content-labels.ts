import type {
  AspectRatio,
  AssetPlatform,
  CadencePaceStatus,
  ContentPillar,
  ContentStatus,
  ContentType,
  CopyrightClearance,
  LicensingStatus,
  PostPlatform,
  PostStatus,
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
  tiktok: 'TikTok (Phase 5)',
  line_oa: 'LINE OA (Phase 5)',
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
  tiktok: 'TikTok (Phase 5)',
  line: 'LINE OA (Phase 5)',
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
};

import type {
  AspectRatio,
  AssetPlatform,
  ContentPillar,
  ContentStatus,
  ContentType,
  CopyrightClearance,
  LicensingStatus,
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
};

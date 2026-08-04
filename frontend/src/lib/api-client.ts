/**
 * Thin fetch wrapper for the Content Hub backend. Always sends cookies
 * (`credentials: 'include'`) so the session cookie round-trips on every
 * call, and attaches the CSRF header (fetched separately via getCsrfToken)
 * on any mutating request — the backend's CsrfGuard rejects mutations
 * without it.
 */
import { buildCommentQuery } from '@/lib/comment-logic';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH';
  body?: unknown;
  csrfToken?: string;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const isFormData = options.body instanceof FormData;
  // For multipart uploads we must NOT set Content-Type — the browser sets it
  // together with the multipart boundary. JSON bodies keep the explicit header.
  if (options.body !== undefined && !isFormData) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.csrfToken) {
    headers['x-csrf-token'] = options.csrfToken;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers,
    body:
      options.body === undefined
        ? undefined
        : isFormData
          ? (options.body as FormData)
          : JSON.stringify(options.body),
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = await response.json().catch(() => undefined);

  if (!response.ok) {
    const message =
      (payload && typeof payload === 'object' && 'message' in payload && String(payload.message)) ||
      `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status);
  }

  return payload as T;
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
}

export interface ConnectedAccount {
  id: string;
  platform: 'facebook' | 'youtube' | 'tiktok' | 'line';
  platformAccountId: string;
  platformAccountName: string;
  status: 'connected' | 'disconnected' | 'expired' | 'revoked';
  scopes: string[];
  tokenExpiresAt: string;
  connectedAt: string;
  disconnectedAt: string | null;
}

// --- Content (CMS) domain types. String unions mirror the backend Prisma
// enums exactly (see backend/prisma/schema.prisma) — keep them in sync.

export type ContentType = 'video' | 'image' | 'text';
export type ContentStatus = 'draft' | 'ready' | 'archived';
export type LicensingStatus = 'unlicensed' | 'pending_review' | 'licensed' | 'exempt';
export type ContentPillar = 'product' | 'drama' | 'comedy';
export type CopyrightClearance = 'not_checked' | 'cleared' | 'blocked';
export type AssetPlatform = 'facebook' | 'youtube' | 'tiktok' | 'line_oa';
export type AspectRatio = 'ratio_1_1' | 'ratio_4_5' | 'ratio_9_16' | 'ratio_16_9';

export interface Content {
  id: string;
  type: ContentType;
  title: string;
  mediaUrl: string;
  caption: string | null;
  targetAgeMin: number;
  targetAgeMax: number;
  status: ContentStatus;
  licensingStatus: LicensingStatus;
  licenseNotes: string | null;
  licenseExpiresAt: string | null;
  // BigInt is stringified by the backend response DTO — keep it a string here.
  fileSizeBytes: string | null;
  mimeType: string | null;
  contentPillar: ContentPillar | null;
  copyrightCleared: CopyrightClearance;
  copyrightNotes: string | null;
  copyrightEvidenceUrl: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentAsset {
  id: string;
  contentId: string;
  platform: AssetPlatform;
  aspectRatio: AspectRatio;
  mediaUrl: string;
  /**
   * Best-effort MP4 duration (Phase 6 / WBS 6A.6) — null for images and any
   * video whose duration could not be parsed. COURTESY ONLY: the Shopee
   * placement boundary re-validates fail-closed server-side rather than
   * trusting this value.
   */
  durationSeconds: number | null;
  createdAt: string;
}

export interface UploadResult {
  mediaUrl: string;
  fileSizeBytes: number;
  mimeType: string;
  /** Best-effort MP4 duration, courtesy only — see ContentAsset.durationSeconds. */
  durationSeconds: number | null;
}

/** Only the params the backend list query DTO accepts — anything else 400s. */
export interface ListContentQuery {
  type?: ContentType;
  status?: ContentStatus;
  licensingStatus?: LicensingStatus;
  ageBand?: number;
  search?: string;
}

export interface CreateContentInput {
  type: ContentType;
  title: string;
  mediaUrl: string;
  caption?: string;
  targetAgeMin: number;
  targetAgeMax: number;
  licensingStatus: LicensingStatus;
  licenseNotes?: string;
  licenseExpiresAt?: string;
  markReady?: boolean;
  contentPillar?: ContentPillar;
  copyrightCleared?: CopyrightClearance;
  copyrightNotes?: string;
  copyrightEvidenceUrl?: string;
  fileSizeBytes?: number;
  mimeType?: string;
}

export type UpdateContentInput = Partial<{
  type: ContentType;
  title: string;
  caption: string;
  targetAgeMin: number;
  targetAgeMax: number;
  status: ContentStatus;
  licensingStatus: LicensingStatus;
  licenseNotes: string;
  licenseExpiresAt: string;
  contentPillar: ContentPillar;
  copyrightCleared: CopyrightClearance;
  copyrightNotes: string;
  copyrightEvidenceUrl: string;
}>;

export interface CreateContentAssetInput {
  platform: AssetPlatform;
  aspectRatio: AspectRatio;
  mediaUrl: string;
  /** Carried over verbatim from the upload response for this same file (courtesy only). */
  durationSeconds?: number;
}

// --- Ranking / Scheduler / Publish domain types (Pass C2). String unions
// mirror the backend Prisma enums exactly — keep them in sync.

/** Publish target enum on a Post row (Prisma `Platform`, note `line` not `line_oa`). */
export type PostPlatform = 'facebook' | 'youtube' | 'tiktok' | 'line';
export type PostStatus =
  | 'draft'
  | 'scheduled'
  | 'posted'
  | 'posted_unconfirmed'
  | 'failed'
  | 'cancelled';
export type CadencePaceStatus = 'on_pace' | 'under_target' | 'target_met';
export type CadencePeriodUnit = 'week' | 'month';

/**
 * One explainable factor of a ranking score — this is what makes the
 * recommendation auditable. `contribution = weight * value`; `input` carries
 * the raw numbers the value was derived from so the UI can render "why".
 */
export interface RankingFactor {
  name: string;
  input: Record<string, string | number | boolean | null>;
  weight: number;
  value: number;
  contribution: number;
}

/** Contents of `ranking_scores.reasoning` (jsonb) — the explainability payload. */
export interface RankingReasoning {
  engineVersion: string;
  factors: RankingFactor[];
  total: number;
}

/** Which engine produced a score. Mirrors Prisma `EngineVersion`. */
export type EngineVersion = 'v1' | 'v2';

/**
 * The `input` payload of the v2-only `override_feedback` factor (Phase 5A.5).
 * Every field is optional here because `input` is jsonb typed loosely on the
 * wire and the factor emits two shapes: the full computed set, and a reduced
 * NEUTRAL set when the sample is too small (`neutral: true` plus a `reason`
 * of `below_min_sample_size` or `content_has_no_pillar`).
 *
 * The raw counts are the point of the factor — they are what makes the
 * admin's own past override behaviour arguable rather than a black box.
 */
export interface OverrideFeedbackInput {
  pillar?: string;
  platform?: string;
  sampleSize?: number;
  recommendedCount?: number;
  overriddenAwayCount?: number;
  selectedAsOverrideCount?: number;
  lookbackDays?: number;
  minSampleSize?: number;
  awayRate?: number;
  towardRate?: number;
  normalizer?: number;
  neutral?: boolean;
  reason?: string;
}

export interface RankingScore {
  id: string;
  contentId: string;
  platform: AssetPlatform;
  score: number;
  reasoning: RankingReasoning | null;
  engineVersion: string;
  computedAt: string;
}

export interface CadenceOverviewItem {
  platform: AssetPlatform;
  targetPostsPerPeriod: number;
  periodUnit: CadencePeriodUnit;
  periodStart: string;
  periodEnd: string;
  publishedThisPeriod: number;
  remaining: number;
  status: CadencePaceStatus;
}

export interface ReadyContentScore {
  id: string;
  platform: AssetPlatform;
  score: number;
  computedAt: string;
}

export interface ReadyContentOverview {
  contentId: string;
  title: string;
  type: ContentType;
  contentPillar: ContentPillar | null;
  createdAt: string;
  latestScores: ReadyContentScore[];
  recommendedPlatform: AssetPlatform | null;
}

export interface SchedulerOverview {
  generatedAt: string;
  cadence: CadenceOverviewItem[];
  readyContents: ReadyContentOverview[];
}

/**
 * How a post reached the platform (Prisma `PublishMethod`, Phase 5A):
 * `adapter` = dispatched by Content Hub, `manual_external` = the admin posted
 * natively and recorded it here.
 */
export type PublishMethod = 'adapter' | 'manual_external';

export interface Post {
  id: string;
  contentId: string;
  platform: PostPlatform;
  status: PostStatus;
  selectedPlatform: AssetPlatform | null;
  recommendedPlatform: AssetPlatform | null;
  wasOverride: boolean;
  overrideReason: string | null;
  rankingScoreId: string | null;
  priorityScore: number | null;
  externalPostId: string | null;
  externalPostUrl: string | null;
  publishMethod: PublishMethod;
  executedBy: string | null;
  scheduledAt: string | null;
  postedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Body of POST /api/posts. Deliberately omits `wasOverride` and
 * `recommendedPlatform`: the backend recomputes both server-side and rejects
 * (400) any request that tries to smuggle them in.
 */
export interface CreatePostInput {
  contentId: string;
  platform: AssetPlatform;
  password: string;
  overrideReason?: string;
}

/**
 * Body of POST /api/posts/manual-external (Phase 5A.3) — the admin already
 * published natively on the platform and is recording it here so the post
 * becomes a first-class tracked entity.
 *
 * Mirrors RecordManualExternalDto field-for-field. Like CreatePostInput it
 * deliberately omits `wasOverride`, `recommendedPlatform`, `status` and
 * `publishMethod`: the backend computes all four server-side, and its
 * ValidationPipe (forbidNonWhitelisted) 400s any request carrying them —
 * ranking v2's override_feedback factor learns from these rows, so a
 * client-supplied override fact would be a way to quietly train the engine.
 *
 * `externalPostUrl` is optional because not every platform has a permalink:
 * a LINE OA broadcast has a message id but no addressable public URL.
 */
export interface RecordManualExternalInput {
  contentId: string;
  platform: AssetPlatform;
  externalPostId: string;
  externalPostUrl?: string;
  password: string;
  overrideReason?: string;
}

// --- Metrics + Dashboard domain types (Phase 3). String unions mirror the
// backend Prisma enums / DTOs exactly — keep them in sync.

export type MetricSource = 'api' | 'manual';

export interface Metric {
  id: string;
  postId: string;
  platform: PostPlatform;
  reach: number;
  engagement: number;
  revenue: number;
  source: MetricSource;
  collectedAt: string;
  createdAt: string;
}

export interface CreateManualMetricInput {
  reach: number;
  engagement: number;
  revenue: number;
  collectedAt?: string;
}

export type SyncOutcome = 'synced' | 'skipped' | 'failed';

export interface SyncItemResult {
  postId: string;
  platform: PostPlatform;
  outcome: SyncOutcome;
  reason?: string;
}

export interface SyncResult {
  ranAt: string;
  eligible: number;
  synced: number;
  skipped: number;
  failed: number;
  items: SyncItemResult[];
}

export interface PlatformBreakdownItem {
  platform: PostPlatform;
  reach: number;
  engagement: number;
  revenue: number;
  posts: number;
}

export interface TrendPoint {
  date: string;
  reach: number;
  revenue: number;
}

export interface DashboardOverview {
  generatedAt: string;
  totals: {
    reach: number;
    engagement: number;
    revenue: number;
    postsWithMetrics: number;
    contentsWithMetrics: number;
  };
  byPlatform: PlatformBreakdownItem[];
  trend: TrendPoint[];
}

export interface RevenueByContentItem {
  contentId: string;
  title: string;
  type: ContentType;
  contentPillar: ContentPillar | null;
  reach: number;
  engagement: number;
  revenue: number;
  posts: number;
}

export interface DashboardRevenue {
  generatedAt: string;
  totalRevenue: number;
  byContent: RevenueByContentItem[];
  byPlatform: PlatformBreakdownItem[];
}

/**
 * One published post inside a content's revenue drill-down (Phase 5A.8).
 * Carries `publishMethod` + the external id/URL so a manually-recorded
 * TikTok/LINE post is visibly distinguishable from an adapter-published one.
 */
export interface RevenueByPostItem {
  postId: string;
  platform: PostPlatform;
  publishMethod: PublishMethod;
  externalPostId: string | null;
  externalPostUrl: string | null;
  postedAt: string | null;
  reach: number;
  engagement: number;
  revenue: number;
  metricSource: MetricSource | null;
  lastCollectedAt: string | null;
}

/** Matches ContentRevenueDrilldownDto — one content split by platform, post, and day. */
export interface ContentRevenueDrilldown {
  generatedAt: string;
  contentId: string;
  title: string;
  type: ContentType;
  contentPillar: ContentPillar | null;
  totalRevenue: number;
  totals: { reach: number; engagement: number; revenue: number; posts: number };
  byPlatform: PlatformBreakdownItem[];
  byPost: RevenueByPostItem[];
  trend: TrendPoint[];
}

// --- Reports (Phase 5A.6). CSV exports are admin-only GETs returning
// `text/csv` with Content-Disposition: attachment, and carry NO CSRF header
// (read-only convention, same as the dashboard reads). They are consumed as
// plain links rather than fetch+blob: the session cookie is SameSite=Lax, so
// a top-level navigation to the backend origin still carries it, and the
// browser handles the download natively. ---

/**
 * Only the filters ReportQueryDto accepts — anything else 400s. `channel` and
 * the commerce-flavoured `productId` are ONLY valid for `report: 'commerce'`
 * (CommerceReportQueryDto, a deliberately separate shape — see
 * commerce-report-query.dto.ts's docblock on why it doesn't import
 * ReportQueryDto across the commerce/reports ESLint zone).
 */
export interface ReportQuery {
  /** ISO-8601 date bounding the start of the reporting period. */
  from?: string;
  /** ISO-8601 date bounding the end of the reporting period. */
  to?: string;
  platform?: AssetPlatform;
  contentId?: string;
  /** commerce.csv only. */
  channel?: CommerceChannel;
  /** commerce.csv only (the payout reports key on contentId instead). */
  productId?: string;
  /** paid.csv only (PaidReportQueryDto — a deliberate small duplicate shape, not a shared import). */
  campaignId?: string;
}

export type ReportName = 'revenue' | 'override-log' | 'comment-summary' | 'commerce' | 'paid';

function buildReportQuery(query: ReportQuery = {}): string {
  const params = new URLSearchParams();
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.platform) params.set('platform', query.platform);
  if (query.contentId) params.set('contentId', query.contentId);
  if (query.channel) params.set('channel', query.channel);
  if (query.productId) params.set('productId', query.productId);
  if (query.campaignId) params.set('campaignId', query.campaignId);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// --- Commerce / Affiliate (Phase 6) domain types. String unions mirror the
// backend Prisma enums / DTOs exactly (backend/prisma/schema.prisma +
// backend/src/modules/commerce/dto/*) — keep them in sync.
//
// SEPARATION NOTE (design §2.5): these types intentionally share NO field
// name with the payout vocabulary (DashboardOverview/DashboardRevenue above)
// — `commissionAmount`/`grossSalesAmount` here, `revenue` there. No type here
// is ever named `revenue`, and no component may be handed both.

export type CommerceChannel = 'shopee' | 'tiktok_shop';
export type CommerceSource = 'manual' | 'api';
export type CommercePlacementStatus = 'recorded' | 'removed';

/** API shape of a commerce_products row. */
export interface CommerceProduct {
  id: string;
  channel: CommerceChannel;
  externalProductId: string;
  name: string;
  sku: string | null;
  productUrl: string | null;
  listPrice: number | null;
  currency: string;
  commissionRatePct: number | null;
  isActive: boolean;
  retiredAt: string | null;
  source: CommerceSource;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** API shape of an affiliate_links row. No `channel` — inherited from the product (ADR-6.6). */
export interface AffiliateLink {
  id: string;
  productId: string;
  url: string;
  trackingCode: string | null;
  subId: string | null;
  isActive: boolean;
  retiredAt: string | null;
  source: CommerceSource;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** API shape of a product_anchors row. Exactly one of postId/placementId is set. */
export interface ProductAnchor {
  id: string;
  postId: string | null;
  placementId: string | null;
  productId: string;
  affiliateLinkId: string | null;
  anchorPosition: number | null;
  anchoredAt: string;
  removedAt: string | null;
  source: CommerceSource;
  recordedBy: string;
  createdAt: string;
}

/** API shape of a commerce_placements row (a recorded Shopee video). */
export interface CommercePlacement {
  id: string;
  contentId: string;
  channel: CommerceChannel;
  externalMediaId: string;
  externalUrl: string | null;
  status: CommercePlacementStatus;
  publishMethod: PublishMethod;
  sourceAssetId: string | null;
  mediaUrl: string | null;
  durationSeconds: number | null;
  note: string | null;
  version: number;
  source: CommerceSource;
  recordedBy: string;
  placedAt: string;
  removedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** API shape of a commerce_conversions row — one append-only commission entry. */
export interface CommerceConversion {
  id: string;
  channel: CommerceChannel;
  periodStart: string;
  periodEnd: string;
  ordersCount: number | null;
  itemsSold: number | null;
  grossSalesAmount: number | null;
  commissionAmount: number;
  currency: string;
  postId: string | null;
  placementId: string | null;
  productId: string | null;
  affiliateLinkId: string | null;
  statementRef: string | null;
  reversalOfId: string | null;
  source: CommerceSource;
  recordedBy: string;
  createdAt: string;
}

/** One currency's aggregate (System Analyst SA-9 — NEVER summed across currencies). */
export interface CommerceCurrencyTotal {
  currency: string;
  commissionAmount: number;
  grossSalesAmount: number;
  ordersCount: number;
  itemsSold: number;
  conversionRecords: number;
}

export interface CommerceChannelBreakdownItem extends CommerceCurrencyTotal {
  channel: CommerceChannel;
}

/** `productId: null` buckets every unattributed conversion — a normal, expected case. */
export interface CommerceProductBreakdownItem extends CommerceCurrencyTotal {
  productId: string | null;
}

export interface CommercePeriodBreakdownItem extends CommerceCurrencyTotal {
  periodStart: string;
  periodEnd: string;
}

/** Matches CommerceSummaryDto — GET /api/commerce/summary. Reads commerce_conversions ONLY. */
export interface CommerceSummary {
  generatedAt: string;
  totals: CommerceCurrencyTotal[];
  byChannel: CommerceChannelBreakdownItem[];
  byProduct: CommerceProductBreakdownItem[];
  byPeriod: CommercePeriodBreakdownItem[];
}

/** Matches ContentCommerceSummaryDto — GET /api/commerce/summary/:contentId. */
export interface ContentCommerceSummary {
  generatedAt: string;
  contentId: string;
  totals: CommerceCurrencyTotal[];
  placements: CommercePlacement[];
  conversions: CommerceConversion[];
}

/** Only the params ListProductsQueryDto accepts — anything else 400s. */
export interface ListCommerceProductsQuery {
  channel?: CommerceChannel;
  isActive?: boolean;
  q?: string;
}

/** Body of POST /api/commerce/products. */
export interface CreateCommerceProductInput {
  channel: CommerceChannel;
  externalProductId: string;
  name: string;
  sku?: string;
  productUrl?: string;
  listPrice?: number;
  currency?: string;
  commissionRatePct?: number;
}

/** Body of PATCH /api/commerce/products/:id — channel/externalProductId are NOT editable. */
export type UpdateCommerceProductInput = Partial<{
  name: string;
  sku: string;
  productUrl: string;
  listPrice: number;
  currency: string;
  commissionRatePct: number;
}>;

/** Body of POST /api/commerce/products/:id/links — no `channel`, it is inherited. */
export interface CreateAffiliateLinkInput {
  url: string;
  trackingCode?: string;
  subId?: string;
}

/**
 * One product to anchor, paired with the affiliate link that earned the
 * attribution. Object form (matches RecordProductAnchorsDto / AnchorItemDto)
 * — NOT two parallel arrays, so there is no index-alignment class of bug.
 */
export interface AnchorItemInput {
  productId: string;
  affiliateLinkId?: string;
}

/** Body of POST /api/posts/:id/product-anchors and the placement equivalent. */
export interface RecordProductAnchorsInput {
  anchors: AnchorItemInput[];
}

/**
 * Body of POST /api/commerce/placements/manual-external. Mirrors
 * RecordCommercePlacementDto field-for-field — note `externalMediaId`
 * (NOT `externalPostId`, which 400s: this DTO is Shopee-shaped, not the
 * publish module's post DTO).
 */
export interface RecordCommercePlacementInput {
  contentId: string;
  channel: CommerceChannel;
  externalMediaId: string;
  externalUrl?: string;
  durationSeconds?: number;
  sourceAssetId?: string;
  password: string;
  note?: string;
}

/** Only the params ListPlacementsQueryDto accepts. */
export interface ListCommercePlacementsQuery {
  channel?: CommerceChannel;
  status?: CommercePlacementStatus;
  contentId?: string;
}

/** Body of POST /api/commerce/conversions — APPEND-ONLY. Reversals are new negative rows. */
export interface CreateCommerceConversionInput {
  channel: CommerceChannel;
  periodStart: string;
  periodEnd: string;
  ordersCount?: number;
  itemsSold?: number;
  grossSalesAmount?: number;
  /** NEGATIVE IS LEGAL — a refund/reversal is a new row, never an edit. */
  commissionAmount: number;
  postId?: string;
  placementId?: string;
  productId?: string;
  affiliateLinkId?: string;
  reversalOfId?: string;
  statementRef?: string;
}

/** Only the params ListConversionsQueryDto accepts. */
export interface ListCommerceConversionsQuery {
  channel?: CommerceChannel;
  productId?: string;
  placementId?: string;
  postId?: string;
}

/** Query for GET /api/commerce/conversions/overlap-check — WARN-ONLY probe. */
export interface OverlapCheckQuery {
  channel: CommerceChannel;
  periodStart: string;
  periodEnd: string;
}

/** Query filters for GET /api/commerce/summary. */
export interface CommerceSummaryQuery {
  channel?: CommerceChannel;
  productId?: string;
  periodStart?: string;
  periodEnd?: string;
}

function buildCommerceProductsQuery(query: ListCommerceProductsQuery = {}): string {
  const params = new URLSearchParams();
  if (query.channel) params.set('channel', query.channel);
  if (query.isActive !== undefined) params.set('isActive', String(query.isActive));
  if (query.q) params.set('q', query.q);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function buildCommercePlacementsQuery(query: ListCommercePlacementsQuery = {}): string {
  const params = new URLSearchParams();
  if (query.channel) params.set('channel', query.channel);
  if (query.status) params.set('status', query.status);
  if (query.contentId) params.set('contentId', query.contentId);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function buildCommerceConversionsQuery(query: ListCommerceConversionsQuery = {}): string {
  const params = new URLSearchParams();
  if (query.channel) params.set('channel', query.channel);
  if (query.productId) params.set('productId', query.productId);
  if (query.placementId) params.set('placementId', query.placementId);
  if (query.postId) params.set('postId', query.postId);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function buildCommerceSummaryQuery(query: CommerceSummaryQuery = {}): string {
  const params = new URLSearchParams();
  if (query.channel) params.set('channel', query.channel);
  if (query.productId) params.set('productId', query.productId);
  if (query.periodStart) params.set('periodStart', query.periodStart);
  if (query.periodEnd) params.set('periodEnd', query.periodEnd);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// --- Paid / Ads visibility (Phase 7) domain types. String unions mirror the
// backend Prisma enums / DTOs exactly (backend/prisma/schema.prisma +
// backend/src/modules/paid/dto/*) — keep them in sync.
//
// SEPARATION NOTE (design §2.5, System Analyst SA-P-B): these types share NO
// field name with the payout vocabulary (DashboardOverview/DashboardRevenue)
// or the commerce vocabulary (CommerceSummary/CommerceCurrencyTotal) —
// `totalSpend`/`totalReach`/`entriesCount` here, `revenue` there,
// `commissionAmount`/`grossSalesAmount` there. No key here is ever named
// `revenue` or `commissionAmount`, and no component may be handed more than
// one of the three summary types.

export type AdChannel = 'meta';
export type AdCampaignStatus = 'active' | 'paused' | 'ended';
export type AdSource = 'manual' | 'api';

/** API shape of an ad_campaigns row. */
export interface AdCampaign {
  id: string;
  channel: AdChannel;
  externalCampaignName: string;
  externalCampaignId: string | null;
  objective: string;
  contentId: string | null;
  startDate: string;
  endDate: string | null;
  plannedBudget: number | null;
  currency: string;
  status: AdCampaignStatus;
  isActive: boolean;
  retiredAt: string | null;
  source: AdSource;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** API shape of an ad_performance_entries row — one append-only entry. */
export interface AdPerformanceEntry {
  id: string;
  campaignId: string;
  spend: number;
  reach: number | null;
  impressions: number | null;
  clicks: number | null;
  resultType: string | null;
  resultCount: number | null;
  currency: string;
  periodStart: string;
  periodEnd: string;
  sourceRef: string | null;
  correctsEntryId: string | null;
  source: AdSource;
  recordedBy: string;
  createdAt: string;
}

/** One currency's aggregate — NEVER summed across currencies (SA-P6/NFR-7.10, mirrors CommerceCurrencyTotal). */
export interface PaidCurrencyTotal {
  currency: string;
  totalSpend: number;
  totalReach: number;
  totalImpressions: number;
  totalClicks: number;
  totalResultCount: number;
  entriesCount: number;
}

export interface PaidCampaignBreakdownItem extends PaidCurrencyTotal {
  campaignId: string;
}

/** `resultType: null` buckets every entry logged with no result label yet — a normal, expected case. */
export interface PaidResultTypeBreakdownItem extends PaidCurrencyTotal {
  resultType: string | null;
}

/** Matches PaidSummaryDto — GET /api/paid/summary. Reads ad_* tables ONLY. */
export interface PaidSummary {
  generatedAt: string;
  totals: PaidCurrencyTotal[];
  byCampaign: PaidCampaignBreakdownItem[];
  byResultType: PaidResultTypeBreakdownItem[];
}

/** Only the params ListPaidCampaignsQueryDto accepts — anything else 400s. */
export interface ListPaidCampaignsQuery {
  isActive?: boolean;
  q?: string;
  contentId?: string;
}

/** Body of POST /api/paid/campaigns. `channel` is always `meta` this phase (Decision 3). */
export interface CreatePaidCampaignInput {
  channel: AdChannel;
  externalCampaignName: string;
  externalCampaignId?: string;
  objective: string;
  contentId?: string;
  startDate: string;
  endDate?: string;
  plannedBudget?: number;
  currency?: string;
  status?: AdCampaignStatus;
}

/** Body of PATCH /api/paid/campaigns/:id — channel/externalCampaignId are NOT editable (identity fields). */
export type UpdatePaidCampaignInput = Partial<{
  externalCampaignName: string;
  objective: string;
  contentId: string;
  startDate: string;
  endDate: string;
  plannedBudget: number;
  currency: string;
  status: AdCampaignStatus;
}>;

/**
 * Body of POST /api/paid/campaigns/:id/performance-entries — APPEND-ONLY.
 * `spend` is NEVER negative — a correction is always a NEW row naming the row
 * it corrects via `correctsEntryId`, never a reversal/negative-amount
 * mechanic (System Analyst SA-P2, distinct from Commerce's conventions).
 */
export interface CreatePerformanceEntryInput {
  periodStart: string;
  periodEnd: string;
  spend: number;
  reach?: number;
  impressions?: number;
  clicks?: number;
  resultType?: string;
  resultCount?: number;
  currency?: string;
  correctsEntryId?: string;
  sourceRef?: string;
}

/** Query for GET /api/paid/campaigns/:id/performance-entries/overlap-check — WARN-ONLY probe. */
export interface PerformanceOverlapCheckQuery {
  periodStart: string;
  periodEnd: string;
}

/** Query filters for GET /api/paid/summary. */
export interface PaidSummaryQuery {
  campaignId?: string;
  contentId?: string;
  periodStart?: string;
  periodEnd?: string;
}

function buildPaidCampaignsQuery(query: ListPaidCampaignsQuery = {}): string {
  const params = new URLSearchParams();
  if (query.isActive !== undefined) params.set('isActive', String(query.isActive));
  if (query.q) params.set('q', query.q);
  if (query.contentId) params.set('contentId', query.contentId);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function buildPaidSummaryQuery(query: PaidSummaryQuery = {}): string {
  const params = new URLSearchParams();
  if (query.campaignId) params.set('campaignId', query.campaignId);
  if (query.contentId) params.set('contentId', query.contentId);
  if (query.periodStart) params.set('periodStart', query.periodStart);
  if (query.periodEnd) params.set('periodEnd', query.periodEnd);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// --- Comments (Phase 4) domain types. String unions mirror the backend
// Prisma enums / DTOs exactly (backend/prisma/schema.prisma + the comments
// module DTOs) — keep them in sync. A Comment.platform is a Prisma `Platform`,
// so it reuses PostPlatform.

export type CommentSentiment = 'positive' | 'negative' | 'neutral';
export type CommentPriority = 'complaint' | 'question' | 'spam' | 'general';
export type SentimentSource = 'rule_based' | 'model';

/** Inbox row — matches CommentResponseDto. `slaBreach` is computed server-side. */
export interface Comment {
  id: string;
  postId: string;
  platform: PostPlatform;
  author: string;
  text: string;
  sentiment: CommentSentiment | null;
  sentimentSource: SentimentSource | null;
  priority: CommentPriority | null;
  slaDueAt: string | null;
  slaBreach: boolean;
  replyable: boolean;
  repliedAt: string | null;
  replyText: string | null;
  collectedAt: string;
}

/** Matches PaginatedCommentsDto. */
export interface PaginatedComments {
  items: Comment[];
  page: number;
  pageSize: number;
  total: number;
}

/** Only the params the backend ListCommentsQueryDto accepts — anything else 400s. */
export interface ListCommentsQuery {
  platform?: PostPlatform;
  sentiment?: CommentSentiment;
  priority?: CommentPriority;
  slaBreach?: boolean;
  replied?: boolean;
  page?: number;
  pageSize?: number;
}

export interface CommentSyncItemResult {
  postId: string;
  platform: PostPlatform;
  outcome: SyncOutcome;
  inserted?: number;
  reason?: string;
}

/** Matches CommentSyncResultDto — `inserted` = new rows across the batch. */
export interface CommentSyncResult {
  ranAt: string;
  eligible: number;
  synced: number;
  skipped: number;
  failed: number;
  inserted: number;
  items: CommentSyncItemResult[];
}

/** Matches EscalationAlertResponseDto — the negative-spike alert surface. */
export interface EscalationAlert {
  id: string;
  ruleKey: string;
  windowStart: string;
  windowEnd: string;
  negativeCount: number;
  threshold: number;
  raisedAt: string;
  acknowledgedAt: string | null;
}

/** Matches CommentTemplateResponseDto — a canned reply for the composer picker. */
export interface CommentTemplate {
  id: string;
  title: string;
  body: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Reply body — matches ReplyCommentDto (`password` = step-up re-auth). */
export interface ReplyCommentInput {
  message: string;
  password: string;
}

function buildContentQuery(query: ListContentQuery = {}): string {
  const params = new URLSearchParams();
  if (query.type) params.set('type', query.type);
  if (query.status) params.set('status', query.status);
  if (query.licensingStatus) params.set('licensingStatus', query.licensingStatus);
  if (query.ageBand !== undefined) params.set('ageBand', String(query.ageBand));
  if (query.search) params.set('search', query.search);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const apiClient = {
  login: (email: string, password: string) =>
    request<{ success: true; user: CurrentUser }>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    }),

  logout: (csrfToken: string) =>
    request<void>('/api/auth/logout', { method: 'POST', csrfToken }),

  me: () => request<CurrentUser>('/api/auth/me'),

  getCsrfToken: () => request<{ csrfToken: string }>('/api/auth/csrf'),

  listConnectedAccounts: () => request<ConnectedAccount[]>('/api/connected-accounts'),

  facebookAuthorizeUrl: () => `${API_BASE_URL}/api/connected-accounts/facebook/authorize`,

  googleAuthorizeUrl: () => `${API_BASE_URL}/api/connected-accounts/google/authorize`,

  disconnectAccount: (id: string, csrfToken: string) =>
    request<void>(`/api/connected-accounts/${id}`, { method: 'DELETE', csrfToken }),

  // --- Content (CMS) endpoints ---

  /** Absolute URL for a stored media path (e.g. `/uploads/…`) for previews. */
  mediaSrc: (path: string) => (path.startsWith('http') ? path : `${API_BASE_URL}${path}`),

  listContents: (query?: ListContentQuery) =>
    request<Content[]>(`/api/contents${buildContentQuery(query)}`),

  getContent: (id: string) => request<Content>(`/api/contents/${id}`),

  createContent: (body: CreateContentInput, csrfToken: string) =>
    request<Content>('/api/contents', { method: 'POST', body, csrfToken }),

  updateContent: (id: string, body: UpdateContentInput, csrfToken: string) =>
    request<Content>(`/api/contents/${id}`, { method: 'PATCH', body, csrfToken }),

  archiveContent: (id: string, csrfToken: string) =>
    request<void>(`/api/contents/${id}`, { method: 'DELETE', csrfToken }),

  /**
   * Uploads a single file via multipart/form-data (field name `file`). The
   * browser sets the Content-Type + boundary; we only add the CSRF header.
   */
  uploadMedia: (file: File, csrfToken: string) => {
    const form = new FormData();
    form.append('file', file);
    return request<UploadResult>('/api/contents/upload', {
      method: 'POST',
      body: form,
      csrfToken,
    });
  },

  listAssets: (contentId: string) =>
    request<ContentAsset[]>(`/api/contents/${contentId}/assets`),

  addAsset: (contentId: string, body: CreateContentAssetInput, csrfToken: string) =>
    request<ContentAsset>(`/api/contents/${contentId}/assets`, {
      method: 'POST',
      body,
      csrfToken,
    }),

  removeAsset: (contentId: string, assetId: string, csrfToken: string) =>
    request<void>(`/api/contents/${contentId}/assets/${assetId}`, {
      method: 'DELETE',
      csrfToken,
    }),

  // --- Ranking endpoints ---

  /** Recomputes scores for every ranked platform and returns the new rows. */
  rankContent: (contentId: string, csrfToken: string) =>
    request<RankingScore[]>(`/api/contents/${contentId}/rank`, {
      method: 'POST',
      csrfToken,
    }),

  /** Latest score per platform for a content (no recompute). */
  getScores: (contentId: string) =>
    request<RankingScore[]>(`/api/contents/${contentId}/scores`),

  // --- Scheduler endpoint ---

  getSchedulerOverview: () => request<SchedulerOverview>('/api/scheduler/overview'),

  // --- Publish endpoints (all mutations carry step-up password + CSRF) ---

  /** Create a publish intent AND dispatch it in one call. Never automatic. */
  createPost: (body: CreatePostInput, csrfToken: string) =>
    request<Post>('/api/posts', { method: 'POST', body, csrfToken }),

  /**
   * Record a post the admin already published natively on the platform
   * (Phase 5A.3 — the delivered TikTok/LINE OA path). 201 on success.
   *
   * Errors worth handling distinctly at the call site: 400 validation,
   * 401 wrong step-up password (retry in-modal), 403 not an admin,
   * 409 duplicate active post OR the content failed the copyright gate,
   * 429 throttled (5 attempts / 15 min, same limit as login).
   */
  recordManualExternalPost: (body: RecordManualExternalInput, csrfToken: string) =>
    request<Post>('/api/posts/manual-external', { method: 'POST', body, csrfToken }),

  /** Retry a draft/failed post (posted_unconfirmed is NOT retryable). */
  publishPost: (id: string, password: string, csrfToken: string) =>
    request<Post>(`/api/posts/${id}/publish`, {
      method: 'POST',
      body: { password },
      csrfToken,
    }),

  listPosts: (status?: PostStatus) =>
    request<Post[]>(`/api/posts${status ? `?status=${status}` : ''}`),

  /** Confirmed live on the platform — mark posted (externalPostId required). */
  resolvePosted: (id: string, externalPostId: string, csrfToken: string) =>
    request<Post>(`/api/posts/${id}/resolve-posted`, {
      method: 'POST',
      body: { externalPostId },
      csrfToken,
    }),

  /** Nothing found live — reopen the post for retry. */
  resolveNotPosted: (id: string, csrfToken: string) =>
    request<Post>(`/api/posts/${id}/resolve-not-posted`, {
      method: 'POST',
      csrfToken,
    }),

  // --- Metrics endpoints (Phase 3) ---

  /** Pull API-platform metrics for all live posts and append them. */
  syncMetrics: (csrfToken: string) =>
    request<SyncResult>('/api/metrics/sync', { method: 'POST', csrfToken }),

  /** Append a manual metric reading for a post (append-only). */
  addManualMetric: (postId: string, body: CreateManualMetricInput, csrfToken: string) =>
    request<Metric>(`/api/posts/${postId}/metrics`, { method: 'POST', body, csrfToken }),

  /** Full reading history for a post (oldest first). */
  listMetrics: (postId: string) => request<Metric[]>(`/api/posts/${postId}/metrics`),

  // --- Dashboard endpoints (Phase 3) ---

  getDashboardOverview: () => request<DashboardOverview>('/api/dashboard/overview'),

  getDashboardRevenue: () => request<DashboardRevenue>('/api/dashboard/revenue'),

  /** Per-content revenue drill-down (Phase 5A.8) — by platform, by post, by day. */
  getContentRevenue: (contentId: string) =>
    request<ContentRevenueDrilldown>(`/api/dashboard/revenue/${contentId}`),

  // --- Report export URLs (Phase 5A.6) ---

  /**
   * Absolute URL of a CSV report. Returned as a URL rather than fetched
   * because these are attachment downloads: rendering it as a link lets the
   * browser save the file with the server's filename, and the SameSite=Lax
   * session cookie rides along on the top-level navigation.
   */
  reportCsvUrl: (report: ReportName, query?: ReportQuery) =>
    `${API_BASE_URL}/api/reports/${report}.csv${buildReportQuery(query)}`,

  // --- Comments endpoints (Phase 4B). Reply + purge carry step-up password +
  // CSRF; sync + ack carry CSRF; list + templates + escalations are reads. ---

  /** Inbox list with filters + pagination (read-only). */
  listComments: (query?: ListCommentsQuery) =>
    request<PaginatedComments>(`/api/comments${buildCommentQuery(query)}`),

  /** Pull FB + YouTube comments, classify, triage, escalate. Returns the run summary. */
  syncComments: (csrfToken: string) =>
    request<CommentSyncResult>('/api/comments/sync', { method: 'POST', csrfToken }),

  /** Step-up reply to one comment (401 wrong password, 409 not replyable/already replied, 429 throttled). */
  replyComment: (id: string, body: ReplyCommentInput, csrfToken: string) =>
    request<Comment>(`/api/comments/${id}/reply`, { method: 'POST', body, csrfToken }),

  /** Active (unacknowledged) escalation alerts for the inbox banner. */
  listEscalations: (active = true) =>
    request<EscalationAlert[]>(`/api/comments/escalations?active=${active}`),

  /** Soft-dismiss an alert (does not delete — a deleted row would re-fire). */
  ackEscalation: (id: string, csrfToken: string) =>
    request<EscalationAlert>(`/api/comments/escalations/${id}/ack`, {
      method: 'POST',
      csrfToken,
    }),

  /** Canned reply templates for the composer picker (read-only here). */
  listCommentTemplates: () => request<CommentTemplate[]>('/api/comment-templates'),

  /** PDPA data-subject erasure — single-comment hard-delete (CSRF only, 204). */
  eraseComment: (id: string, csrfToken: string) =>
    request<void>(`/api/comments/${id}`, { method: 'DELETE', csrfToken }),

  // --- Commerce / Affiliate endpoints (Phase 6). No step-up except the
  // placement record route (SA-3: catalog/link/anchor/conversion maintenance
  // pushes nothing live and records no override fact). ---

  listCommerceProducts: (query?: ListCommerceProductsQuery) =>
    request<CommerceProduct[]>(`/api/commerce/products${buildCommerceProductsQuery(query)}`),

  createCommerceProduct: (body: CreateCommerceProductInput, csrfToken: string) =>
    request<CommerceProduct>('/api/commerce/products', { method: 'POST', body, csrfToken }),

  updateCommerceProduct: (id: string, body: UpdateCommerceProductInput, csrfToken: string) =>
    request<CommerceProduct>(`/api/commerce/products/${id}`, {
      method: 'PATCH',
      body,
      csrfToken,
    }),

  /** Soft-retire (isActive=false) — never a hard delete. */
  retireCommerceProduct: (id: string, csrfToken: string) =>
    request<CommerceProduct>(`/api/commerce/products/${id}/retire`, {
      method: 'POST',
      csrfToken,
    }),

  listAffiliateLinks: (productId: string) =>
    request<AffiliateLink[]>(`/api/commerce/products/${productId}/links`),

  createAffiliateLink: (productId: string, body: CreateAffiliateLinkInput, csrfToken: string) =>
    request<AffiliateLink>(`/api/commerce/products/${productId}/links`, {
      method: 'POST',
      body,
      csrfToken,
    }),

  /** Soft-retire a link — never a hard delete. */
  retireAffiliateLink: (id: string, csrfToken: string) =>
    request<AffiliateLink>(`/api/commerce/links/${id}/retire`, { method: 'POST', csrfToken }),

  // --- Product anchors — TWO hosts (a post, or a commerce placement). No
  // step-up (SA-3): anchoring records no override fact and pushes nothing
  // live. ---

  listPostProductAnchors: (postId: string) =>
    request<ProductAnchor[]>(`/api/posts/${postId}/product-anchors`),

  anchorProductsToPost: (postId: string, body: RecordProductAnchorsInput, csrfToken: string) =>
    request<ProductAnchor[]>(`/api/posts/${postId}/product-anchors`, {
      method: 'POST',
      body,
      csrfToken,
    }),

  /** Soft-removes (removedAt) — never deletes, so re-anchoring keeps history. */
  removePostProductAnchor: (postId: string, anchorId: string, csrfToken: string) =>
    request<void>(`/api/posts/${postId}/product-anchors/${anchorId}`, {
      method: 'DELETE',
      csrfToken,
    }),

  listPlacementProductAnchors: (placementId: string) =>
    request<ProductAnchor[]>(`/api/commerce/placements/${placementId}/product-anchors`),

  anchorProductsToPlacement: (
    placementId: string,
    body: RecordProductAnchorsInput,
    csrfToken: string,
  ) =>
    request<ProductAnchor[]>(`/api/commerce/placements/${placementId}/product-anchors`, {
      method: 'POST',
      body,
      csrfToken,
    }),

  removePlacementProductAnchor: (placementId: string, anchorId: string, csrfToken: string) =>
    request<void>(`/api/commerce/placements/${placementId}/product-anchors/${anchorId}`, {
      method: 'DELETE',
      csrfToken,
    }),

  // --- Commerce placements (Shopee) ---

  /**
   * Records a Shopee video placement already published natively (6A.5) —
   * mirrors recordManualExternalPost 1:1. Errors worth handling distinctly:
   * 401 wrong step-up password (retry in-modal), 403 not an admin,
   * 409 duplicate active placement OR copyright gate not cleared,
   * 422 duration null/out-of-range (10-60s inclusive), 429 throttled
   * (5 attempts / 15 min).
   */
  recordCommercePlacement: (body: RecordCommercePlacementInput, csrfToken: string) =>
    request<CommercePlacement>('/api/commerce/placements/manual-external', {
      method: 'POST',
      body,
      csrfToken,
    }),

  listCommercePlacements: (query?: ListCommercePlacementsQuery) =>
    request<CommercePlacement[]>(`/api/commerce/placements${buildCommercePlacementsQuery(query)}`),

  // --- Commerce conversions (append-only — no PATCH/DELETE route exists) ---

  createCommerceConversion: (body: CreateCommerceConversionInput, csrfToken: string) =>
    request<CommerceConversion>('/api/commerce/conversions', {
      method: 'POST',
      body,
      csrfToken,
    }),

  listCommerceConversions: (query?: ListCommerceConversionsQuery) =>
    request<CommerceConversion[]>(
      `/api/commerce/conversions${buildCommerceConversionsQuery(query)}`,
    ),

  /** Warn-only overlap probe for the entry form — debounce on date change. */
  checkConversionOverlap: (query: OverlapCheckQuery) =>
    request<{ overlaps: CommerceConversion[] }>(
      `/api/commerce/conversions/overlap-check?${new URLSearchParams({
        channel: query.channel,
        periodStart: query.periodStart,
        periodEnd: query.periodEnd,
      }).toString()}`,
    ),

  // --- Commerce read model (separate from the payout dashboard endpoints
  // above — reads commerce_conversions ONLY, never joined with metrics). ---

  getCommerceSummary: (query?: CommerceSummaryQuery) =>
    request<CommerceSummary>(`/api/commerce/summary${buildCommerceSummaryQuery(query)}`),

  getContentCommerceSummary: (contentId: string) =>
    request<ContentCommerceSummary>(`/api/commerce/summary/${contentId}`),

  // --- Paid / Ads visibility endpoints (Phase 7). No step-up on any write
  // (System Analyst SA-P3: a campaign record and a performance entry are both
  // descriptive facts about something that already happened entirely outside
  // Content Hub — nothing here pushes live or writes an override fact). ---

  listPaidCampaigns: (query?: ListPaidCampaignsQuery) =>
    request<AdCampaign[]>(`/api/paid/campaigns${buildPaidCampaignsQuery(query)}`),

  createPaidCampaign: (body: CreatePaidCampaignInput, csrfToken: string) =>
    request<AdCampaign>('/api/paid/campaigns', { method: 'POST', body, csrfToken }),

  updatePaidCampaign: (id: string, body: UpdatePaidCampaignInput, csrfToken: string) =>
    request<AdCampaign>(`/api/paid/campaigns/${id}`, { method: 'PATCH', body, csrfToken }),

  /** Soft-retire (isActive=false, retiredAt=now) — never a hard delete. */
  retirePaidCampaign: (id: string, csrfToken: string) =>
    request<AdCampaign>(`/api/paid/campaigns/${id}/retire`, { method: 'POST', csrfToken }),

  /** Newest-first append-only history for one campaign. */
  listPerformanceEntries: (campaignId: string) =>
    request<AdPerformanceEntry[]>(`/api/paid/campaigns/${campaignId}/performance-entries`),

  /**
   * Appends one performance entry (never edits/deletes — there is no such
   * route). Errors worth handling distinctly: 409 an identical payload was
   * already recorded within the last 60s (idempotency guard), 400 a
   * `correctsEntryId` belongs to a different campaign, 404 the campaign or
   * the corrected entry was not found.
   */
  createPerformanceEntry: (campaignId: string, body: CreatePerformanceEntryInput, csrfToken: string) =>
    request<AdPerformanceEntry>(`/api/paid/campaigns/${campaignId}/performance-entries`, {
      method: 'POST',
      body,
      csrfToken,
    }),

  /** Warn-only overlap probe for the entry form — debounce on date change. */
  checkPerformanceOverlap: (campaignId: string, query: PerformanceOverlapCheckQuery) =>
    request<{ overlaps: AdPerformanceEntry[] }>(
      `/api/paid/campaigns/${campaignId}/performance-entries/overlap-check?${new URLSearchParams({
        periodStart: query.periodStart,
        periodEnd: query.periodEnd,
      }).toString()}`,
    ),

  // --- Paid read model (separate from the payout AND commerce read models
  // above — reads ad_campaigns/ad_performance_entries ONLY, never joined
  // with metrics or commerce_conversions). ---

  getPaidSummary: (query?: PaidSummaryQuery) =>
    request<PaidSummary>(`/api/paid/summary${buildPaidSummaryQuery(query)}`),
};

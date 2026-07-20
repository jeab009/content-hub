import { CommerceChannel } from '@prisma/client';

/**
 * Placeholder credential shape. No live adapter has ever populated one — this
 * system has no Shopee KAM/managed-seller status and no TikTok Shop Creator
 * Affiliate access (Decision 5) — so the field names are indicative only,
 * matching the two identifiers the Shopee Open API partner flow documents.
 */
export interface CommerceCredentials {
  partnerId: string;
  partnerKey: string;
}

export interface UploadVideoArgs {
  placementDraft: { contentId: string; mediaUrl: string; durationSeconds: number };
  /** `null` ⇒ reject, faithful to the live path — see CommerceCredentialsError. */
  credentials: CommerceCredentials | null;
}
export interface UploadVideoResult {
  externalMediaId: string;
  uploadJobId: string;
}

export interface GetUploadStatusArgs {
  uploadJobId: string;
  credentials: CommerceCredentials | null;
}
export type UploadState = 'pending' | 'transcoding' | 'ready' | 'failed';
export interface GetUploadStatusResult {
  state: UploadState;
  externalMediaId: string | null;
}

export interface FetchProductsArgs {
  credentials: CommerceCredentials | null;
  cursor?: string;
}

/** Catalog rows as the channel reports them. Zero buyer fields, by construction. */
export interface ProductSnapshot {
  externalProductId: string;
  name: string;
  sku: string | null;
  productUrl: string | null;
  listPrice: number | null;
  currency: string;
  commissionRatePct: number | null;
}

export interface FetchConversionsArgs {
  credentials: CommerceCredentials | null;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * AGGREGATE ONLY. This shape is a PDPA control in its own right: there is no
 * field for buyer name, order id, address, phone or email, so a future live
 * adapter physically cannot hand order-level data to the ingestion path
 * without changing this interface — which is a reviewed change, not a drift.
 */
export interface ConversionSnapshot {
  externalProductId: string | null;
  periodStart: Date;
  periodEnd: Date;
  ordersCount: number | null;
  itemsSold: number | null;
  grossSalesAmount: number | null;
  commissionAmount: number;
  currency: string;
  statementRef: string | null;
}

/**
 * Contract every commerce adapter implements. DELIBERATELY NOT an extension
 * of `PlatformAdapter` (`modules/publish/adapters/platform-adapter.interface`):
 * that interface's four methods are publish/fetchMetrics/fetchComments/
 * replyComment, and Shopee has no comment inbox to reply into and produces no
 * payout-monetization metric — two of four would throw NotImplemented on
 * every commerce adapter, and a contract full of NotImplemented is one that
 * gets "fixed" later by relaxing the spec. This is a parallel registry, not a
 * subtype (phase6-architecture-design.md §3.5).
 *
 * Mock mode (the mandatory default outside production) performs NO network
 * I/O and returns deterministic values, exactly like the mock publishers —
 * but still rejects `credentials: null`, so a rehearsal is faithful to the
 * live path.
 */
export interface CommerceAdapter {
  readonly channel: CommerceChannel;
  uploadVideo(args: UploadVideoArgs): Promise<UploadVideoResult>;
  getUploadStatus(args: GetUploadStatusArgs): Promise<GetUploadStatusResult>;
  fetchProducts(args: FetchProductsArgs): Promise<ProductSnapshot[]>;
  fetchConversions(args: FetchConversionsArgs): Promise<ConversionSnapshot[]>;
}

/** Prefix for mock media ids so they can never be mistaken for a real channel id. */
export const MOCK_COMMERCE_ID_PREFIX = 'mock-commerce';

export function buildMockMediaId(channel: CommerceChannel, contentId: string): string {
  return `${MOCK_COMMERCE_ID_PREFIX}-${channel}-${contentId}`;
}

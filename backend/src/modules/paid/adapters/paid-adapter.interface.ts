import { AdChannel } from '@prisma/client';

/**
 * Placeholder credential shape for the 7D live-sync path
 * (docs/phase7d-live-integration-spec.md §2). No live adapter has ever
 * populated one — this system has no `ads_read` OAuth scope granted on the
 * existing Meta App (docs/meta-app-review-status.md: Dev Mode, Login/
 * own-Page publish scopes only) — so the field names are indicative only,
 * matching the two identifiers a Marketing/Insights API request needs: a
 * User/System-User access token and the ad account id it is scoped to. See
 * the spec §4 for why credential storage reuses `ConnectedAccount`'s
 * existing encrypted-token pattern rather than inventing a new shape.
 */
export interface PaidCredentials {
  accessToken: string;
  adAccountId: string;
}

export interface FetchCampaignPerformanceArgs {
  /** `null` ⇒ reject, faithful to the live path — see PaidCredentialsError. */
  credentials: PaidCredentials | null;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Campaign-level aggregate figures only, mapped field-for-field onto the
 * shipped `AdPerformanceEntry` shape (`backend/prisma/schema.prisma`) — see
 * the spec §3 for the full mapping table. AGGREGATE ONLY: there is no field
 * for an audience/segment id or an individual click/impression/recipient
 * identifier, so a future live adapter physically cannot hand that data to
 * the ingestion path without changing this interface — a reviewed change,
 * not a drift. This is the identical structural PDPA control
 * `ConversionSnapshot` already uses for Commerce
 * (`commerce-adapter.interface.ts`).
 */
export interface CampaignPerformanceSnapshot {
  externalCampaignId: string;
  periodStart: Date;
  periodEnd: Date;
  spend: number;
  reach: number | null;
  impressions: number | null;
  clicks: number | null;
  resultType: string | null;
  resultCount: number | null;
  currency: string;
}

/**
 * Contract a live paid adapter implements. Deliberately ONE method: v1's
 * only unmet need is "pull campaign performance data" for a campaign the
 * admin already logged manually — not Commerce's four-method surface
 * (upload/status/products/conversions), which Paid has no equivalent of.
 * `docs/phase7-architecture-design.md` §3.1 explicitly declines to speculate
 * this interface at the 7A gate ("no PaidAdapterRegistry to design... no
 * adapter interface is speculated here") and defers it to this WBS 7D
 * deliverable — this file is that interface, scoped to exactly what Paid
 * needs.
 *
 * No write methods exist and none are planned: Content Hub never creates,
 * edits, or budgets a Meta campaign (Decision 1/2,
 * `docs/phase7-project-plan.md`) — it only ever reads performance figures
 * about a campaign the admin manages in Meta Ads Manager or, at their own
 * discretion, via the Meta Ads MCP directly. Neither this interface nor any
 * implementation of it calls the MCP — see `docs/phase7d-live-integration-
 * spec.md` §0.
 */
export interface PaidAdapter {
  readonly channel: AdChannel;
  fetchCampaignPerformance(
    args: FetchCampaignPerformanceArgs,
  ): Promise<CampaignPerformanceSnapshot[]>;
}

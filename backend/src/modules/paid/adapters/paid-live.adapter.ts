import { Injectable } from '@nestjs/common';
import { AdChannel } from '@prisma/client';
import { AuditLogService } from '../../../common/audit/audit-log.service';
import {
  CampaignPerformanceSnapshot,
  FetchCampaignPerformanceArgs,
  PaidAdapter,
} from './paid-adapter.interface';
import { PaidIntegrationUnavailableError } from './paid.errors';

/**
 * Live Meta adapter — WBS 7D.2 scope is a rejecting stub, not a partial
 * integration, for the identical reason Commerce's `ShopeeAdapter`/
 * `TikTokShopAdapter` are stubs
 * (`backend/src/modules/commerce/adapters/shopee.adapter.ts`,
 * docs/phase6d-live-integration-spec.md): this system has no `ads_read`
 * OAuth scope granted on the existing Meta App
 * (docs/meta-app-review-status.md — Dev Mode, Login/own-Page publish scopes
 * only). There is therefore no live path to verify and none is claimed
 * here — the sole method below rejects with a clear, typed, AUDITED error
 * rather than attempting an HTTP call that has never run. A
 * plausible-looking but unexercised `fetch()` would be theater, and it
 * would fail at the worst possible moment. See
 * docs/phase7d-live-integration-spec.md for the bounded implementation path
 * once the scope is requested and granted.
 *
 * Deliberately makes ZERO network calls, to any host — not `graph.
 * facebook.com`, and not `mcp.facebook.com` either (phase7-project-plan.md
 * Decision 2: this codebase never calls the Meta Ads MCP, at the code
 * level, for any reason). See
 * `backend/src/testing/separation/paid-no-live-http-client.spec.ts` for the
 * structural proof.
 *
 * NOT wired into `PaidModule`'s provider list and not reachable from any
 * endpoint (there is no "sync now" button anywhere in the shipped UI —
 * design §3.1's own words: "no PaidAdapterRegistry to design... no adapter
 * interface is speculated"). This class exists to be unit-testable ahead of
 * credentials, exactly as this WBS item asks, not to be a live dependency
 * of anything shipped this phase. `PAID_IMPL_META` still gates the class
 * the same way `COMMERCE_IMPL_SHOPEE` gates the commerce stubs:
 * `assertAdapterFlagsAreSafe()` (`backend/src/config/assert-adapter-flags-
 * safe.ts`) already refuses to boot with `PAID_IMPL_META=meta` outside
 * `NODE_ENV=production` — the flag's only live effect today is that boot
 * guard, since nothing yet constructs this class conditionally on it (there
 * is no second, mock implementation to choose between the way
 * `CommerceAdapterRegistry` chooses for Shopee/TikTok Shop).
 */
@Injectable()
export class PaidLiveAdapter implements PaidAdapter {
  readonly channel = AdChannel.meta;

  constructor(private readonly auditLog: AuditLogService) {}

  fetchCampaignPerformance(
    _args: FetchCampaignPerformanceArgs,
  ): Promise<CampaignPerformanceSnapshot[]> {
    this.auditLog.record({
      actor: 'system:paid-adapter',
      action: 'paid_adapter_unavailable',
      result: 'failure',
      meta: { channel: this.channel, method: 'fetchCampaignPerformance' },
    });
    return Promise.reject(
      new PaidIntegrationUnavailableError(
        "Live Meta Marketing/Insights API integration requires an 'ads_read' OAuth scope that has " +
          "not been granted on this system's Meta App yet (see docs/meta-app-review-status.md — " +
          'Dev Mode, Login/own-Page publish scopes only). Set PAID_IMPL_META=disabled and continue ' +
          'logging spend/results manually via POST /api/paid/campaigns/:id/performance-entries. See ' +
          'docs/phase7d-live-integration-spec.md for the bounded implementation path once the scope ' +
          'is requested and granted. Called: fetchCampaignPerformance.',
      ),
    );
  }
}

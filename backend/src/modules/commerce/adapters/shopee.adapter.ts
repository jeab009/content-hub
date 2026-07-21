import { Injectable } from '@nestjs/common';
import { CommerceChannel } from '@prisma/client';
import { AuditLogService } from '../../../common/audit/audit-log.service';
import {
  CommerceAdapter,
  ConversionSnapshot,
  FetchConversionsArgs,
  FetchProductsArgs,
  GetUploadStatusArgs,
  GetUploadStatusResult,
  ProductSnapshot,
  UploadVideoArgs,
  UploadVideoResult,
} from './commerce-adapter.interface';
import { CommerceIntegrationUnavailableError } from './commerce.errors';

/**
 * Live Shopee adapter — 6D scope is a rejecting stub, not a partial
 * integration. Read this before assuming any live capability exists: this
 * system has no Shopee KAM, no managed-seller status, and no partner_id/
 * partner_key (the Shopee Affiliate Open API requires all three). There is
 * therefore no live path to verify and none is claimed here — every method
 * below rejects with a clear, typed, AUDITED error rather than attempting an
 * HTTP call that has never run (Decision 5: no HTTP client this phase). A
 * plausible-looking but unexercised `fetch()` would be theater, and it would
 * fail at the worst possible moment.
 *
 * `CommerceAdapterRegistry` only resolves to this class when
 * `COMMERCE_IMPL_SHOPEE` is set to a non-mock value, which `main.ts`'s
 * `assertAdapterFlagsAreSafe()` already refuses to boot with outside
 * `NODE_ENV=production` — so reaching this class at all is itself a signal
 * worth an audit row.
 */
@Injectable()
export class ShopeeAdapter implements CommerceAdapter {
  readonly channel = CommerceChannel.shopee;

  constructor(private readonly auditLog: AuditLogService) {}

  uploadVideo(_args: UploadVideoArgs): Promise<UploadVideoResult> {
    return this.reject('uploadVideo');
  }

  getUploadStatus(_args: GetUploadStatusArgs): Promise<GetUploadStatusResult> {
    return this.reject('getUploadStatus');
  }

  fetchProducts(_args: FetchProductsArgs): Promise<ProductSnapshot[]> {
    return this.reject('fetchProducts');
  }

  fetchConversions(_args: FetchConversionsArgs): Promise<ConversionSnapshot[]> {
    return this.reject('fetchConversions');
  }

  private reject<T>(method: string): Promise<T> {
    this.auditLog.record({
      actor: 'system:commerce-adapter',
      action: 'commerce_adapter_unavailable',
      result: 'failure',
      meta: { channel: this.channel, method },
    });
    return Promise.reject(
      new CommerceIntegrationUnavailableError(
        'Live Shopee integration requires credentials that do not exist yet for this system: no ' +
          'managed-seller status, no assigned KAM, and no partner_id/partner_key. Set ' +
          'COMMERCE_IMPL_SHOPEE=mock and use the manual-external placement path ' +
          '(POST /api/commerce/placements/manual-external) instead. See ' +
          'docs/phase6d-live-integration-spec.md for the bounded implementation path once ' +
          `credentials are granted. Called: ${method}.`,
      ),
    );
  }
}

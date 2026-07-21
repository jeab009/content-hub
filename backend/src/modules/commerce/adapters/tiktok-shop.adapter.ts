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
 * Live TikTok Shop adapter — see ShopeeAdapter's docblock; the same
 * rejecting-stub contract applies. This system has no TikTok Shop Creator
 * Affiliate access, so every method rejects with a clear, typed, AUDITED
 * error and makes zero network calls (Decision 5).
 */
@Injectable()
export class TikTokShopAdapter implements CommerceAdapter {
  readonly channel = CommerceChannel.tiktok_shop;

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
        'Live TikTok Shop integration requires credentials that do not exist yet for this system: ' +
          'no TikTok Shop Creator Affiliate access has been granted. Set ' +
          'COMMERCE_IMPL_TIKTOK_SHOP=mock and use the manual-external placement / product-anchor ' +
          'path instead. See docs/phase6d-live-integration-spec.md for the bounded implementation ' +
          `path once credentials are granted. Called: ${method}.`,
      ),
    );
  }
}

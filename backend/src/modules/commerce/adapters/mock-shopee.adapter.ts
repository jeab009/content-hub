import { Injectable } from '@nestjs/common';
import { CommerceChannel } from '@prisma/client';
import {
  buildMockMediaId,
  CommerceAdapter,
  CommerceCredentials,
  ConversionSnapshot,
  FetchConversionsArgs,
  FetchProductsArgs,
  GetUploadStatusArgs,
  GetUploadStatusResult,
  ProductSnapshot,
  UploadVideoArgs,
  UploadVideoResult,
} from './commerce-adapter.interface';
import { CommerceCredentialsError } from './commerce.errors';

/**
 * Mock Shopee adapter — the delivered rehearsal path this phase (Decision 5:
 * no live HTTP client exists). No network I/O; every method is deterministic
 * for a given input, exactly like the mock platform publishers.
 *
 * Still rejects `credentials: null` — a rehearsal that accepted a missing
 * credential would not be faithful to what the live path will require.
 */
@Injectable()
export class MockShopeeAdapter implements CommerceAdapter {
  readonly channel = CommerceChannel.shopee;

  async uploadVideo(args: UploadVideoArgs): Promise<UploadVideoResult> {
    this.assertCredentials(args.credentials);
    const externalMediaId = buildMockMediaId(this.channel, args.placementDraft.contentId);
    return { externalMediaId, uploadJobId: `mock-job-${args.placementDraft.contentId}` };
  }

  async getUploadStatus(args: GetUploadStatusArgs): Promise<GetUploadStatusResult> {
    this.assertCredentials(args.credentials);
    const contentId = args.uploadJobId.replace(/^mock-job-/, '');
    return { state: 'ready', externalMediaId: buildMockMediaId(this.channel, contentId) };
  }

  async fetchProducts(args: FetchProductsArgs): Promise<ProductSnapshot[]> {
    this.assertCredentials(args.credentials);
    return [
      {
        externalProductId: 'MOCK-SHOPEE-PRODUCT-1',
        name: 'Mock Shopee Product',
        sku: 'MOCK-SKU-1',
        productUrl: 'https://shopee.mock/product/1',
        listPrice: 299,
        currency: 'THB',
        commissionRatePct: 10,
      },
    ];
  }

  async fetchConversions(args: FetchConversionsArgs): Promise<ConversionSnapshot[]> {
    this.assertCredentials(args.credentials);
    return [
      {
        externalProductId: 'MOCK-SHOPEE-PRODUCT-1',
        periodStart: args.periodStart,
        periodEnd: args.periodEnd,
        ordersCount: 10,
        itemsSold: 12,
        grossSalesAmount: 3000,
        commissionAmount: 300,
        currency: 'THB',
        statementRef: 'MOCK-SHOPEE-STMT',
      },
    ];
  }

  private assertCredentials(credentials: CommerceCredentials | null): void {
    if (!credentials) {
      throw new CommerceCredentialsError(
        `Mock ${this.channel} adapter requires credentials — mocks reject a missing credential too, ` +
          'faithful to the live path.',
      );
    }
  }
}

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
 * Mock TikTok Shop adapter — see MockShopeeAdapter's docblock; the same
 * rehearsal contract applies verbatim, mirrored per channel.
 */
@Injectable()
export class MockTikTokShopAdapter implements CommerceAdapter {
  readonly channel = CommerceChannel.tiktok_shop;

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
        externalProductId: 'MOCK-TIKTOK-SHOP-PRODUCT-1',
        name: 'Mock TikTok Shop Product',
        sku: 'MOCK-SKU-2',
        productUrl: 'https://shop.tiktok.mock/product/1',
        listPrice: 399,
        currency: 'THB',
        commissionRatePct: 8,
      },
    ];
  }

  async fetchConversions(args: FetchConversionsArgs): Promise<ConversionSnapshot[]> {
    this.assertCredentials(args.credentials);
    return [
      {
        externalProductId: 'MOCK-TIKTOK-SHOP-PRODUCT-1',
        periodStart: args.periodStart,
        periodEnd: args.periodEnd,
        ordersCount: 6,
        itemsSold: 6,
        grossSalesAmount: 2400,
        commissionAmount: 192,
        currency: 'THB',
        statementRef: 'MOCK-TIKTOK-SHOP-STMT',
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

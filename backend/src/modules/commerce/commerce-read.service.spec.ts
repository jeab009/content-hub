import { NotFoundException } from '@nestjs/common';
import {
  CommerceChannel,
  CommerceConversion,
  CommercePlacement,
  CommerceSource,
  Prisma,
} from '@prisma/client';
import { CommerceReadService } from './commerce-read.service';
import { PrismaService } from '../prisma/prisma.service';

function buildConversion(overrides: Partial<CommerceConversion> = {}): CommerceConversion {
  return {
    id: 'conversion-1',
    channel: CommerceChannel.shopee,
    periodStart: new Date('2026-07-01T00:00:00Z'),
    periodEnd: new Date('2026-07-07T00:00:00Z'),
    ordersCount: 10,
    itemsSold: 12,
    grossSalesAmount: new Prisma.Decimal('3000.00'),
    commissionAmount: new Prisma.Decimal('300.00'),
    currency: 'THB',
    postId: null,
    placementId: null,
    productId: 'product-1',
    affiliateLinkId: null,
    statementRef: null,
    reversalOfId: null,
    source: CommerceSource.manual,
    recordedBy: 'user-1',
    createdAt: new Date('2026-07-20T00:00:00Z'),
    ...overrides,
  };
}

function buildPlacement(overrides: Partial<CommercePlacement> = {}): CommercePlacement {
  return {
    id: 'placement-1',
    contentId: 'content-1',
    channel: CommerceChannel.shopee,
    externalMediaId: 'SHOPEE-MEDIA-1',
    externalUrl: null,
    status: 'recorded' as CommercePlacement['status'],
    publishMethod: 'manual_external' as CommercePlacement['publishMethod'],
    sourceAssetId: null,
    mediaUrl: null,
    durationSeconds: 30,
    note: null,
    version: 0,
    source: CommerceSource.manual,
    recordedBy: 'user-1',
    placedAt: new Date('2026-07-20T00:00:00Z'),
    removedAt: null,
    createdAt: new Date('2026-07-20T00:00:00Z'),
    updatedAt: new Date('2026-07-20T00:00:00Z'),
    ...overrides,
  };
}

describe('CommerceReadService', () => {
  let prisma: {
    commerceConversion: { findMany: jest.Mock };
    commercePlacement: { findMany: jest.Mock };
    post: { findMany: jest.Mock };
    content: { findUnique: jest.Mock };
  };
  let service: CommerceReadService;

  beforeEach(() => {
    prisma = {
      commerceConversion: { findMany: jest.fn().mockResolvedValue([]) },
      commercePlacement: { findMany: jest.fn().mockResolvedValue([]) },
      post: { findMany: jest.fn().mockResolvedValue([]) },
      content: { findUnique: jest.fn().mockResolvedValue({ id: 'content-1' }) },
    };
    service = new CommerceReadService(prisma as unknown as PrismaService);
  });

  describe('summary', () => {
    it('applies channel/productId/period filters to the query', async () => {
      await service.summary({
        channel: CommerceChannel.shopee,
        productId: 'product-1',
        periodStart: '2026-07-01',
        periodEnd: '2026-07-31',
      });
      expect(prisma.commerceConversion.findMany).toHaveBeenCalledWith({
        where: {
          channel: CommerceChannel.shopee,
          productId: 'product-1',
          periodStart: { gte: new Date('2026-07-01') },
          periodEnd: { lte: new Date('2026-07-31') },
        },
      });
    });

    it('sums commissionAmount/grossSalesAmount/ordersCount/itemsSold within one currency', async () => {
      prisma.commerceConversion.findMany.mockResolvedValueOnce([
        buildConversion({
          commissionAmount: new Prisma.Decimal('100.00'),
          ordersCount: 2,
          itemsSold: 3,
        }),
        buildConversion({
          commissionAmount: new Prisma.Decimal('50.50'),
          ordersCount: 1,
          itemsSold: 1,
        }),
      ]);

      const result = await service.summary({});

      expect(result.totals).toEqual([
        expect.objectContaining({
          currency: 'THB',
          commissionAmount: 150.5,
          ordersCount: 3,
          itemsSold: 4,
          conversionRecords: 2,
        }),
      ]);
    });

    it('SA-9/NFR-6.12: two currencies yield two groups, never one scalar grand total', async () => {
      prisma.commerceConversion.findMany.mockResolvedValueOnce([
        buildConversion({ currency: 'THB', commissionAmount: new Prisma.Decimal('100.00') }),
        buildConversion({ currency: 'USD', commissionAmount: new Prisma.Decimal('100.00') }),
      ]);

      const result = await service.summary({});

      expect(result.totals).toHaveLength(2);
      const currencies = result.totals.map((total) => total.currency).sort();
      expect(currencies).toEqual(['THB', 'USD']);
      // No cross-currency sum anywhere: each group's commissionAmount is its
      // OWN 100, not 200 — the numbers a naive single-total bug would produce.
      for (const total of result.totals) {
        expect(total.commissionAmount).toBe(100);
      }
    });

    it('byChannel groups by (channel, currency)', async () => {
      prisma.commerceConversion.findMany.mockResolvedValueOnce([
        buildConversion({ channel: CommerceChannel.shopee }),
        buildConversion({ channel: CommerceChannel.tiktok_shop }),
      ]);

      const result = await service.summary({});
      const channels = result.byChannel.map((item) => item.channel).sort();
      expect(channels).toEqual([CommerceChannel.shopee, CommerceChannel.tiktok_shop].sort());
    });

    it('byProduct buckets unattributed (productId: null) conversions separately', async () => {
      prisma.commerceConversion.findMany.mockResolvedValueOnce([
        buildConversion({ productId: 'product-1' }),
        buildConversion({ productId: null }),
      ]);

      const result = await service.summary({});
      expect(result.byProduct.map((item) => item.productId).sort()).toEqual(
        [null, 'product-1'].sort(),
      );
    });

    it('byPeriod groups by the exact (periodStart, periodEnd) pair', async () => {
      prisma.commerceConversion.findMany.mockResolvedValueOnce([
        buildConversion({
          periodStart: new Date('2026-07-01T00:00:00Z'),
          periodEnd: new Date('2026-07-07T00:00:00Z'),
        }),
        buildConversion({
          periodStart: new Date('2026-07-08T00:00:00Z'),
          periodEnd: new Date('2026-07-14T00:00:00Z'),
        }),
      ]);

      const result = await service.summary({});
      expect(result.byPeriod).toHaveLength(2);
      expect(result.byPeriod[0].periodStart).toBe('2026-07-01');
    });
  });

  describe('contentSummary', () => {
    it('404s when the content does not exist', async () => {
      prisma.content.findUnique.mockResolvedValueOnce(null);
      await expect(service.contentSummary('missing')).rejects.toThrow(NotFoundException);
    });

    it('returns empty totals/placements/conversions for a content with no commerce activity', async () => {
      const result = await service.contentSummary('content-1');
      expect(result).toEqual(
        expect.objectContaining({
          contentId: 'content-1',
          totals: [],
          placements: [],
          conversions: [],
        }),
      );
      // No query at all when there is nothing to attribute to.
      expect(prisma.commerceConversion.findMany).not.toHaveBeenCalled();
    });

    it("attributes conversions via this content's placements AND posts", async () => {
      prisma.commercePlacement.findMany.mockResolvedValueOnce([
        buildPlacement({ id: 'placement-1' }),
      ]);
      prisma.post.findMany.mockResolvedValueOnce([{ id: 'post-1' }]);
      prisma.commerceConversion.findMany.mockResolvedValueOnce([buildConversion()]);

      const result = await service.contentSummary('content-1');

      expect(prisma.commerceConversion.findMany).toHaveBeenCalledWith({
        where: { OR: [{ placementId: { in: ['placement-1'] } }, { postId: { in: ['post-1'] } }] },
        orderBy: { createdAt: 'desc' },
      });
      expect(result.placements).toHaveLength(1);
      expect(result.conversions).toHaveLength(1);
      expect(result.totals).toHaveLength(1);
    });
  });
});

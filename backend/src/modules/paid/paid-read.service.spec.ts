import { AdPerformanceEntry, AdSource, Prisma } from '@prisma/client';
import { PaidReadService } from './paid-read.service';
import { PrismaService } from '../prisma/prisma.service';

function buildEntry(overrides: Partial<AdPerformanceEntry> = {}): AdPerformanceEntry {
  return {
    id: 'entry-1',
    campaignId: 'campaign-1',
    spend: new Prisma.Decimal('300.00'),
    reach: 5000,
    impressions: 9000,
    clicks: 120,
    resultType: 'link_clicks',
    resultCount: 120,
    currency: 'THB',
    periodStart: new Date('2026-07-01T00:00:00Z'),
    periodEnd: new Date('2026-07-07T00:00:00Z'),
    sourceRef: null,
    correctsEntryId: null,
    source: AdSource.manual,
    recordedBy: 'user-1',
    createdAt: new Date('2026-07-20T00:00:00Z'),
    ...overrides,
  };
}

describe('PaidReadService', () => {
  let prisma: {
    adPerformanceEntry: { findMany: jest.Mock };
    adCampaign: { findMany: jest.Mock };
  };
  let service: PaidReadService;

  beforeEach(() => {
    prisma = {
      adPerformanceEntry: { findMany: jest.fn().mockResolvedValue([]) },
      adCampaign: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new PaidReadService(prisma as unknown as PrismaService);
  });

  describe('summary', () => {
    it('sums entries into totals/byCampaign/byResultType, grouped by currency (SA-P6/NFR-7.10)', async () => {
      prisma.adPerformanceEntry.findMany.mockResolvedValueOnce([
        buildEntry({ spend: new Prisma.Decimal('300.00'), campaignId: 'campaign-1' }),
        buildEntry({ spend: new Prisma.Decimal('180.50'), campaignId: 'campaign-1' }),
      ]);

      const summary = await service.summary({}, new Date('2026-07-31T00:00:00Z'));

      expect(summary.totals).toEqual([
        expect.objectContaining({
          currency: 'THB',
          totalSpend: 480.5,
          totalReach: 10000,
          totalImpressions: 18000,
          totalClicks: 240,
          totalResultCount: 240,
          entriesCount: 2,
        }),
      ]);
      expect(summary.byCampaign).toEqual([
        expect.objectContaining({ campaignId: 'campaign-1', totalSpend: 480.5, entriesCount: 2 }),
      ]);
      expect(summary.byResultType).toEqual([
        expect.objectContaining({ resultType: 'link_clicks', totalSpend: 480.5 }),
      ]);
    });

    it('never emits a scalar cross-currency total — a second currency yields TWO groups, not one summed number', async () => {
      prisma.adPerformanceEntry.findMany.mockResolvedValueOnce([
        buildEntry({ currency: 'THB', spend: new Prisma.Decimal('300.00') }),
        buildEntry({ currency: 'USD', spend: new Prisma.Decimal('50.00') }),
      ]);

      const summary = await service.summary({});
      expect(summary.totals).toHaveLength(2);
      expect(summary.totals.map((total) => total.currency).sort()).toEqual(['THB', 'USD']);
    });

    it('never exposes plannedBudget or reconciles it against totalSpend (SA-P5)', async () => {
      const summary = await service.summary({});
      expect(summary).not.toHaveProperty('plannedBudget');
      expect(JSON.stringify(summary)).not.toContain('plannedBudget');
    });

    it('filters by campaignId/periodStart/periodEnd', async () => {
      await service.summary({
        campaignId: 'campaign-1',
        periodStart: '2026-07-01',
        periodEnd: '2026-07-31',
      });
      expect(prisma.adPerformanceEntry.findMany).toHaveBeenCalledWith({
        where: {
          campaignId: 'campaign-1',
          periodStart: { gte: new Date('2026-07-01') },
          periodEnd: { lte: new Date('2026-07-31') },
        },
      });
    });

    it('scopes by contentId via a two-step campaign lookup (never a cross-boundary include)', async () => {
      prisma.adCampaign.findMany.mockResolvedValueOnce([
        { id: 'campaign-1' },
        { id: 'campaign-2' },
      ]);
      await service.summary({ contentId: 'content-1' });

      expect(prisma.adCampaign.findMany).toHaveBeenCalledWith({
        where: { contentId: 'content-1' },
        select: { id: true },
      });
      expect(prisma.adPerformanceEntry.findMany).toHaveBeenCalledWith({
        where: { campaignId: { in: ['campaign-1', 'campaign-2'] } },
      });
    });

    it('buckets an entry with no resultType under "unlabelled", not dropped', async () => {
      prisma.adPerformanceEntry.findMany.mockResolvedValueOnce([buildEntry({ resultType: null })]);
      const summary = await service.summary({});
      expect(summary.byResultType).toEqual([expect.objectContaining({ resultType: null })]);
    });
  });
});

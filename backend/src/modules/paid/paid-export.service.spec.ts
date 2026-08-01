import { AdSource, Prisma } from '@prisma/client';
import { PAID_CSV_HEADERS, PaidExportService } from './paid-export.service';
import { PrismaService } from '../prisma/prisma.service';

function buildEntryWithChannel(overrides: Record<string, unknown> = {}) {
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
    sourceRef: 'META-ADSMGR-W27',
    correctsEntryId: null,
    source: AdSource.manual,
    recordedBy: 'user-1',
    createdAt: new Date('2026-07-20T00:00:00Z'),
    campaign: { channel: 'meta' },
    ...overrides,
  };
}

describe('PaidExportService', () => {
  let prisma: { adPerformanceEntry: { findMany: jest.Mock } };
  let service: PaidExportService;

  beforeEach(() => {
    prisma = { adPerformanceEntry: { findMany: jest.fn().mockResolvedValue([]) } };
    service = new PaidExportService(prisma as unknown as PrismaService);
  });

  it('the frozen header row is exactly this, in this order (no payout or commerce column, ever)', () => {
    expect([...PAID_CSV_HEADERS]).toEqual([
      'campaign_id',
      'channel',
      'period_start',
      'period_end',
      'spend',
      'reach',
      'impressions',
      'clicks',
      'result_type',
      'result_count',
      'currency',
      'corrects_entry_id',
      'source',
      'recorded_by',
      'created_at',
    ]);
  });

  it('no header uses payout or commerce vocabulary', () => {
    const otherStreamVocabulary =
      /revenue|engagement|commission|gross_sales|orders_count|affiliate/i;
    expect(PAID_CSV_HEADERS.filter((header) => otherStreamVocabulary.test(header))).toEqual([]);
  });

  it('never includes source_ref — the highest-residual PII free-text column is never exported (SA-P1)', async () => {
    prisma.adPerformanceEntry.findMany.mockResolvedValueOnce([
      buildEntryWithChannel({ sourceRef: 'a-value-that-must-never-leave-the-db-column' }),
    ]);

    const csv = await service.paidCsv({});

    expect(csv).not.toContain('a-value-that-must-never-leave-the-db-column');
    expect(csv.split('\r\n')[0].split(',')).not.toContain('source_ref');
  });

  it('emits no cell matching an email/phone-shaped value', async () => {
    prisma.adPerformanceEntry.findMany.mockResolvedValueOnce([buildEntryWithChannel()]);
    const csv = await service.paidCsv({});

    const emailLike = /[^\s,]+@[^\s,]+\.[^\s,]+/;
    const phoneLike = /\b0\d{9}\b/;
    expect(emailLike.test(csv)).toBe(false);
    expect(phoneLike.test(csv)).toBe(false);
  });

  it('applies campaignId/from/to filters against createdAt', async () => {
    await service.paidCsv({ campaignId: 'campaign-1', from: '2026-07-01', to: '2026-07-31' });

    expect(prisma.adPerformanceEntry.findMany).toHaveBeenCalledWith({
      where: {
        campaignId: 'campaign-1',
        createdAt: { gte: new Date('2026-07-01'), lte: new Date('2026-07-31') },
      },
      orderBy: { createdAt: 'asc' },
      include: { campaign: { select: { channel: true } } },
    });
  });

  it('renders a full row with header, in the frozen column order', async () => {
    prisma.adPerformanceEntry.findMany.mockResolvedValueOnce([buildEntryWithChannel()]);
    const csv = await service.paidCsv({});
    const [header, row] = csv.trim().split('\r\n');

    expect(header).toBe(PAID_CSV_HEADERS.join(','));
    expect(row).toBe(
      'campaign-1,meta,2026-07-01,2026-07-07,300,5000,9000,120,link_clicks,120,THB,,manual,user-1,2026-07-20T00:00:00.000Z',
    );
  });
});

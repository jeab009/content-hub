import { CommerceChannel, CommerceConversion, CommerceSource, Prisma } from '@prisma/client';
import { COMMERCE_CSV_HEADERS, CommerceExportService } from './commerce-export.service';
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
    statementRef: 'SHP-2026-W27',
    reversalOfId: null,
    source: CommerceSource.manual,
    recordedBy: 'user-1',
    createdAt: new Date('2026-07-20T00:00:00Z'),
    ...overrides,
  };
}

describe('CommerceExportService', () => {
  let prisma: { commerceConversion: { findMany: jest.Mock } };
  let service: CommerceExportService;

  beforeEach(() => {
    prisma = { commerceConversion: { findMany: jest.fn().mockResolvedValue([]) } };
    service = new CommerceExportService(prisma as unknown as PrismaService);
  });

  it('the frozen header row is exactly this, in this order (no payout column, ever)', () => {
    expect([...COMMERCE_CSV_HEADERS]).toEqual([
      'channel',
      'period_start',
      'period_end',
      'orders_count',
      'items_sold',
      'gross_sales_amount',
      'commission_amount',
      'currency',
      'product_id',
      'placement_id',
      'post_id',
      'affiliate_link_id',
      'source',
      'recorded_by',
      'created_at',
    ]);
  });

  it('no header uses payout vocabulary (revenue/reach/engagement)', () => {
    const payoutVocabulary = /revenue|reach|engagement/i;
    expect(COMMERCE_CSV_HEADERS.filter((header) => payoutVocabulary.test(header))).toEqual([]);
  });

  it('never includes statementRef or note — the two PDPA free-text columns are never exported', async () => {
    prisma.commerceConversion.findMany.mockResolvedValueOnce([
      buildConversion({ statementRef: 'a-value-that-must-never-leave-the-db-column' }),
    ]);

    const csv = await service.commerceCsv({});

    expect(csv).not.toContain('a-value-that-must-never-leave-the-db-column');
    expect(csv.split('\r\n')[0].split(',')).not.toContain('statement_ref');
    expect(csv.split('\r\n')[0].split(',')).not.toContain('note');
  });

  it('a negative reversal exports as a plain numeric cell (C7), not a formula-escaped string', async () => {
    prisma.commerceConversion.findMany.mockResolvedValueOnce([
      buildConversion({ commissionAmount: new Prisma.Decimal('-4500.00'), grossSalesAmount: null }),
    ]);

    const csv = await service.commerceCsv({});
    const dataRow = csv.split('\r\n')[1];

    // -4500 as a bare number, NOT '-4500 (the formula-guard quote C7 exists to avoid).
    expect(dataRow).toContain(',-4500,');
    expect(dataRow).not.toContain("'-4500");
  });

  it('emits no cell matching an email/phone-shaped value (NFR-6.6)', async () => {
    prisma.commerceConversion.findMany.mockResolvedValueOnce([buildConversion()]);
    const csv = await service.commerceCsv({});

    const emailLike = /[^\s,]+@[^\s,]+\.[^\s,]+/;
    const phoneLike = /\b0\d{9}\b/;
    expect(emailLike.test(csv)).toBe(false);
    expect(phoneLike.test(csv)).toBe(false);
  });

  it('applies channel/productId/from/to filters against createdAt', async () => {
    await service.commerceCsv({
      channel: CommerceChannel.shopee,
      productId: 'product-1',
      from: '2026-07-01',
      to: '2026-07-31',
    });

    expect(prisma.commerceConversion.findMany).toHaveBeenCalledWith({
      where: {
        channel: CommerceChannel.shopee,
        productId: 'product-1',
        createdAt: { gte: new Date('2026-07-01'), lte: new Date('2026-07-31') },
      },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('renders a full row with header, in the frozen column order', async () => {
    prisma.commerceConversion.findMany.mockResolvedValueOnce([buildConversion()]);
    const csv = await service.commerceCsv({});
    const [header, row] = csv.trim().split('\r\n');

    expect(header).toBe(COMMERCE_CSV_HEADERS.join(','));
    expect(row).toBe(
      'shopee,2026-07-01,2026-07-07,10,12,3000,300,THB,product-1,,,,manual,user-1,2026-07-20T00:00:00.000Z',
    );
  });
});

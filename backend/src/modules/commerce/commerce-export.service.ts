import { Injectable } from '@nestjs/common';
import { CommerceConversion, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CsvValue, toCsv } from '../../common/utils/csv.util';
import { CommerceReportQueryDto } from './dto/commerce-report-query.dto';

/**
 * Frozen header row for the commerce CSV export (6A.9). Extracted to a named
 * constant for the same reason `REVENUE_CSV_HEADERS` is (design B5 /
 * `src/testing/separation/csv-header-freeze.spec.ts`): this is a SEPARATE
 * report, never a column appended to `revenue.csv`, and the frozen literal
 * makes that a fast, no-database test rather than a hope.
 *
 * NO KEY NAMED `revenue` (Layer 5 vocabulary separation) and NO
 * `statement_ref` / `note` COLUMN — those two free-text fields are never
 * exported (System Analyst §1.5: "neither field... appears in the commerce
 * CSV export"), so even a value an admin should not have typed never leaves
 * this DB column via this path.
 */
export const COMMERCE_CSV_HEADERS = [
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
] as const;

/**
 * The commerce CSV export (6A.9) — a SEPARATE report from `revenue.csv`,
 * mounted on the existing `ReportsController` (design §3.2) but living here
 * so `modules/commerce` stays the only place that reads `commerce_conversions`
 * for a document. Read-only aggregation over the append-only ledger; nothing
 * here writes.
 */
@Injectable()
export class CommerceExportService {
  constructor(private readonly prisma: PrismaService) {}

  async commerceCsv(query: CommerceReportQueryDto): Promise<string> {
    const conversions = await this.prisma.commerceConversion.findMany({
      where: this.buildWhere(query),
      orderBy: { createdAt: 'asc' },
    });

    const rows = conversions.map((conversion) => this.toRow(conversion));
    return toCsv(COMMERCE_CSV_HEADERS, rows);
  }

  private buildWhere(query: CommerceReportQueryDto): Prisma.CommerceConversionWhereInput {
    return {
      ...(query.channel && { channel: query.channel }),
      ...(query.productId && { productId: query.productId }),
      ...((query.from || query.to) && {
        createdAt: {
          ...(query.from && { gte: new Date(query.from) }),
          ...(query.to && { lte: new Date(query.to) }),
        },
      }),
    };
  }

  /**
   * Amounts are passed as NUMBERS, not `.toFixed(2)` strings (System
   * Analyst C7): `escapeCsvField` skips the formula-prefix guard for a
   * plain number, so a negative reversal (`-4500`) round-trips as a
   * SUMMABLE numeric cell in Excel instead of a text cell prefixed `'`.
   * A `.toFixed(2)` string would have silently re-introduced the exact
   * defect C7 closed.
   */
  private toRow(conversion: CommerceConversion): CsvValue[] {
    return [
      conversion.channel,
      conversion.periodStart.toISOString().slice(0, 10),
      conversion.periodEnd.toISOString().slice(0, 10),
      conversion.ordersCount,
      conversion.itemsSold,
      conversion.grossSalesAmount === null ? null : Number(conversion.grossSalesAmount),
      Number(conversion.commissionAmount),
      conversion.currency,
      conversion.productId,
      conversion.placementId,
      conversion.postId,
      conversion.affiliateLinkId,
      conversion.source,
      conversion.recordedBy,
      conversion.createdAt.toISOString(),
    ];
  }
}

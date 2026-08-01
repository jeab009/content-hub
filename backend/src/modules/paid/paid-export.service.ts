import { Injectable } from '@nestjs/common';
import { AdPerformanceEntry, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CsvValue, toCsv } from '../../common/utils/csv.util';
import { PaidReportQueryDto } from './dto/paid-report-query.dto';

type EntryWithChannel = AdPerformanceEntry & { campaign: { channel: string } };

/**
 * Frozen header row for the paid CSV export (design §3.2, WBS 7A.4). This
 * is a SEPARATE report — never a column appended to `revenue.csv` or
 * `commerce.csv` — and the frozen literal makes that a fast, no-database
 * test rather than a hope, mirroring `COMMERCE_CSV_HEADERS` exactly
 * (`src/testing/separation/csv-header-freeze.spec.ts`).
 *
 * NO KEY NAMED `revenue`/`commission_amount`/`gross_sales_amount` (Layer 5
 * vocabulary separation) and NO `source_ref` COLUMN — the highest-residual
 * PII free-text field on `ad_performance_entries` is never exported, the
 * same posture Commerce shipped for `statement_ref`/`note`.
 */
export const PAID_CSV_HEADERS = [
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
] as const;

/**
 * The paid CSV export (design §3.2, WBS 7A.4) — a SEPARATE report from
 * `revenue.csv` and `commerce.csv`, mounted on the existing
 * `ReportsController` (design §3.2) but living here so `modules/paid` stays
 * the only place that reads `ad_performance_entries` for a document.
 * Read-only aggregation over the append-only ledger; nothing here writes.
 *
 * `spend` is `CHECK >= 0` (System Analyst SA-P2) — there is no
 * negative-amount CSV-escaping concern here, unlike Commerce's C7 finding:
 * no signed money field exists anywhere in either paid table.
 */
@Injectable()
export class PaidExportService {
  constructor(private readonly prisma: PrismaService) {}

  async paidCsv(query: PaidReportQueryDto): Promise<string> {
    const entries = (await this.prisma.adPerformanceEntry.findMany({
      where: this.buildWhere(query),
      orderBy: { createdAt: 'asc' },
      include: { campaign: { select: { channel: true } } },
    })) as EntryWithChannel[];

    const rows = entries.map((entry) => this.toRow(entry));
    return toCsv(PAID_CSV_HEADERS, rows);
  }

  private buildWhere(query: PaidReportQueryDto): Prisma.AdPerformanceEntryWhereInput {
    return {
      ...(query.campaignId && { campaignId: query.campaignId }),
      ...((query.from || query.to) && {
        createdAt: {
          ...(query.from && { gte: new Date(query.from) }),
          ...(query.to && { lte: new Date(query.to) }),
        },
      }),
    };
  }

  private toRow(entry: EntryWithChannel): CsvValue[] {
    return [
      entry.campaignId,
      entry.campaign.channel,
      entry.periodStart.toISOString().slice(0, 10),
      entry.periodEnd.toISOString().slice(0, 10),
      Number(entry.spend),
      entry.reach,
      entry.impressions,
      entry.clicks,
      entry.resultType,
      entry.resultCount,
      entry.currency,
      entry.correctsEntryId,
      entry.source,
      entry.recordedBy,
      entry.createdAt.toISOString(),
    ];
  }
}

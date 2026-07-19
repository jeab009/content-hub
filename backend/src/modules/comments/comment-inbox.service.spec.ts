import { CommentPriority, Platform, Sentiment } from '@prisma/client';
import { CommentInboxService } from './comment-inbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_PAGE_SIZE } from './comments.constants';

function build(rows: Array<Record<string, unknown>>) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const count = jest.fn().mockResolvedValue(rows.length);
  const prisma = { comment: { findMany, count } } as unknown as PrismaService;
  const service = new CommentInboxService(prisma);
  return { service, findMany, count };
}

const ROW = {
  id: 'c-1',
  postId: 'post-1',
  platform: Platform.facebook,
  author: 'a',
  text: 't',
  sentiment: Sentiment.negative,
  sentimentSource: 'rule_based',
  priority: CommentPriority.complaint,
  slaDueAt: new Date('2026-07-19T00:00:00Z'),
  repliedAt: null,
  replyText: null,
  replyable: true,
  collectedAt: new Date('2026-07-18T00:00:00Z'),
};

describe('CommentInboxService.list', () => {
  const now = new Date('2026-07-19T12:00:00Z');

  it('ANDs enum filters into the where clause', async () => {
    const { service, findMany } = build([ROW]);
    await service.list(
      {
        platform: Platform.facebook,
        sentiment: Sentiment.negative,
        priority: CommentPriority.complaint,
      },
      now,
    );
    expect(findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({
        platform: Platform.facebook,
        sentiment: Sentiment.negative,
        priority: CommentPriority.complaint,
      }),
    );
  });

  it('translates slaBreach into "overdue AND unreplied"', async () => {
    const { service, findMany } = build([]);
    await service.list({ slaBreach: true }, now);
    expect(findMany.mock.calls[0][0].where).toEqual({ slaDueAt: { lt: now }, repliedAt: null });
  });

  it('caps pageSize at MAX_PAGE_SIZE (C9)', async () => {
    const { service, findMany } = build([]);
    await service.list({ pageSize: 10_000, page: 1 }, now);
    expect(findMany.mock.calls[0][0].take).toBe(MAX_PAGE_SIZE);
  });

  it('computes slaBreach on the response (overdue + unreplied)', async () => {
    const { service } = build([ROW]);
    const result = await service.list({}, now);
    expect(result.items[0].slaBreach).toBe(true); // slaDueAt < now, repliedAt null
  });
});

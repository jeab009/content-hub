import { CommentPriority, Platform, Sentiment, SentimentSource } from '@prisma/client';
import { CommentIngestionService } from './comment-ingestion.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { ConnectedAccountsService } from '../connected-accounts/connected-accounts.service';
import { PlatformAdapterRegistry } from '../publish/adapters/platform-adapter.registry';
import { CommentTriageService } from './comment-triage.service';
import { EscalationService } from './escalation.service';
import { SentimentClassifier } from './sentiment/sentiment-classifier.interface';

const SNAPSHOT = {
  externalCommentId: 'mock-facebook-post-1-0',
  author: 'สมชาย',
  authorExternalId: 'fb-user-a',
  text: 'บริการแย่มาก',
  createdAt: new Date('2026-07-19T00:00:00Z'),
  replyable: true,
};

function build(options: {
  posts: Array<{ id: string; platform: Platform }>;
  account?: unknown;
  fetchComments?: jest.Mock;
  createManyCount?: number;
}) {
  const createMany = jest.fn().mockResolvedValue({ count: options.createManyCount ?? 1 });
  const prisma = {
    post: { findMany: jest.fn().mockResolvedValue(options.posts) },
    connectedAccount: {
      findFirst: jest
        .fn()
        .mockResolvedValue('account' in options ? options.account : { id: 'acct-1' }),
    },
    comment: { createMany },
  } as unknown as PrismaService;

  const audit = { record: jest.fn() } as unknown as AuditLogService;
  const connectedAccounts = {
    getValidToken: jest.fn().mockResolvedValue('decrypted-token'),
  } as unknown as ConnectedAccountsService;

  const fetchComments = options.fetchComments ?? jest.fn().mockResolvedValue([SNAPSHOT]);
  const registry = {
    getFor: jest.fn().mockReturnValue({ fetchComments }),
  } as unknown as PlatformAdapterRegistry;

  const triage = {
    triage: jest.fn().mockReturnValue({
      priority: CommentPriority.complaint,
      slaDueAt: new Date('2026-07-19T04:00:00Z'),
    }),
  } as unknown as CommentTriageService;
  const escalation = {
    evaluate: jest.fn().mockResolvedValue(undefined),
  } as unknown as EscalationService;
  const classifier: SentimentClassifier = {
    classify: jest
      .fn()
      .mockResolvedValue({ sentiment: Sentiment.negative, source: SentimentSource.rule_based }),
  };

  const service = new CommentIngestionService(
    prisma,
    audit,
    connectedAccounts,
    registry,
    triage,
    escalation,
    classifier,
  );
  return { service, createMany, audit, escalation, fetchComments, classifier };
}

describe('CommentIngestionService.syncComments', () => {
  const userId = 'admin-1';

  it('classifies, triages, and dedup-inserts each snapshot', async () => {
    const { service, createMany, classifier } = build({
      posts: [{ id: 'post-1', platform: Platform.facebook }],
    });

    const result = await service.syncComments(userId);

    expect(result.synced).toBe(1);
    expect(result.inserted).toBe(1);
    expect(classifier.classify).toHaveBeenCalledWith('บริการแย่มาก');
    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: [
          expect.objectContaining({
            externalCommentId: 'mock-facebook-post-1-0',
            sentiment: Sentiment.negative,
            sentimentSource: SentimentSource.rule_based,
            priority: CommentPriority.complaint,
            slaDueAt: new Date('2026-07-19T04:00:00Z'),
            replyable: true,
          }),
        ],
      }),
    );
  });

  it('is a no-op on a duplicate external id (createMany skips → inserted 0)', async () => {
    const { service } = build({
      posts: [{ id: 'post-1', platform: Platform.facebook }],
      createManyCount: 0, // DB dedup skipped the row
    });

    const result = await service.syncComments(userId);

    expect(result.synced).toBe(1);
    expect(result.inserted).toBe(0);
  });

  it('isolates a per-post failure — one adapter error fails its post, not the batch', async () => {
    const fetchComments = jest
      .fn()
      .mockResolvedValueOnce([SNAPSHOT])
      .mockRejectedValueOnce(new Error('token_invalid'));
    const { service } = build({
      posts: [
        { id: 'post-ok', platform: Platform.youtube },
        { id: 'post-bad', platform: Platform.facebook },
      ],
      fetchComments,
    });

    const result = await service.syncComments(userId);

    expect(result.synced).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.items.find((i) => i.postId === 'post-bad')?.reason).toBe('token_invalid');
  });

  it('skips a post with no connected account (no throw)', async () => {
    const { service, createMany } = build({
      posts: [{ id: 'post-1', platform: Platform.facebook }],
      account: null,
    });

    const result = await service.syncComments(userId);

    expect(result.skipped).toBe(1);
    expect(result.items[0].reason).toBe('no_connected_account');
    expect(createMany).not.toHaveBeenCalled();
  });

  it('runs escalation once after the batch', async () => {
    const { service, escalation } = build({
      posts: [{ id: 'post-1', platform: Platform.facebook }],
    });

    await service.syncComments(userId);

    expect(escalation.evaluate).toHaveBeenCalledTimes(1);
  });

  it('guards against a concurrent in-flight sync (C6c)', async () => {
    const { service } = build({ posts: [{ id: 'post-1', platform: Platform.facebook }] });
    // Kick off two syncs on the same instance without awaiting the first.
    const first = service.syncComments(userId);
    await expect(service.syncComments(userId)).rejects.toThrow('already in progress');
    await first;
    // After the first completes the guard is released.
    await expect(service.syncComments(userId)).resolves.toBeDefined();
  });
});

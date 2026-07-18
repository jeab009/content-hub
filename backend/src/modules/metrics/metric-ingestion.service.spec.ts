import { Platform, PostStatus } from '@prisma/client';
import { MetricIngestionService } from './metric-ingestion.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { ConnectedAccountsService } from '../connected-accounts/connected-accounts.service';
import { PlatformAdapterRegistry } from '../publish/adapters/platform-adapter.registry';

describe('MetricIngestionService.syncApiMetrics', () => {
  const userId = 'admin-1';

  function build(options: {
    posts: Array<{ id: string; platform: Platform; status?: PostStatus }>;
    account: unknown;
    token?: Promise<string> | Error;
    fetchMetrics?: jest.Mock;
  }) {
    const metricCreate = jest.fn().mockResolvedValue({ id: 'm1' });
    const prisma = {
      post: { findMany: jest.fn().mockResolvedValue(options.posts) },
      connectedAccount: { findFirst: jest.fn().mockResolvedValue(options.account) },
      metric: { create: metricCreate },
    } as unknown as PrismaService;

    const audit = { record: jest.fn() } as unknown as AuditLogService;

    const connectedAccounts = {
      getValidToken: jest.fn().mockImplementation(() => {
        if (options.token instanceof Error) return Promise.reject(options.token);
        return options.token ?? Promise.resolve('decrypted-token');
      }),
    } as unknown as ConnectedAccountsService;

    const fetchMetrics =
      options.fetchMetrics ??
      jest.fn().mockResolvedValue({ reach: 1000, engagement: 50, revenue: 1.5 });
    const registry = {
      getFor: jest.fn().mockReturnValue({ fetchMetrics }),
    } as unknown as PlatformAdapterRegistry;

    const service = new MetricIngestionService(prisma, audit, connectedAccounts, registry);
    return { service, metricCreate, fetchMetrics };
  }

  it('appends an api metric row for each eligible post with a token', async () => {
    const { service, metricCreate } = build({
      posts: [{ id: 'post-1', platform: Platform.facebook }],
      account: { id: 'acct-1' },
    });

    const result = await service.syncApiMetrics(userId);

    expect(result.eligible).toBe(1);
    expect(result.synced).toBe(1);
    expect(metricCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ postId: 'post-1', source: 'api', reach: 1000 }),
      }),
    );
  });

  it('skips a post with no connected account (no throw)', async () => {
    const { service, metricCreate } = build({
      posts: [{ id: 'post-1', platform: Platform.facebook }],
      account: null,
    });

    const result = await service.syncApiMetrics(userId);

    expect(result.skipped).toBe(1);
    expect(result.synced).toBe(0);
    expect(result.items[0].reason).toBe('no_connected_account');
    expect(metricCreate).not.toHaveBeenCalled();
  });

  it('isolates a per-post failure — a stale token fails one post, not the batch', async () => {
    const fetchMetrics = jest
      .fn()
      .mockResolvedValueOnce({ reach: 10, engagement: 1, revenue: 0.1 })
      .mockRejectedValueOnce(new Error('token_invalid'));
    const { service } = build({
      posts: [
        { id: 'post-ok', platform: Platform.youtube },
        { id: 'post-bad', platform: Platform.facebook },
      ],
      account: { id: 'acct-1' },
      fetchMetrics,
    });

    const result = await service.syncApiMetrics(userId);

    expect(result.synced).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.items.find((i) => i.postId === 'post-bad')?.reason).toBe('token_invalid');
  });
});

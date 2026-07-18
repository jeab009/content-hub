import { AssetPlatform, PostStatus } from '@prisma/client';
import { PublishExecutionService } from './publish-execution.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { ConnectedAccountsService } from '../connected-accounts/connected-accounts.service';
import { PlatformAdapterRegistry } from './adapters/platform-adapter.registry';
import { PublisherAmbiguousError, PublisherRejectedError } from './adapters/publisher.errors';

const JOB = { postId: 'post-1', requestedBy: 'admin-1', connectedAccountId: 'acct-1' };

const draftPost = {
  id: 'post-1',
  status: PostStatus.draft,
  version: 0,
  selectedPlatform: AssetPlatform.facebook,
  content: { id: 'content-1', type: 'image', mediaUrl: '/uploads/x.png' },
};

describe('PublishExecutionService', () => {
  let prisma: {
    post: { findUnique: jest.Mock; updateMany: jest.Mock };
    connectedAccount: { findUnique: jest.Mock };
  };
  let connectedAccounts: { getValidToken: jest.Mock };
  let adapter: { publish: jest.Mock };
  let auditLog: { record: jest.Mock };
  let service: PublishExecutionService;

  beforeEach(() => {
    prisma = {
      post: {
        findUnique: jest.fn().mockResolvedValue(draftPost),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      connectedAccount: {
        findUnique: jest.fn().mockResolvedValue({ id: 'acct-1', platformAccountId: 'page-9' }),
      },
    };
    connectedAccounts = { getValidToken: jest.fn().mockResolvedValue('decrypted-token') };
    adapter = { publish: jest.fn().mockResolvedValue({ externalPostId: 'fb-post-42' }) };
    auditLog = { record: jest.fn() };

    service = new PublishExecutionService(
      prisma as unknown as PrismaService,
      connectedAccounts as unknown as ConnectedAccountsService,
      { getFor: jest.fn().mockReturnValue(adapter) } as unknown as PlatformAdapterRegistry,
      auditLog as unknown as AuditLogService,
    );
  });

  describe('idempotent claim (addendum §3 pre-write)', () => {
    it('claims via a conditional UPDATE on status IN (draft,failed) AND version', async () => {
      await service.execute(JOB);

      expect(prisma.post.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'post-1',
            status: { in: [PostStatus.draft, PostStatus.failed] },
            version: 0,
          },
          data: expect.objectContaining({
            status: PostStatus.scheduled,
            executedBy: 'admin-1',
            version: { increment: 1 },
          }),
        }),
      );
    });

    it('a job that loses the claim exits WITHOUT calling the platform — no double post ever', async () => {
      prisma.post.updateMany.mockResolvedValueOnce({ count: 0 }); // someone else claimed

      const outcome = await service.execute(JOB);

      expect(outcome).toBe('lost_claim');
      expect(adapter.publish).not.toHaveBeenCalled();
      expect(connectedAccounts.getValidToken).not.toHaveBeenCalled();
    });

    it('does nothing for a missing post', async () => {
      prisma.post.findUnique.mockResolvedValue(null);

      expect(await service.execute(JOB)).toBe('missing');
      expect(adapter.publish).not.toHaveBeenCalled();
    });
  });

  describe('outcome mapping', () => {
    it('success → posted with externalPostId, postedAt, executedBy, version bump', async () => {
      const outcome = await service.execute(JOB);

      expect(outcome).toBe('posted');
      const terminalWrite = prisma.post.updateMany.mock.calls[1][0] as {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      };
      expect(terminalWrite.where).toEqual({ id: 'post-1', version: 1 });
      expect(terminalWrite.data).toEqual(
        expect.objectContaining({
          status: PostStatus.posted,
          externalPostId: 'fb-post-42',
          executedBy: 'admin-1',
          version: { increment: 1 },
        }),
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'publish_succeeded' }),
      );
    });

    it('token failure (pre-dispatch) → failed, retryable, publish never called', async () => {
      connectedAccounts.getValidToken.mockRejectedValue(new Error('reconnect required'));

      const outcome = await service.execute(JOB);

      expect(outcome).toBe('failed');
      expect(adapter.publish).not.toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'publish_failed',
          meta: expect.objectContaining({ reason: 'token_invalid', retryable: true }),
        }),
      );
    });

    it('platform rejection (confirmed not posted) → failed', async () => {
      adapter.publish.mockRejectedValue(new PublisherRejectedError('HTTP 400'));

      const outcome = await service.execute(JOB);

      expect(outcome).toBe('failed');
      const failWrite = prisma.post.updateMany.mock.calls[1][0] as {
        data: Record<string, unknown>;
      };
      expect(failWrite.data.status).toBe(PostStatus.failed);
    });

    it('ambiguous error after dispatch → posted_unconfirmed, NEVER failed', async () => {
      adapter.publish.mockRejectedValue(new PublisherAmbiguousError('read timeout'));

      const outcome = await service.execute(JOB);

      expect(outcome).toBe('posted_unconfirmed');
      const write = prisma.post.updateMany.mock.calls[1][0] as { data: Record<string, unknown> };
      expect(write.data.status).toBe(PostStatus.posted_unconfirmed);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'publish_unconfirmed',
          meta: expect.objectContaining({ severity: 'ALERT', requiresManualVerification: true }),
        }),
      );
    });

    it('an UNKNOWN error type also maps to posted_unconfirmed (fail toward not double-posting)', async () => {
      adapter.publish.mockRejectedValue(new Error('something exotic'));

      expect(await service.execute(JOB)).toBe('posted_unconfirmed');
    });

    it('terminal write failure AFTER platform success → posted_unconfirmed carrying the known external id (REL-002)', async () => {
      prisma.post.updateMany
        .mockResolvedValueOnce({ count: 1 }) // claim succeeds
        .mockRejectedValueOnce(new Error('db connection lost')) // terminal write fails
        .mockResolvedValueOnce({ count: 1 }); // best-effort unconfirmed write

      const outcome = await service.execute(JOB);

      expect(outcome).toBe('posted_unconfirmed');
      const unconfirmedWrite = prisma.post.updateMany.mock.calls[2][0] as {
        data: Record<string, unknown>;
      };
      expect(unconfirmedWrite.data.status).toBe(PostStatus.posted_unconfirmed);
      expect(unconfirmedWrite.data.externalPostId).toBe('fb-post-42');
    });

    it('survives even the best-effort unconfirmed write failing (row left for monitoring)', async () => {
      adapter.publish.mockRejectedValue(new PublisherAmbiguousError('timeout'));
      prisma.post.updateMany
        .mockResolvedValueOnce({ count: 1 }) // claim
        .mockRejectedValueOnce(new Error('db still down')); // unconfirmed write also fails

      const outcome = await service.execute(JOB);

      expect(outcome).toBe('posted_unconfirmed');
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'publish_unconfirmed' }),
      );
    });
  });
});

import { ConflictException, NotFoundException } from '@nestjs/common';
import { PostStatus } from '@prisma/client';
import { PostResolutionService } from './post-resolution.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';

const unconfirmedPost = { id: 'post-1', status: PostStatus.posted_unconfirmed, version: 3 };

describe('PostResolutionService', () => {
  let prisma: {
    post: { findUnique: jest.Mock; updateMany: jest.Mock; findUniqueOrThrow: jest.Mock };
  };
  let auditLog: { record: jest.Mock };
  let service: PostResolutionService;

  beforeEach(() => {
    prisma = {
      post: {
        findUnique: jest.fn().mockResolvedValue(unconfirmedPost),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ ...unconfirmedPost, version: 4 }),
      },
    };
    auditLog = { record: jest.fn() };
    service = new PostResolutionService(
      prisma as unknown as PrismaService,
      auditLog as unknown as AuditLogService,
    );
  });

  it('resolveAsPosted writes posted + externalPostId + executedBy, conditionally on status+version', async () => {
    await service.resolveAsPosted('post-1', 'fb-live-123', 'admin-2');

    expect(prisma.post.updateMany).toHaveBeenCalledWith({
      where: { id: 'post-1', status: PostStatus.posted_unconfirmed, version: 3 },
      data: expect.objectContaining({
        status: PostStatus.posted,
        externalPostId: 'fb-live-123',
        executedBy: 'admin-2',
        version: { increment: 1 },
      }),
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'publish_ambiguity_resolved',
        meta: expect.objectContaining({
          direction: 'confirmed_posted',
          externalPostId: 'fb-live-123',
        }),
      }),
    );
  });

  it('resolveAsNotPosted re-enters the failed/retry path', async () => {
    await service.resolveAsNotPosted('post-1', 'admin-2');

    expect(prisma.post.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: PostStatus.failed, executedBy: 'admin-2' }),
      }),
    );
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ direction: 'confirmed_not_posted' }),
      }),
    );
  });

  it('rejects resolution of a post that is not posted_unconfirmed', async () => {
    prisma.post.findUnique.mockResolvedValue({ ...unconfirmedPost, status: PostStatus.posted });

    await expect(service.resolveAsPosted('post-1', 'x', 'admin-2')).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.post.updateMany).not.toHaveBeenCalled();
  });

  it('409s when a concurrent request already resolved the post (conditional write lost)', async () => {
    prisma.post.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.resolveAsNotPosted('post-1', 'admin-2')).rejects.toThrow(
      ConflictException,
    );
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('404s for a missing post', async () => {
    prisma.post.findUnique.mockResolvedValue(null);

    await expect(service.resolveAsPosted('missing', 'x', 'admin-2')).rejects.toThrow(
      NotFoundException,
    );
  });
});

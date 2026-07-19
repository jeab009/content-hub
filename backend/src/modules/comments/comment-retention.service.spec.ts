import { NotFoundException } from '@nestjs/common';
import { CommentPriority, Platform, Sentiment } from '@prisma/client';
import { CommentRetentionService } from './comment-retention.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';

function build(options: { deleteManyCount?: number; comment?: Record<string, unknown> | null }) {
  const deleteMany = jest.fn().mockResolvedValue({ count: options.deleteManyCount ?? 3 });
  const del = jest.fn().mockResolvedValue({});
  const findUnique = jest
    .fn()
    .mockResolvedValue(options.comment === undefined ? { id: 'c-1' } : options.comment);
  const prisma = {
    comment: { deleteMany, delete: del, findUnique },
  } as unknown as PrismaService;
  const audit = { record: jest.fn() } as unknown as AuditLogService;
  const service = new CommentRetentionService(prisma, audit);
  return { service, deleteMany, del, audit };
}

describe('CommentRetentionService', () => {
  it('bulk-purges comments older than 12 months and audits counts only', async () => {
    const now = new Date('2026-07-19T00:00:00Z');
    const { service, deleteMany, audit } = build({ deleteManyCount: 7 });

    const result = await service.purgeExpired('admin-1', now);

    expect(result.deletedCount).toBe(7);
    expect(result.cutoff).toEqual(new Date('2025-07-19T00:00:00Z'));
    expect(deleteMany).toHaveBeenCalledWith({
      where: { collectedAt: { lt: new Date('2025-07-19T00:00:00Z') } },
    });
    const entry = (audit.record as jest.Mock).mock.calls[0][0];
    expect(entry.action).toBe('comment_retention_purged');
    expect(entry.meta.deletedCount).toBe(7);
    // Counts only — no author/text keys.
    expect(entry.meta.author).toBeUndefined();
    expect(entry.meta.text).toBeUndefined();
  });

  it('erases a single comment on data-subject request and audits by reference (C2)', async () => {
    const { service, del, audit } = build({
      comment: {
        id: 'c-1',
        platform: Platform.facebook,
        author: 'สมชาย',
        text: 'ลบด้วยครับ',
        authorExternalId: 'fb-a',
        sentiment: Sentiment.neutral,
        priority: CommentPriority.general,
      },
    });

    await service.eraseOne('c-1', 'admin-1');

    expect(del).toHaveBeenCalledWith({ where: { id: 'c-1' } });
    const entry = (audit.record as jest.Mock).mock.calls[0][0];
    expect(entry.action).toBe('comment_erased');
    expect(entry.meta.authorRef).toEqual(expect.any(String));
    expect(JSON.stringify(entry.meta)).not.toContain('สมชาย');
  });

  it('404s erasing a missing comment', async () => {
    const { service } = build({ comment: null });
    await expect(service.eraseOne('missing', 'admin-1')).rejects.toThrow(NotFoundException);
  });
});

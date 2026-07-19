import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { CommentPriority, Platform, Sentiment } from '@prisma/client';
import { CommentReplyService } from './comment-reply.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { ConnectedAccountsService } from '../connected-accounts/connected-accounts.service';
import { PlatformAdapterRegistry } from '../publish/adapters/platform-adapter.registry';
import { StepUpAuthService } from '../publish/step-up-auth.service';
import { PublisherRejectedError } from '../publish/adapters/publisher.errors';

const COMMENT = {
  id: 'c-1',
  postId: 'post-1',
  platform: Platform.facebook,
  author: 'สมชาย ใจดี',
  text: 'บริการแย่มาก',
  authorExternalId: 'fb-user-a',
  sentiment: Sentiment.negative,
  sentimentSource: 'rule_based',
  priority: CommentPriority.complaint,
  slaDueAt: null,
  replyable: true,
  repliedAt: null,
  replyText: null,
  externalCommentId: 'ext-1',
  collectedAt: new Date('2026-07-18T00:00:00Z'),
};

function build(options: {
  comment?: Record<string, unknown> | null;
  claimCount?: number;
  stepUpRejects?: boolean;
  replyImpl?: jest.Mock;
}) {
  const comment = options.comment === undefined ? { ...COMMENT } : options.comment;
  const updateMany = jest.fn().mockResolvedValue({ count: options.claimCount ?? 1 });
  const update = jest.fn().mockImplementation(({ data }) => ({ ...COMMENT, ...data }));
  const prisma = {
    comment: {
      findUnique: jest.fn().mockResolvedValue(comment),
      updateMany,
      update,
    },
    post: { findUnique: jest.fn().mockResolvedValue({ id: 'post-1' }) },
    connectedAccount: { findFirst: jest.fn().mockResolvedValue({ id: 'acct-1' }) },
  } as unknown as PrismaService;

  const audit = { record: jest.fn() } as unknown as AuditLogService;
  const connectedAccounts = {
    getValidToken: jest.fn().mockResolvedValue('decrypted-token'),
  } as unknown as ConnectedAccountsService;

  const replyComment = options.replyImpl ?? jest.fn().mockResolvedValue({ replyExternalId: 'r-1' });
  const registry = {
    getFor: jest.fn().mockReturnValue({ replyComment }),
  } as unknown as PlatformAdapterRegistry;

  const stepUpAuth = {
    assertFreshPassword: jest.fn().mockImplementation(() => {
      if (options.stepUpRejects) return Promise.reject(new UnauthorizedException());
      return Promise.resolve();
    }),
  } as unknown as StepUpAuthService;

  const service = new CommentReplyService(prisma, audit, connectedAccounts, registry, stepUpAuth);
  return { service, prisma, audit, stepUpAuth, replyComment, updateMany };
}

const dto = { password: 'pw', message: 'ขออภัยครับ' };

describe('CommentReplyService.reply', () => {
  it('runs step-up with the reply-specific failure action (C4) before anything else', async () => {
    const { service, stepUpAuth } = build({ stepUpRejects: true });
    await expect(service.reply('c-1', dto, 'admin-1', '127.0.0.1')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(stepUpAuth.assertFreshPassword).toHaveBeenCalledWith(
      'admin-1',
      'pw',
      '127.0.0.1',
      'comment_reply_failed',
    );
  });

  it('replies, persists, and audits comment_reply_sent with PII-redacted meta (C1)', async () => {
    const { service, audit, replyComment } = build({});
    const result = await service.reply('c-1', dto, 'admin-1', '127.0.0.1');

    expect(replyComment).toHaveBeenCalledWith(
      expect.objectContaining({ externalCommentId: 'ext-1', message: 'ขออภัยครับ' }),
    );
    expect(result.replyText).toBe('ขออภัยครับ');
    const sent = (audit.record as jest.Mock).mock.calls.find(
      ([entry]) => entry.action === 'comment_reply_sent',
    );
    expect(sent).toBeDefined();
    const meta = sent[0].meta;
    // References only — raw author/text never in meta.
    expect(meta.authorRef).toEqual(expect.any(String));
    expect(meta.textLength).toBe(COMMENT.text.length);
    expect(JSON.stringify(meta)).not.toContain('สมชาย');
    expect(JSON.stringify(meta)).not.toContain('บริการแย่มาก');
  });

  it('rejects a non-replyable comment with 409 (server authoritative)', async () => {
    const { service } = build({ comment: { ...COMMENT, replyable: false } });
    await expect(service.reply('c-1', dto, 'admin-1')).rejects.toThrow(ConflictException);
  });

  it('rejects an already-replied comment with 409 before claiming', async () => {
    const { service, updateMany } = build({
      comment: { ...COMMENT, repliedAt: new Date() },
    });
    await expect(service.reply('c-1', dto, 'admin-1')).rejects.toThrow(ConflictException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('loses the idempotency race (claim count 0) → 409 (no double-reply)', async () => {
    const { service, replyComment } = build({ claimCount: 0 });
    await expect(service.reply('c-1', dto, 'admin-1')).rejects.toThrow(ConflictException);
    expect(replyComment).not.toHaveBeenCalled();
  });

  it('on dispatch failure: rolls back the claim and audits a MAPPED reason code (C7)', async () => {
    const replyImpl = jest
      .fn()
      .mockRejectedValue(new PublisherRejectedError('FB said: บริการแย่มาก'));
    const { service, audit, updateMany } = build({ replyImpl });

    await expect(service.reply('c-1', dto, 'admin-1')).rejects.toThrow(PublisherRejectedError);

    // Second updateMany call is the rollback (repliedAt/repliedBy -> null).
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls[1][0].data).toEqual({ repliedAt: null, repliedBy: null });

    const failed = (audit.record as jest.Mock).mock.calls.find(
      ([entry]) => entry.action === 'comment_reply_failed',
    );
    expect(failed[0].meta.reason).toBe('platform_rejected');
    // The raw upstream error text (which echoes the comment) is NOT logged.
    expect(JSON.stringify(failed[0].meta)).not.toContain('บริการแย่มาก');
  });
});

import { Logger } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { PrismaService } from '../../modules/prisma/prisma.service';

/**
 * Phase 5D.1 — the audit trail must survive a restart, and must not be able to
 * carry a secret into the database.
 */
describe('AuditLogService', () => {
  let create: jest.Mock;
  let service: AuditLogService;

  /** Lets the fire-and-forget persist() settle before assertions. */
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  beforeEach(() => {
    create = jest.fn().mockResolvedValue({ id: 'audit-1' });
    service = new AuditLogService({ auditLog: { create } } as unknown as PrismaService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('persistence', () => {
    it('writes a row for every entry, in addition to the stdout line', async () => {
      service.record({
        actor: 'admin-1',
        action: 'manual_external_post_recorded',
        result: 'success',
        ip: '10.0.0.9',
        meta: { postId: 'post-1' },
      });
      await flush();

      expect(create).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0][0].data).toMatchObject({
        actor: 'admin-1',
        action: 'manual_external_post_recorded',
        result: 'success',
        ip: '10.0.0.9',
        meta: { postId: 'post-1' },
      });
      // The stdout line is KEPT, not replaced.
      expect(Logger.prototype.log).toHaveBeenCalledTimes(1);
    });

    it('records failures too, on the warn channel', async () => {
      service.record({ actor: 'anonymous', action: 'auth.login.failure', result: 'failure' });
      await flush();

      expect(create.mock.calls[0][0].data).toMatchObject({
        action: 'auth.login.failure',
        result: 'failure',
      });
      expect(Logger.prototype.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('redaction applies to the PERSISTED row, not just the log line', () => {
    it('never lands a password, token or secret in the DB row', async () => {
      service.record({
        actor: 'admin-1',
        action: 'publish_attempt_started',
        result: 'success',
        meta: {
          password: 'hunter2',
          accessToken: 'EAAG-real-token',
          refresh_token: 'refresh-me',
          clientSecret: 'shhh',
          nested: { authorization: 'Bearer abc123', keep: 'visible' },
        },
      });
      await flush();

      const persisted = create.mock.calls[0][0].data.meta as Record<string, unknown>;
      expect(persisted).toEqual({
        password: '[REDACTED]',
        accessToken: '[REDACTED]',
        refresh_token: '[REDACTED]',
        clientSecret: '[REDACTED]',
        nested: { authorization: '[REDACTED]', keep: 'visible' },
      });

      // Byte-level guard: no secret VALUE appears anywhere in the row.
      const serialized = JSON.stringify(create.mock.calls[0][0].data);
      for (const secret of ['hunter2', 'EAAG-real-token', 'refresh-me', 'shhh', 'abc123']) {
        expect(serialized).not.toContain(secret);
      }
    });

    it('keeps Phase 4 comment PII rules: raw author/text masked, authorRef/textLength kept', async () => {
      service.record({
        actor: 'admin-1',
        action: 'comment_reply_sent',
        result: 'success',
        meta: {
          author: 'Somchai Jaidee',
          text: 'ราคาเท่าไหร่ครับ',
          authorRef: 'sha256:9f2b',
          textLength: 16,
        },
      });
      await flush();

      expect(create.mock.calls[0][0].data.meta).toEqual({
        author: '[REDACTED]',
        text: '[REDACTED]',
        authorRef: 'sha256:9f2b',
        textLength: 16,
      });
    });
  });

  describe('a failed audit write never breaks the audited operation', () => {
    it('does not throw, and does not reject, when the DB write fails', async () => {
      create.mockRejectedValue(new Error('connection terminated'));

      // record() is synchronous and returns void — a caller mid-publish gets
      // no error to handle and no promise to await.
      expect(() =>
        service.record({ actor: 'admin-1', action: 'publish_succeeded', result: 'success' }),
      ).not.toThrow();
      await flush();

      // ...but the loss is loud, so it can be alerted on.
      expect(Logger.prototype.error).toHaveBeenCalledTimes(1);
      expect((Logger.prototype.error as jest.Mock).mock.calls[0][0]).toContain('publish_succeeded');
    });

    it('the stdout line still happens even if the DB is down', async () => {
      create.mockRejectedValue(new Error('db down'));

      service.record({ actor: 'admin-1', action: 'report_exported', result: 'success' });
      await flush();

      expect(Logger.prototype.log).toHaveBeenCalledTimes(1);
    });

    it('a synchronous prisma throw is contained too', async () => {
      create.mockImplementation(() => {
        throw new Error('client not connected');
      });

      expect(() =>
        service.record({ actor: 'admin-1', action: 'content_created', result: 'success' }),
      ).not.toThrow();
      await flush();

      expect(Logger.prototype.error).toHaveBeenCalledTimes(1);
    });
  });
});

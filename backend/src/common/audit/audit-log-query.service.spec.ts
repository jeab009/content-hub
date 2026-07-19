import { AuditLogResult } from '@prisma/client';
import { AuditLogQueryService } from './audit-log-query.service';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { AUDIT_LOG_MAX_PAGE_SIZE } from './audit-log.constants';

describe('AuditLogQueryService', () => {
  let count: jest.Mock;
  let findMany: jest.Mock;
  let service: AuditLogQueryService;

  const row = {
    id: 'audit-1',
    timestamp: new Date('2026-07-19T15:32:00Z'),
    actor: 'admin-1',
    action: 'manual_external_post_recorded',
    result: AuditLogResult.success,
    ip: '10.0.0.9',
    meta: { postId: 'post-1', password: '[REDACTED]' },
    createdAt: new Date('2026-07-19T15:32:00Z'),
  };

  beforeEach(() => {
    count = jest.fn().mockResolvedValue(1);
    findMany = jest.fn().mockResolvedValue([row]);
    service = new AuditLogQueryService({
      auditLog: { count, findMany },
    } as unknown as PrismaService);
  });

  it('returns the row shape the admin UI needs, meta included as stored', async () => {
    const result = await service.list({});

    expect(result).toMatchObject({ page: 1, pageSize: 50, total: 1 });
    expect(result.items[0]).toEqual({
      id: 'audit-1',
      timestamp: row.timestamp,
      actor: 'admin-1',
      action: 'manual_external_post_recorded',
      result: AuditLogResult.success,
      ip: '10.0.0.9',
      // Already redacted at write time — the read path does not un-redact.
      meta: { postId: 'post-1', password: '[REDACTED]' },
    });
  });

  it('ANDs the action / actor / result filters', async () => {
    await service.list({
      action: 'report_exported',
      actor: 'admin-1',
      result: AuditLogResult.failure,
    });

    expect(findMany.mock.calls[0][0].where).toEqual({
      action: 'report_exported',
      actor: 'admin-1',
      result: AuditLogResult.failure,
    });
  });

  it('treats the date range as [from, to)', async () => {
    await service.list({ from: '2026-07-19T00:00:00Z', to: '2026-07-20T00:00:00Z' });

    expect(findMany.mock.calls[0][0].where.timestamp).toEqual({
      gte: new Date('2026-07-19T00:00:00Z'),
      lt: new Date('2026-07-20T00:00:00Z'),
    });
  });

  it('caps pageSize at the maximum even if a larger one slips past the DTO', async () => {
    const result = await service.list({ pageSize: 100_000 });

    expect(findMany.mock.calls[0][0].take).toBe(AUDIT_LOG_MAX_PAGE_SIZE);
    expect(result.pageSize).toBe(AUDIT_LOG_MAX_PAGE_SIZE);
  });

  it('paginates with a deterministic secondary sort key', async () => {
    await service.list({ page: 3, pageSize: 25 });

    expect(findMany.mock.calls[0][0]).toMatchObject({
      skip: 50,
      take: 25,
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
    });
  });

  it('counts against the same filter it lists with', async () => {
    await service.list({ action: 'auth.login.failure' });

    expect(count.mock.calls[0][0].where).toEqual(findMany.mock.calls[0][0].where);
  });
});

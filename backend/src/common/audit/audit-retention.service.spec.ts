import { PrismaService } from '../../modules/prisma/prisma.service';
import { AuditRetentionService } from './audit-retention.service';
import { AUDIT_ACTOR_ANONYMIZED } from './audit-log.constants';

function buildPrisma(count = 0) {
  const updateMany = jest.fn().mockResolvedValue({ count });
  return { updateMany, prisma: { auditLog: { updateMany } } };
}

describe('AuditRetentionService', () => {
  const NOW = new Date('2026-07-20T00:00:00.000Z');

  it('anonymizes 90 days back, not 12 months (audit is not comments)', () => {
    const { prisma } = buildPrisma();
    const service = new AuditRetentionService(prisma as unknown as PrismaService);

    expect(service.cutoffFrom(NOW).toISOString()).toBe('2026-04-21T00:00:00.000Z');
  });

  it('only touches actions whose actor is an attempted identifier', async () => {
    const { updateMany, prisma } = buildPrisma(3);
    const service = new AuditRetentionService(prisma as unknown as PrismaService);

    await service.anonymizeExpiredActors(NOW);

    const where = updateMany.mock.calls[0][0].where;
    expect(where.action.in).toEqual(['auth.login.failure']);
    // A successful login's actor is an internal user id, not personal data,
    // and is needed to attribute the action — it must never be scrubbed.
    expect(where.action.in).not.toContain('auth.login.success');
    expect(where.action.in).not.toContain('manual_external_post_recorded');
  });

  it('overwrites the identifier in place — it never deletes the row', async () => {
    const { updateMany, prisma } = buildPrisma(2);
    const service = new AuditRetentionService(prisma as unknown as PrismaService);

    await service.anonymizeExpiredActors(NOW);

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0].data).toEqual({ actor: AUDIT_ACTOR_ANONYMIZED });
    // No delete path exists on this service at all.
    expect((service as unknown as Record<string, unknown>).purge).toBeUndefined();
  });

  it('is idempotent — already-anonymized rows are excluded', async () => {
    const { updateMany, prisma } = buildPrisma(0);
    const service = new AuditRetentionService(prisma as unknown as PrismaService);

    const result = await service.anonymizeExpiredActors(NOW);

    expect(updateMany.mock.calls[0][0].where.actor).toEqual({ not: AUDIT_ACTOR_ANONYMIZED });
    expect(result.anonymizedCount).toBe(0);
  });

  it('leaves rows inside the window alone', async () => {
    const { updateMany, prisma } = buildPrisma(0);
    const service = new AuditRetentionService(prisma as unknown as PrismaService);

    await service.anonymizeExpiredActors(NOW);

    expect(updateMany.mock.calls[0][0].where.createdAt.lt).toEqual(
      new Date('2026-04-21T00:00:00.000Z'),
    );
  });
});

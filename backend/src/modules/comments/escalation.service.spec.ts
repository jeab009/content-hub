import { Prisma } from '@prisma/client';
import { EscalationService } from './escalation.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { ESCALATION_THRESHOLD } from './comments.constants';

function build(options: { negativeCount: number; createImpl?: jest.Mock }) {
  const create = options.createImpl ?? jest.fn().mockResolvedValue({ id: 'alert-1' });
  const prisma = {
    comment: { count: jest.fn().mockResolvedValue(options.negativeCount) },
    escalationAlert: { create },
  } as unknown as PrismaService;
  const audit = { record: jest.fn() } as unknown as AuditLogService;
  const service = new EscalationService(prisma, audit);
  return { service, create, audit };
}

describe('EscalationService.evaluate', () => {
  const now = new Date('2026-07-19T14:05:00Z');

  it('does nothing below threshold', async () => {
    const { service, create, audit } = build({ negativeCount: ESCALATION_THRESHOLD - 1 });
    await service.evaluate('admin-1', now);
    expect(create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('raises exactly one alert at/above threshold, bucketed to the hour', async () => {
    const { service, create, audit } = build({ negativeCount: ESCALATION_THRESHOLD });
    await service.evaluate('admin-1', now);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ruleKey: 'negative_spike',
          windowStart: new Date('2026-07-19T14:00:00Z'), // floored to the hour
          threshold: ESCALATION_THRESHOLD,
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'comment_escalation_raised', result: 'success' }),
    );
  });

  it('treats a duplicate-window insert (P2002) as an idempotent no-op — DB-enforced dedup', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('unique violation', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const create = jest.fn().mockRejectedValue(p2002);
    const { service, audit } = build({
      negativeCount: ESCALATION_THRESHOLD + 3,
      createImpl: create,
    });

    await expect(service.evaluate('admin-1', now)).resolves.toBeUndefined();
    // No alert audit line for the deduped no-op.
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rethrows a non-P2002 error', async () => {
    const create = jest.fn().mockRejectedValue(new Error('db down'));
    const { service } = build({ negativeCount: ESCALATION_THRESHOLD, createImpl: create });
    await expect(service.evaluate('admin-1', now)).rejects.toThrow('db down');
  });
});

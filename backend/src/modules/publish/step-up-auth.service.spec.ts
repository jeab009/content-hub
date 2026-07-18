import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { StepUpAuthService } from './step-up-auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';

describe('StepUpAuthService', () => {
  let prisma: { user: { findUnique: jest.Mock } };
  let auditLog: { record: jest.Mock };
  let service: StepUpAuthService;
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await argon2.hash('correct-horse-battery');
  });

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'admin-1', passwordHash }) },
    };
    auditLog = { record: jest.fn() };
    service = new StepUpAuthService(
      prisma as unknown as PrismaService,
      auditLog as unknown as AuditLogService,
    );
  });

  it('resolves silently for the correct password', async () => {
    await expect(
      service.assertFreshPassword('admin-1', 'correct-horse-battery', '127.0.0.1'),
    ).resolves.toBeUndefined();
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('rejects a wrong password and audit-logs the failure', async () => {
    await expect(
      service.assertFreshPassword('admin-1', 'wrong-password', '127.0.0.1'),
    ).rejects.toThrow(UnauthorizedException);

    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'admin-1',
        action: 'publish_attempt_started',
        result: 'failure',
        meta: { reason: 'step_up_reauth_failed' },
      }),
    );
  });

  it('rejects when the user row cannot be found (no oracle)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.assertFreshPassword('ghost', 'anything')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

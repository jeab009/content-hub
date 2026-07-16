import * as argon2 from 'argon2';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Covers the two mandatory security properties from the System Analyst
 * review: (1) login failure responses must be indistinguishable across
 * "no such user" / "wrong password" / "locked account", and (2) per-account
 * lockout after 5 consecutive failures.
 */
describe('AuthService', () => {
  const CORRECT_PASSWORD = 'correct-horse-battery-staple-42';
  const WRONG_PASSWORD = 'totally-wrong-password';
  let correctPasswordHash: string;

  let prisma: {
    user: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let auditLog: { record: jest.Mock };
  let authService: AuthService;

  beforeAll(async () => {
    correctPasswordHash = await argon2.hash(CORRECT_PASSWORD, { type: argon2.argon2id });
  });

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    auditLog = { record: jest.fn() };
    authService = new AuthService(
      prisma as unknown as PrismaService,
      auditLog as unknown as AuditLogService,
    );
  });

  function baseUser(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'user-1',
      email: 'admin@example.com',
      name: 'Admin',
      passwordHash: correctPasswordHash,
      failedLoginAttempts: 0,
      lockedUntil: null,
      role: 'admin',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  it('returns the user and resets failed attempts on correct credentials', async () => {
    prisma.user.findUnique.mockResolvedValue(baseUser({ failedLoginAttempts: 2 }));

    const result = await authService.validateCredentials(
      'admin@example.com',
      CORRECT_PASSWORD,
      '127.0.0.1',
    );

    expect(result).toEqual({ id: 'user-1', email: 'admin@example.com', name: 'Admin' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  });

  it('rejects a nonexistent user with the generic error', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      authService.validateCredentials('nobody@example.com', 'whatever', '127.0.0.1'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a wrong password with the generic error', async () => {
    prisma.user.findUnique.mockResolvedValue(baseUser());

    await expect(
      authService.validateCredentials('admin@example.com', WRONG_PASSWORD, '127.0.0.1'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a locked account with the generic error, even with the correct password', async () => {
    prisma.user.findUnique.mockResolvedValue(
      baseUser({ lockedUntil: new Date(Date.now() + 60_000) }),
    );

    await expect(
      authService.validateCredentials('admin@example.com', CORRECT_PASSWORD, '127.0.0.1'),
    ).rejects.toThrow(UnauthorizedException);
    // Locked accounts must not authenticate even on correct password, and
    // must not be "unlocked" early by a successful password check.
    expect(prisma.user.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ failedLoginAttempts: 0 }) }),
    );
  });

  it('produces byte-identical error messages across no-user / wrong-password / locked paths (no enumeration signal)', async () => {
    const errors: string[] = [];

    prisma.user.findUnique.mockResolvedValueOnce(null);
    try {
      await authService.validateCredentials('nobody@example.com', 'x', '127.0.0.1');
    } catch (error) {
      errors.push((error as UnauthorizedException).message);
    }

    prisma.user.findUnique.mockResolvedValueOnce(baseUser());
    try {
      await authService.validateCredentials('admin@example.com', WRONG_PASSWORD, '127.0.0.1');
    } catch (error) {
      errors.push((error as UnauthorizedException).message);
    }

    prisma.user.findUnique.mockResolvedValueOnce(
      baseUser({ lockedUntil: new Date(Date.now() + 60_000) }),
    );
    try {
      await authService.validateCredentials('admin@example.com', CORRECT_PASSWORD, '127.0.0.1');
    } catch (error) {
      errors.push((error as UnauthorizedException).message);
    }

    expect(errors).toHaveLength(3);
    expect(new Set(errors).size).toBe(1);
  });

  it('locks the account after the 5th consecutive failed attempt', async () => {
    prisma.user.findUnique.mockResolvedValue(baseUser({ failedLoginAttempts: 4 }));

    await expect(
      authService.validateCredentials('admin@example.com', WRONG_PASSWORD, '127.0.0.1'),
    ).rejects.toThrow(UnauthorizedException);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: expect.any(Date),
      },
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.account.locked' }),
    );
  });

  it('increments (but does not lock) before the 5th failure', async () => {
    prisma.user.findUnique.mockResolvedValue(baseUser({ failedLoginAttempts: 1 }));

    await expect(
      authService.validateCredentials('admin@example.com', WRONG_PASSWORD, '127.0.0.1'),
    ).rejects.toThrow(UnauthorizedException);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { failedLoginAttempts: 2, lockedUntil: null },
    });
  });
});

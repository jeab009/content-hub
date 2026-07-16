import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

/**
 * A pre-computed Argon2id hash of a value nobody will ever type, used so
 * that "user not found" takes the same code path (an argon2.verify call) as
 * "user found, wrong password" — otherwise the not-found path would return
 * near-instantly while the found path spends tens of milliseconds hashing,
 * a timing side-channel that would let an attacker enumerate valid emails.
 * Generated once via `argon2.hash(crypto.randomUUID())`.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$L2NxYm5jUkZzeVFQRnBTRQ$0GhO4E5vX4b0z2m8qv2mCFvVe0hZ8p8yv1Q3F1F1F1E';

const GENERIC_LOGIN_ERROR = 'Invalid email or password';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Validates credentials with an indistinguishable failure response
   * (security decision #3): "no such user", "wrong password", and "locked"
   * all throw the exact same UnauthorizedException, and the password hash
   * comparison always runs first (even for a nonexistent user, against a
   * dummy hash) so lockout state can never be inferred from timing before
   * the password check completes.
   *
   * Does NOT touch the session — the controller is responsible for session
   * regeneration on success (security decision #1), because that requires
   * the live `req` object this service intentionally has no dependency on.
   */
  async validateCredentials(
    email: string,
    password: string,
    ip: string,
  ): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const hashToVerify = user?.passwordHash ?? DUMMY_HASH;

    const passwordMatches = await argon2.verify(hashToVerify, password).catch(() => false);

    if (!user) {
      this.auditLog.record({
        actor: email,
        action: 'auth.login.failure',
        result: 'failure',
        ip,
        meta: { reason: 'no_such_user' },
      });
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    const isLocked = Boolean(user.lockedUntil && user.lockedUntil.getTime() > Date.now());
    if (isLocked) {
      this.auditLog.record({
        actor: user.id,
        action: 'auth.login.failure',
        result: 'failure',
        ip,
        meta: { reason: 'account_locked' },
      });
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    if (!passwordMatches) {
      await this.registerFailedAttempt(user, ip);
      this.auditLog.record({
        actor: user.id,
        action: 'auth.login.failure',
        result: 'failure',
        ip,
        meta: { reason: 'bad_password' },
      });
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    await this.resetFailedAttempts(user.id);
    this.auditLog.record({ actor: user.id, action: 'auth.login.success', result: 'success', ip });

    return { id: user.id, email: user.email, name: user.name };
  }

  private async registerFailedAttempt(user: User, ip: string): Promise<void> {
    const newAttemptCount = user.failedLoginAttempts + 1;
    const shouldLock = newAttemptCount >= MAX_FAILED_ATTEMPTS;

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: shouldLock ? 0 : newAttemptCount,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_DURATION_MS) : user.lockedUntil,
      },
    });

    if (shouldLock) {
      this.auditLog.record({
        actor: user.id,
        action: 'auth.account.locked',
        result: 'failure',
        ip,
        meta: { lockoutDurationMs: LOCKOUT_DURATION_MS },
      });
    }
  }

  private async resetFailedAttempts(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  }
}

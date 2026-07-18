import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';

const GENERIC_STEP_UP_ERROR =
  'Publish confirmation requires your password (step-up re-auth failed)';

/**
 * Step-up re-authentication for publish confirmation (System Analyst hard
 * constraint: publish requires fresh authentication, an active session is
 * not enough). The publish request body carries a `password` field which is
 * verified here against the admin's stored Argon2id hash — the same
 * argon2.verify primitive AuthService.validateCredentials uses.
 *
 * DOCUMENTED CHOICE (password-per-request over a session-freshness window):
 * a freshness window would make the Nth publish inside the window a
 * one-click action, which contradicts "publish NEVER automatic — every
 * publish is an explicit, individually confirmed human decision". Kept as
 * its own small service (rather than extending AuthService) so login
 * lockout semantics stay untouched; brute-force protection here comes from
 * the ThrottlerGuard on the publish endpoints instead, and every failure
 * is audit-logged.
 */
@Injectable()
export class StepUpAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Throws UnauthorizedException (and audit-logs) unless `password` matches the user's hash. */
  async assertFreshPassword(userId: string, password: string, ip?: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const passwordMatches = user
      ? await argon2.verify(user.passwordHash, password).catch(() => false)
      : false;

    if (!passwordMatches) {
      this.auditLog.record({
        actor: userId,
        action: 'publish_attempt_started',
        result: 'failure',
        ip,
        meta: { reason: 'step_up_reauth_failed' },
      });
      throw new UnauthorizedException(GENERIC_STEP_UP_ERROR);
    }
  }
}

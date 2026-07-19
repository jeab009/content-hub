import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../modules/prisma/prisma.service';
import {
  AUDIT_ACTIONS_WITH_ATTEMPTED_IDENTIFIER,
  AUDIT_ACTOR_ANONYMIZE_AFTER_DAYS,
  AUDIT_ACTOR_ANONYMIZED,
} from './audit-log.constants';

/**
 * Audit retention (admin decision, 2026-07-20).
 *
 * Unlike comment retention, this service NEVER deletes a row. Audit rows are
 * the compliance record that justifies the copyright gate on the
 * manual-external path, and a dispute can surface years later — so the trail
 * is permanent.
 *
 * What expires is the one piece of personal data in the table: the `actor` of
 * a FAILED login, which is whatever address the person typed and may not even
 * belong to one of our users. After the window it is overwritten in place, so
 * the row still proves "a failed login happened at this time" without naming
 * anyone.
 */
@Injectable()
export class AuditRetentionService {
  private readonly logger = new Logger(AuditRetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Cutoff for the current run — anything logged before this is anonymized. */
  cutoffFrom(now: Date): Date {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - AUDIT_ACTOR_ANONYMIZE_AFTER_DAYS);
    return cutoff;
  }

  /**
   * Overwrites expired attempted identifiers. Idempotent: rows already carrying
   * the placeholder are excluded, so re-running changes nothing.
   */
  async anonymizeExpiredActors(now: Date = new Date()): Promise<{
    anonymizedCount: number;
    cutoff: Date;
  }> {
    const cutoff = this.cutoffFrom(now);

    const result = await this.prisma.auditLog.updateMany({
      where: {
        action: { in: [...AUDIT_ACTIONS_WITH_ATTEMPTED_IDENTIFIER] },
        createdAt: { lt: cutoff },
        actor: { not: AUDIT_ACTOR_ANONYMIZED },
      },
      data: { actor: AUDIT_ACTOR_ANONYMIZED },
    });

    if (result.count > 0) {
      this.logger.log(
        `Audit retention: anonymized ${result.count} attempted identifier(s) older than ${AUDIT_ACTOR_ANONYMIZE_AFTER_DAYS} days.`,
      );
    }

    return { anonymizedCount: result.count, cutoff };
  }
}

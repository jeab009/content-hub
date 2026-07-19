import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Sentiment } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { EscalationAlertResponseDto, ListEscalationsQueryDto } from './dto/escalation-alert.dto';
import {
  ESCALATION_RULE_KEY,
  ESCALATION_THRESHOLD,
  ESCALATION_WINDOW_MINUTES,
} from './comments.constants';

/**
 * Negative-sentiment spike escalation (capability f) with DB-ENFORCED dedup.
 *
 * Trigger: count negative comments whose `collectedAt` falls in the rolling
 * window `[now - WINDOW, now]`. If `count >= THRESHOLD`, a spike is active.
 *
 * Dedup: the ledger's `(ruleKey, windowStart)` UNIQUE guarantees exactly one
 * alert per rule per hourly bucket even under concurrent syncs — the P2002 on
 * a duplicate insert is caught and treated as an idempotent no-op (QA-OBS-1:
 * an app-layer "have I alerted?" check is NOT trusted alone). See C5 in
 * comments.constants for the window-vs-bucket cadence reasoning.
 */
@Injectable()
export class EscalationService {
  private readonly logger = new Logger(EscalationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async evaluate(actor: string, now: Date = new Date()): Promise<void> {
    const windowStartRolling = new Date(now.getTime() - ESCALATION_WINDOW_MINUTES * 60 * 1000);
    const negativeCount = await this.prisma.comment.count({
      where: { sentiment: Sentiment.negative, collectedAt: { gte: windowStartRolling, lte: now } },
    });

    if (negativeCount < ESCALATION_THRESHOLD) {
      return;
    }

    const bucketStart = floorToHour(now);
    try {
      await this.prisma.escalationAlert.create({
        data: {
          ruleKey: ESCALATION_RULE_KEY,
          windowStart: bucketStart,
          windowEnd: now,
          negativeCount,
          threshold: ESCALATION_THRESHOLD,
        },
      });
      this.auditLog.record({
        actor,
        action: 'comment_escalation_raised',
        result: 'success',
        // Counts only — no author/text.
        meta: {
          windowStart: bucketStart.toISOString(),
          negativeCount,
          threshold: ESCALATION_THRESHOLD,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // This bucket already alerted — DB-enforced dedup, idempotent no-op.
        this.logger.debug(`Escalation already raised for bucket ${bucketStart.toISOString()}`);
        return;
      }
      throw error;
    }
  }

  async list(query: ListEscalationsQueryDto): Promise<EscalationAlertResponseDto[]> {
    const alerts = await this.prisma.escalationAlert.findMany({
      where: query.active ? { acknowledgedAt: null } : undefined,
      orderBy: { raisedAt: 'desc' },
      take: 100,
    });
    return alerts.map(EscalationAlertResponseDto.fromEntity);
  }

  /** Soft-acknowledge — dismiss WITHOUT deleting (a deleted row would let the bucket re-fire). */
  async acknowledge(id: string): Promise<EscalationAlertResponseDto> {
    const alert = await this.prisma.escalationAlert.update({
      where: { id },
      data: { acknowledgedAt: new Date() },
    });
    return EscalationAlertResponseDto.fromEntity(alert);
  }
}

/** Floors a timestamp to the top of its hour — the stable dedup bucket key. */
function floorToHour(date: Date): Date {
  const floored = new Date(date);
  floored.setMinutes(0, 0, 0);
  return floored;
}

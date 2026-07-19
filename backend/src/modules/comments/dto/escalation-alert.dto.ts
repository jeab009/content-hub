import { EscalationAlert } from '@prisma/client';
import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class EscalationAlertResponseDto {
  id!: string;
  ruleKey!: string;
  windowStart!: Date;
  windowEnd!: Date;
  negativeCount!: number;
  threshold!: number;
  raisedAt!: Date;
  acknowledgedAt!: Date | null;

  static fromEntity(alert: EscalationAlert): EscalationAlertResponseDto {
    return {
      id: alert.id,
      ruleKey: alert.ruleKey,
      windowStart: alert.windowStart,
      windowEnd: alert.windowEnd,
      negativeCount: alert.negativeCount,
      threshold: alert.threshold,
      raisedAt: alert.raisedAt,
      acknowledgedAt: alert.acknowledgedAt,
    };
  }
}

function toBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
}

export class ListEscalationsQueryDto {
  /** When true, only unacknowledged alerts (the inbox banner surface). */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;
}

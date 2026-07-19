import { AuditLog, AuditLogResult, Prisma } from '@prisma/client';

/**
 * One audit row as returned to an admin.
 *
 * There is deliberately NO extra redaction step here. `meta` was redacted by
 * redactSensitive() before it was ever written (AuditLogService.record), so
 * the stored value is already the safe value — the row cannot contain a
 * password, token or raw comment PII to leak. Re-redacting on read would
 * imply the stored data is untrusted and would quietly hide a write-path
 * regression instead of failing the write-path test that guards it.
 */
export class AuditLogResponseDto {
  id!: string;
  timestamp!: Date;
  actor!: string | null;
  action!: string;
  result!: AuditLogResult;
  ip!: string | null;
  meta!: Prisma.JsonValue | null;

  static fromEntity(row: AuditLog): AuditLogResponseDto {
    return {
      id: row.id,
      timestamp: row.timestamp,
      actor: row.actor,
      action: row.action,
      result: row.result,
      ip: row.ip,
      meta: row.meta,
    };
  }
}

export interface PaginatedAuditLogsDto {
  items: AuditLogResponseDto[];
  page: number;
  pageSize: number;
  total: number;
}

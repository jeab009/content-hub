import { AuditLogResult } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AUDIT_LOG_MAX_PAGE_SIZE } from '../audit-log.constants';

/**
 * Audit-trail filters (all optional, ANDed). Mirrors ListCommentsQueryDto:
 * `pageSize` is capped so an unbounded page can't be used as a query-DoS
 * (System Analyst condition C9).
 *
 * `action` is a plain string, matched exactly, because the AuditAction union
 * lives in TypeScript rather than in a Prisma enum (see the AuditLog model
 * comment). MaxLength keeps an absurd filter value out of the query.
 */
export class ListAuditLogsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  actor?: string;

  @IsOptional()
  @IsEnum(AuditLogResult)
  result?: AuditLogResult;

  /** Inclusive lower bound on `timestamp` (ISO 8601). */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** Exclusive upper bound on `timestamp` (ISO 8601). */
  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(AUDIT_LOG_MAX_PAGE_SIZE)
  pageSize?: number;
}

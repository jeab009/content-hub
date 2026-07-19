import { CommentPriority, Platform, Sentiment } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { MAX_PAGE_SIZE } from '../comments.constants';

/** Coerce the string query values 'true'/'false' into booleans. */
function toBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
}

/**
 * Inbox filters (all optional, ANDed). `pageSize` is capped at MAX_PAGE_SIZE
 * (System Analyst condition C9 — an unbounded page size is a query-DoS and a
 * large PII payload).
 */
export class ListCommentsQueryDto {
  @IsOptional()
  @IsEnum(Platform)
  platform?: Platform;

  @IsOptional()
  @IsEnum(Sentiment)
  sentiment?: Sentiment;

  @IsOptional()
  @IsEnum(CommentPriority)
  priority?: CommentPriority;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  slaBreach?: boolean;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  replied?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;
}

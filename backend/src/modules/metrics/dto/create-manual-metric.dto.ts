import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * Body of POST /api/posts/:id/metrics — a manual metric reading for
 * platforms without an API (TikTok / LINE OA), or a correction/backfill.
 * Metrics are APPEND-ONLY (System Analyst condition #3): this always
 * inserts a new row with source=manual, never updates an existing one.
 */
export class CreateManualMetricDto {
  @IsInt()
  @Min(0)
  reach!: number;

  @IsInt()
  @Min(0)
  engagement!: number;

  // Currency major units (THB), 2 dp. Capped well above any realistic
  // single-post payout to reject fat-finger entries.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  @Type(() => Number)
  revenue!: number;

  /** When the reading was taken. Defaults to now if omitted. */
  @IsOptional()
  @IsISO8601()
  collectedAt?: string;
}

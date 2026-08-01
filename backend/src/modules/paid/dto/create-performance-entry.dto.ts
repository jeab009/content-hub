import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PAID_SOURCE_REF_MAX_LENGTH, PAID_SOURCE_REF_PATTERN } from '../paid.constants';

const MAX_COUNT = 1_000_000_000;
const MAX_MONEY_AMOUNT = 99_999_999.99;
const RESULT_TYPE_MAX_LENGTH = 50;

/**
 * Body of POST /api/paid/campaigns/:id/performance-entries (design §3.4) —
 * APPEND-ONLY. `spend` is NEVER negative — ad spend has no real-world
 * refund/reversal event the way a commission chargeback does (System
 * Analyst SA-P2); a correction is always a NEW row naming the row it
 * corrects via `correctsEntryId`, not a signed-amount ledger. There is no
 * PATCH/DELETE route to edit or remove a row (proved by a route-absence
 * test). `currency`, `source`, `recordedBy` are otherwise set/defaulted
 * server-side.
 */
export class CreatePerformanceEntryDto {
  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;

  /** NEGATIVE IS NOT LEGAL — see the class docblock and SA-P2. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_MONEY_AMOUNT)
  spend!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_COUNT)
  reach?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_COUNT)
  impressions?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_COUNT)
  clicks?: number;

  @IsOptional()
  @IsString()
  @MaxLength(RESULT_TYPE_MAX_LENGTH)
  resultType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_COUNT)
  resultCount?: number;

  /** Defaults to THB in the service. THB is the only accepted value in v1 (SA-P6). */
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsUUID()
  correctsEntryId?: string;

  /**
   * PDPA: business reference only — "which Ads Manager screen this came
   * from," never audience/targeting/individual-level detail. This decorator
   * is the REDUNDANT second layer; the primary enforcement is
   * `assertPaidSourceRefShape`, called explicitly in the service (System
   * Analyst condition P-A1), so any future adapter-fed path (7D) is also
   * covered.
   */
  @IsOptional()
  @IsString()
  @MaxLength(PAID_SOURCE_REF_MAX_LENGTH)
  @Matches(PAID_SOURCE_REF_PATTERN, {
    message:
      'sourceRef accepts letters, digits and . _ - / only (no spaces) — never audience, buyer, ' +
      'or individual-recipient detail.',
  })
  sourceRef?: string;
}

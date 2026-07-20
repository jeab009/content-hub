import { CommerceChannel } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  COMMERCE_STATEMENT_REF_MAX_LENGTH,
  COMMERCE_STATEMENT_REF_PATTERN,
} from '../commerce.constants';

const MAX_COUNT = 1_000_000_000;
const MAX_MONEY_AMOUNT = 99_999_999.99;
const MIN_MONEY_AMOUNT = -99_999_999.99;

/**
 * Body of POST /api/commerce/conversions (6A.7) — APPEND-ONLY. A refund or
 * cancelled order is a NEW row with a negative `commissionAmount`,
 * optionally naming the row it reverses via `reversalOfId`; there is no
 * PATCH/DELETE route to edit or remove a row (proved by a route-absence
 * test). `currency` is deliberately absent — v1 accepts THB only and the
 * service writes it, so there is nothing here for a client to get wrong.
 *
 * `status`, `source`, `recordedBy` are set server-side. The global
 * ValidationPipe's forbidNonWhitelisted rejects any attempt to smuggle
 * them in.
 */
export class CreateConversionDto {
  @IsEnum(CommerceChannel)
  channel!: CommerceChannel;

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_COUNT)
  ordersCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_COUNT)
  itemsSold?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_MONEY_AMOUNT)
  grossSalesAmount?: number;

  /** NEGATIVE IS LEGAL — a refund/reversal is a new row, never an edit. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(MIN_MONEY_AMOUNT)
  @Max(MAX_MONEY_AMOUNT)
  commissionAmount!: number;

  @IsOptional()
  @IsUUID()
  postId?: string;

  @IsOptional()
  @IsUUID()
  placementId?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  affiliateLinkId?: string;

  @IsOptional()
  @IsUUID()
  reversalOfId?: string;

  /**
   * Payout-statement reference for human reconciliation. PDPA: business
   * reference only — the redundant DTO-layer copy of
   * `assertStatementRefShape` (the SERVICE enforcement is primary; see
   * commerce-statement-ref.util.ts / QA-1).
   */
  @IsOptional()
  @IsString()
  @MaxLength(COMMERCE_STATEMENT_REF_MAX_LENGTH)
  @Matches(COMMERCE_STATEMENT_REF_PATTERN, {
    message:
      'statementRef accepts letters, digits and . _ - / only (no spaces) — never buyer or order details.',
  })
  statementRef?: string;
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CommerceConversion, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { assertStatementRefShape } from './commerce-statement-ref.util';
import {
  COMMERCE_CONVERSION_IDEMPOTENCY_WINDOW_MS,
  COMMERCE_DEFAULT_CURRENCY,
} from './commerce.constants';
import { CreateConversionDto } from './dto/create-conversion.dto';
import { ListConversionsQueryDto } from './dto/list-conversions-query.dto';
import { OverlapCheckQueryDto } from './dto/overlap-check-query.dto';

/**
 * Conversions (6A.7) — APPEND-ONLY. `POST` adds a row; `GET` reads history.
 * There is deliberately NO update/remove method here and no PATCH/DELETE
 * route on the controller — a route-absence HTTP test proves it. A refund
 * or cancelled order is always a NEW row with a negative
 * `commissionAmount`, optionally naming the row it reverses.
 */
@Injectable()
export class CommerceConversionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async create(dto: CreateConversionDto, userId: string): Promise<CommerceConversion> {
    // QA-1: enforced HERE, in the service — not only the DTO's redundant
    // @Matches — so the rule also covers any future adapter-fed path.
    assertStatementRefShape(dto.statementRef);

    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    // M-4 (pre-production security review #2): the third occurrence of the
    // BUG-7A-01/BUG-7B-01 defect class — a date-range field pair validated
    // only by the DB CHECK (commerce_conversions_period_chk), with no
    // application-layer guard, so a backwards period reached Postgres and
    // came back as a raw 500 instead of a clean 400. Mirrors
    // PaidPerformanceService.assertValidPeriodRange exactly (both dates
    // required, no partial-update case here since this is create-only).
    this.assertValidPeriodRange(periodStart, periodEnd);

    await this.assertNotDuplicateWithinWindow(dto, userId);

    const reversalOf = await this.loadAndValidateReversalTarget(dto);

    // BUG-QA-6A-01: the per-content summary (commerce-read.service.ts) finds
    // conversions by `placementId IN (...) OR postId IN (...)` derived from the
    // content's own placements/posts — it never looks at reversalOfId. A
    // reversal that omitted or mismatched these fields still netted correctly
    // in the GLOBAL summary, but silently dropped out of the PER-CONTENT one,
    // leaving that view showing an inflated total until someone noticed.
    //
    // A reversal's linkage is never a new fact the client is choosing — it is
    // the same transaction the target already recorded, seen from the other
    // side. So when reversalOfId is set, inherit postId/placementId/
    // productId/affiliateLinkId from the target row and ignore whatever the
    // client sent for them, the same "server recomputes, client can't
    // override" rule this codebase already applies to Post.wasOverride.
    const linkage = reversalOf
      ? {
          postId: reversalOf.postId,
          placementId: reversalOf.placementId,
          productId: reversalOf.productId,
          affiliateLinkId: reversalOf.affiliateLinkId,
        }
      : {
          postId: dto.postId ?? null,
          placementId: dto.placementId ?? null,
          productId: dto.productId ?? null,
          affiliateLinkId: dto.affiliateLinkId ?? null,
        };

    const conversion = await this.prisma.commerceConversion.create({
      data: {
        channel: dto.channel,
        periodStart,
        periodEnd,
        ordersCount: dto.ordersCount ?? null,
        itemsSold: dto.itemsSold ?? null,
        grossSalesAmount:
          dto.grossSalesAmount !== undefined ? new Prisma.Decimal(dto.grossSalesAmount) : null,
        commissionAmount: new Prisma.Decimal(dto.commissionAmount),
        currency: COMMERCE_DEFAULT_CURRENCY,
        ...linkage,
        statementRef: dto.statementRef ?? null,
        reversalOfId: reversalOf?.id ?? null,
        recordedBy: userId,
      },
    });

    this.auditLog.record({
      actor: userId,
      action: 'commerce_conversion_added',
      result: 'success',
      // statementRef is EXCLUDED (System Analyst SA-4 exclusion list — the
      // single highest-residual-PII field in the schema).
      meta: {
        conversionId: conversion.id,
        channel: conversion.channel,
        commissionAmount: dto.commissionAmount,
        isReversal: reversalOf !== null,
      },
    });

    return conversion;
  }

  async list(query: ListConversionsQueryDto): Promise<CommerceConversion[]> {
    const where: Prisma.CommerceConversionWhereInput = {
      ...(query.channel && { channel: query.channel }),
      ...(query.productId && { productId: query.productId }),
      ...(query.placementId && { placementId: query.placementId }),
      ...(query.postId && { postId: query.postId }),
    };
    // Newest first — append-only history, per the endpoint's design contract.
    return this.prisma.commerceConversion.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  /**
   * Warn-only overlap probe for the entry form (R8's mitigation, which the
   * design correctly notes does NOT catch a double-submit — see
   * `assertNotDuplicateWithinWindow` for that). Never throws.
   */
  async checkOverlap(query: OverlapCheckQueryDto): Promise<CommerceConversion[]> {
    return this.prisma.commerceConversion.findMany({
      where: {
        channel: query.channel,
        periodStart: { lte: new Date(query.periodEnd) },
        periodEnd: { gte: new Date(query.periodStart) },
      },
      orderBy: { periodStart: 'asc' },
    });
  }

  /**
   * M-4: reject `periodEnd < periodStart` with a clean 400 before it ever
   * reaches the DB CHECK (`commerce_conversions_period_chk`). Both dates are
   * always required on this DTO, so equality is the only permitted edge —
   * same shape as `PaidPerformanceService.assertValidPeriodRange`.
   */
  private assertValidPeriodRange(periodStart: Date, periodEnd: Date): void {
    if (periodEnd < periodStart) {
      throw new BadRequestException(
        `periodEnd (${periodEnd.toISOString().slice(0, 10)}) must not be before periodStart ` +
          `(${periodStart.toISOString().slice(0, 10)}).`,
      );
    }
  }

  /**
   * System Analyst condition C6: the real double-submit trigger is a
   * byte-identical retry, not a genuinely new statement line for the same
   * period. Reject it with 409 rather than silently appending a second row
   * that only a compensating negative entry could ever correct.
   */
  private async assertNotDuplicateWithinWindow(
    dto: CreateConversionDto,
    userId: string,
  ): Promise<void> {
    const since = new Date(Date.now() - COMMERCE_CONVERSION_IDEMPOTENCY_WINDOW_MS);
    const duplicate = await this.prisma.commerceConversion.findFirst({
      where: {
        recordedBy: userId,
        createdAt: { gte: since },
        channel: dto.channel,
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
        commissionAmount: new Prisma.Decimal(dto.commissionAmount),
        ordersCount: dto.ordersCount ?? null,
        itemsSold: dto.itemsSold ?? null,
        postId: dto.postId ?? null,
        placementId: dto.placementId ?? null,
        productId: dto.productId ?? null,
        affiliateLinkId: dto.affiliateLinkId ?? null,
        statementRef: dto.statementRef ?? null,
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new ConflictException(
        `An identical conversion was already recorded ${COMMERCE_CONVERSION_IDEMPOTENCY_WINDOW_MS / 1000}s ` +
          `ago (id ${duplicate.id}). If this is a genuinely new line, wait a moment and resubmit.`,
      );
    }
  }

  /**
   * SA-2: a reversal must point at a row that exists and share its channel
   * and currency — a reversal pointing at a different channel is meaningless
   * data that the summary would then net across streams. `reversalOfId <> id`
   * itself is enforced by the DB CHECK (6.0.2); it is structurally
   * unreachable from this create path anyway, since `id` does not exist
   * until after the insert.
   */
  private async loadAndValidateReversalTarget(
    dto: CreateConversionDto,
  ): Promise<CommerceConversion | null> {
    if (!dto.reversalOfId) {
      return null;
    }

    const target = await this.prisma.commerceConversion.findUnique({
      where: { id: dto.reversalOfId },
    });
    if (!target) {
      throw new NotFoundException('The conversion this row reverses was not found');
    }
    if (target.channel !== dto.channel) {
      throw new BadRequestException(
        `reversalOfId ${dto.reversalOfId} is on channel "${target.channel}", not "${dto.channel}" — ` +
          'a reversal must be on the same channel as the row it reverses.',
      );
    }
    if (target.currency !== COMMERCE_DEFAULT_CURRENCY) {
      throw new BadRequestException(
        `reversalOfId ${dto.reversalOfId} carries currency "${target.currency}", which this ` +
          'reversal cannot match.',
      );
    }
    return target;
  }
}

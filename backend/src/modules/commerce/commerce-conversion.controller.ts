import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { CommerceConversionService } from './commerce-conversion.service';
import { CreateConversionDto } from './dto/create-conversion.dto';
import { ListConversionsQueryDto } from './dto/list-conversions-query.dto';
import { OverlapCheckQueryDto } from './dto/overlap-check-query.dto';
import { CommerceConversionResponseDto } from './dto/commerce-conversion-response.dto';

/**
 * Conversions (6A.7) — APPEND-ONLY, by construction: this controller
 * defines NO `PATCH`/`DELETE` handler for `/api/commerce/conversions/:id`,
 * proved by an HTTP-level route-absence test
 * (`commerce-conversion.controller.spec.ts`). No step-up: a commission entry
 * records a bookkeeping fact, pushes nothing live, and records no override
 * fact — the same SA-3 reasoning the anchor endpoints rest on.
 */
@Controller('api/commerce/conversions')
@UseGuards(SessionAuthGuard, AdminGuard)
export class CommerceConversionController {
  constructor(private readonly conversions: CommerceConversionService) {}

  @Post()
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateConversionDto,
    @CurrentUserId() userId: string,
  ): Promise<CommerceConversionResponseDto> {
    const conversion = await this.conversions.create(dto, userId);
    return CommerceConversionResponseDto.fromEntity(conversion);
  }

  @Get()
  async list(@Query() query: ListConversionsQueryDto): Promise<CommerceConversionResponseDto[]> {
    const conversions = await this.conversions.list(query);
    return conversions.map(CommerceConversionResponseDto.fromEntity);
  }

  /**
   * Fixed segment, declared distinctly from any `:id` route (which this
   * controller never defines) so it can never be swallowed by one.
   */
  @Get('overlap-check')
  async overlapCheck(
    @Query() query: OverlapCheckQueryDto,
  ): Promise<{ overlaps: CommerceConversionResponseDto[] }> {
    const overlaps = await this.conversions.checkOverlap(query);
    return { overlaps: overlaps.map(CommerceConversionResponseDto.fromEntity) };
  }
}

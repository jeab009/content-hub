import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { CommerceAnchorService } from './commerce-anchor.service';
import { CommercePlacementService } from './commerce-placement.service';
import { RecordProductAnchorsDto } from './dto/record-product-anchors.dto';
import { ProductAnchorResponseDto } from './dto/product-anchor-response.dto';
import { RecordCommercePlacementDto } from './dto/record-commerce-placement.dto';
import { ListPlacementsQueryDto } from './dto/list-placements-query.dto';
import { CommercePlacementResponseDto } from './dto/commerce-placement-response.dto';

/**
 * The commerce placement endpoint carries a password (step-up re-auth), so
 * it gets the same strict rate limit as login and the publish/manual-external
 * routes — without it, it would be an unthrottled password oracle. Requires
 * `CommerceModule`'s OWN `ThrottlerModule` registration (per-importing-module
 * in this codebase — see commerce.module.ts).
 */
const STEP_UP_RATE_LIMIT = { default: { limit: 5, ttl: 15 * 60 * 1000 } };

/**
 * Commerce placements (6A.5) and the product anchors attached to them
 * (6A.4). Guard stack: SessionAuthGuard + AdminGuard on everything, CsrfGuard
 * on every mutation, ThrottlerGuard on the password-carrying record route.
 */
@Controller('api/commerce/placements')
@UseGuards(SessionAuthGuard, AdminGuard)
export class CommercePlacementController {
  constructor(
    private readonly anchors: CommerceAnchorService,
    private readonly placements: CommercePlacementService,
  ) {}

  /**
   * Record a Shopee placement the admin already published natively on the
   * channel. Carries a password, so it gets the strict rate limit above.
   * Route is a fixed segment, so it can never collide with `:id/...` routes.
   */
  @Post('manual-external')
  @UseGuards(CsrfGuard, ThrottlerGuard)
  @Throttle(STEP_UP_RATE_LIMIT)
  @HttpCode(HttpStatus.CREATED)
  async recordManualExternal(
    @Body() dto: RecordCommercePlacementDto,
    @CurrentUserId() userId: string,
    @Req() request: Request,
  ): Promise<CommercePlacementResponseDto> {
    const placement = await this.placements.recordManualExternal(dto, userId, request.ip);
    return CommercePlacementResponseDto.fromEntity(placement);
  }

  @Get()
  async list(@Query() query: ListPlacementsQueryDto): Promise<CommercePlacementResponseDto[]> {
    const placements = await this.placements.list(query);
    return placements.map(CommercePlacementResponseDto.fromEntity);
  }

  @Post(':id/product-anchors')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.CREATED)
  async anchor(
    @Param('id', ParseUUIDPipe) placementId: string,
    @Body() dto: RecordProductAnchorsDto,
    @CurrentUserId() userId: string,
  ): Promise<ProductAnchorResponseDto[]> {
    const created = await this.anchors.anchorToPlacement(placementId, dto, userId);
    return created.map(ProductAnchorResponseDto.fromEntity);
  }

  @Get(':id/product-anchors')
  async listAnchors(
    @Param('id', ParseUUIDPipe) placementId: string,
  ): Promise<ProductAnchorResponseDto[]> {
    const anchors = await this.anchors.listForPlacement(placementId);
    return anchors.map(ProductAnchorResponseDto.fromEntity);
  }

  @Delete(':id/product-anchors/:anchorId')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) placementId: string,
    @Param('anchorId', ParseUUIDPipe) anchorId: string,
    @CurrentUserId() userId: string,
  ): Promise<void> {
    await this.anchors.removeFromPlacement(placementId, anchorId, userId);
  }
}

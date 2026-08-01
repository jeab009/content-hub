import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { PaidCampaignService } from './paid-campaign.service';
import { PaidPerformanceService } from './paid-performance.service';
import { PaidReadService } from './paid-read.service';
import { CreatePaidCampaignDto } from './dto/create-paid-campaign.dto';
import { UpdatePaidCampaignDto } from './dto/update-paid-campaign.dto';
import { ListPaidCampaignsQueryDto } from './dto/list-paid-campaigns-query.dto';
import { CreatePerformanceEntryDto } from './dto/create-performance-entry.dto';
import { PerformanceOverlapCheckQueryDto } from './dto/performance-overlap-check-query.dto';
import { PaidSummaryQueryDto } from './dto/paid-summary-query.dto';
import { AdCampaignResponseDto } from './dto/ad-campaign-response.dto';
import { AdPerformanceEntryResponseDto } from './dto/ad-performance-entry-response.dto';
import { PaidSummaryDto } from './dto/paid-summary-response.dto';

/**
 * Paid/ads visibility endpoints (design §3.2/3.3, WBS 7A). Every route sits
 * under `SessionAuthGuard` + `AdminGuard`; every MUTATING route additionally
 * carries `CsrfGuard`. Deliberately NO step-up anywhere (System Analyst
 * SA-P3, confirmed): a campaign record and a performance entry are both
 * descriptive facts about something that already happened entirely outside
 * Content Hub, on a platform Content Hub has no write access to this phase.
 *
 * APPEND-ONLY, by construction: this controller defines NO `PATCH`/`DELETE`
 * handler for `/api/paid/campaigns/:id/performance-entries/:entryId`, proved
 * by an HTTP-level route-absence test (`paid.controller.spec.ts`), mirroring
 * `CommerceConversionController` exactly.
 */
@Controller('api/paid')
@UseGuards(SessionAuthGuard, AdminGuard)
export class PaidController {
  constructor(
    private readonly campaigns: PaidCampaignService,
    private readonly performance: PaidPerformanceService,
    private readonly read: PaidReadService,
  ) {}

  @Post('campaigns')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.CREATED)
  async createCampaign(
    @Body() dto: CreatePaidCampaignDto,
    @CurrentUserId() userId: string,
  ): Promise<AdCampaignResponseDto> {
    const campaign = await this.campaigns.create(dto, userId);
    return AdCampaignResponseDto.fromEntity(campaign);
  }

  @Get('campaigns')
  async listCampaigns(@Query() query: ListPaidCampaignsQueryDto): Promise<AdCampaignResponseDto[]> {
    const campaigns = await this.campaigns.list(query);
    return campaigns.map(AdCampaignResponseDto.fromEntity);
  }

  @Patch('campaigns/:id')
  @UseGuards(CsrfGuard)
  async updateCampaign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaidCampaignDto,
    @CurrentUserId() userId: string,
  ): Promise<AdCampaignResponseDto> {
    const campaign = await this.campaigns.update(id, dto, userId);
    return AdCampaignResponseDto.fromEntity(campaign);
  }

  /** Soft-retire: isActive=false, retiredAt=now. Never a hard delete. */
  @Post('campaigns/:id/retire')
  @UseGuards(CsrfGuard)
  async retireCampaign(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUserId() userId: string,
  ): Promise<AdCampaignResponseDto> {
    const campaign = await this.campaigns.retire(id, userId);
    return AdCampaignResponseDto.fromEntity(campaign);
  }

  @Post('campaigns/:id/performance-entries')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.CREATED)
  async addPerformanceEntry(
    @Param('id', ParseUUIDPipe) campaignId: string,
    @Body() dto: CreatePerformanceEntryDto,
    @CurrentUserId() userId: string,
  ): Promise<AdPerformanceEntryResponseDto> {
    const entry = await this.performance.addEntry(campaignId, dto, userId);
    return AdPerformanceEntryResponseDto.fromEntity(entry);
  }

  @Get('campaigns/:id/performance-entries')
  async listPerformanceEntries(
    @Param('id', ParseUUIDPipe) campaignId: string,
  ): Promise<AdPerformanceEntryResponseDto[]> {
    const entries = await this.performance.list(campaignId);
    return entries.map(AdPerformanceEntryResponseDto.fromEntity);
  }

  /**
   * Fixed segment, declared distinctly from any dynamic `:entryId` route
   * (which this controller never defines) so it can never be swallowed by
   * one.
   */
  @Get('campaigns/:id/performance-entries/overlap-check')
  async overlapCheck(
    @Param('id', ParseUUIDPipe) campaignId: string,
    @Query() query: PerformanceOverlapCheckQueryDto,
  ): Promise<{ overlaps: AdPerformanceEntryResponseDto[] }> {
    const overlaps = await this.performance.checkOverlap(campaignId, query);
    return { overlaps: overlaps.map(AdPerformanceEntryResponseDto.fromEntity) };
  }

  @Get('summary')
  async summary(@Query() query: PaidSummaryQueryDto): Promise<PaidSummaryDto> {
    return this.read.summary(query);
  }
}

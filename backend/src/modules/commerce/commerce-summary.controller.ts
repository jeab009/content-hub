import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CommerceReadService } from './commerce-read.service';
import { CommerceSummaryQueryDto } from './dto/commerce-summary-query.dto';
import { CommerceSummaryDto, ContentCommerceSummaryDto } from './dto/commerce-summary-response.dto';

/**
 * Commerce read model (6A.8) — read-only, so no CsrfGuard (the same
 * convention `DashboardController`/`ReportsController` use: CSRF defends
 * state-changing requests only).
 */
@Controller('api/commerce')
@UseGuards(SessionAuthGuard, AdminGuard)
export class CommerceSummaryController {
  constructor(private readonly commerceRead: CommerceReadService) {}

  @Get('summary')
  async summary(@Query() query: CommerceSummaryQueryDto): Promise<CommerceSummaryDto> {
    return this.commerceRead.summary(query);
  }

  @Get('summary/:contentId')
  async contentSummary(
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ): Promise<ContentCommerceSummaryDto> {
    return this.commerceRead.contentSummary(contentId);
  }
}

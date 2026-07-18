import { Controller, Get, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { DashboardService } from './dashboard.service';
import { DashboardOverviewDto, DashboardRevenueDto } from './dto/dashboard.dto';

/** Phase 3 dashboard read endpoints. Admin-only, read-only (no CSRF on GET). */
@Controller('api/dashboard')
@UseGuards(SessionAuthGuard, AdminGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('overview')
  overview(): Promise<DashboardOverviewDto> {
    return this.dashboard.overview();
  }

  @Get('revenue')
  revenue(): Promise<DashboardRevenueDto> {
    return this.dashboard.revenue();
  }
}

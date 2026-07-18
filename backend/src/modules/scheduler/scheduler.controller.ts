import { Controller, Get, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { SchedulerService } from './scheduler.service';
import { SchedulerOverviewDto } from './dto/scheduler-overview.dto';

/** Read-only data source for the Scheduler UI (Pass C renders it). */
@Controller('api/scheduler')
@UseGuards(SessionAuthGuard, AdminGuard)
export class SchedulerController {
  constructor(private readonly schedulerService: SchedulerService) {}

  @Get('overview')
  async overview(): Promise<SchedulerOverviewDto> {
    return this.schedulerService.overview();
  }
}

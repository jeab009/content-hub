import { Module } from '@nestjs/common';
import { AdminGuard } from '../../common/guards/admin.guard';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/** Phase 3 dashboard read-model (reads the metrics table via PrismaModule). */
@Module({
  controllers: [DashboardController],
  providers: [DashboardService, AdminGuard],
  exports: [DashboardService],
})
export class DashboardModule {}

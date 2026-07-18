import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { MetricsService } from './metrics.service';
import { MetricIngestionService } from './metric-ingestion.service';
import { CreateManualMetricDto } from './dto/create-manual-metric.dto';
import { MetricResponseDto } from './dto/metric-response.dto';
import { SyncResultDto } from './dto/sync-result.dto';

/**
 * Phase 3 metric ingestion. Admin-only; mutations carry CSRF. Metrics are
 * append-only — there is deliberately no PATCH/DELETE.
 */
@Controller('api')
@UseGuards(SessionAuthGuard, AdminGuard)
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly ingestion: MetricIngestionService,
  ) {}

  /** Pull API-platform metrics for every live post and append them. */
  @Post('metrics/sync')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  sync(@CurrentUserId() userId: string): Promise<SyncResultDto> {
    return this.ingestion.syncApiMetrics(userId);
  }

  /** Append a manual reading for one post (TikTok/LINE or a correction). */
  @Post('posts/:id/metrics')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.CREATED)
  async addManual(
    @Param('id', ParseUUIDPipe) postId: string,
    @Body() dto: CreateManualMetricDto,
    @CurrentUserId() userId: string,
  ): Promise<MetricResponseDto> {
    const metric = await this.metrics.appendManual(postId, dto, userId);
    return MetricResponseDto.fromEntity(metric);
  }

  /** Full reading history for a post (drives the per-post trend chart). */
  @Get('posts/:id/metrics')
  async history(@Param('id', ParseUUIDPipe) postId: string): Promise<MetricResponseDto[]> {
    const metrics = await this.metrics.listForPost(postId);
    return metrics.map(MetricResponseDto.fromEntity);
  }
}

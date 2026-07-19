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
import { StepUpAuthService } from '../publish/step-up-auth.service';
import { CommentIngestionService } from './comment-ingestion.service';
import { CommentInboxService } from './comment-inbox.service';
import { CommentReplyService } from './comment-reply.service';
import { EscalationService } from './escalation.service';
import { CommentRetentionService } from './comment-retention.service';
import { ListCommentsQueryDto } from './dto/list-comments-query.dto';
import { ReplyCommentDto } from './dto/reply-comment.dto';
import { PurgeRetentionDto } from './dto/purge-retention.dto';
import { ListEscalationsQueryDto } from './dto/escalation-alert.dto';

/**
 * Password-carrying routes (reply + retention purge) get the same strict rate
 * limit as publish — an unthrottled password route is an oracle. The sync
 * route is throttled too (C6c): a full re-poll burns FB/YT quota, so hammered
 * syncs must be capped (the in-flight guard in the ingestion service handles
 * true concurrency).
 */
const STEP_UP_RATE_LIMIT = { default: { limit: 5, ttl: 15 * 60 * 1000 } };
const SYNC_RATE_LIMIT = { default: { limit: 10, ttl: 15 * 60 * 1000 } };

/**
 * Phase 4 comment aggregation API. Guard stack mirrors PostsController /
 * MetricsController: SessionAuthGuard + AdminGuard on everything, CsrfGuard on
 * every mutation, ThrottlerGuard on the password-carrying + quota-sensitive
 * routes.
 */
@Controller('api/comments')
@UseGuards(SessionAuthGuard, AdminGuard)
export class CommentsController {
  constructor(
    private readonly ingestion: CommentIngestionService,
    private readonly inbox: CommentInboxService,
    private readonly replyService: CommentReplyService,
    private readonly escalation: EscalationService,
    private readonly retention: CommentRetentionService,
    private readonly stepUpAuth: StepUpAuthService,
  ) {}

  /** Pull FB + YouTube comments, classify, triage, escalate. */
  @Post('sync')
  @UseGuards(CsrfGuard, ThrottlerGuard)
  @Throttle(SYNC_RATE_LIMIT)
  @HttpCode(HttpStatus.OK)
  sync(@CurrentUserId() userId: string) {
    return this.ingestion.syncComments(userId);
  }

  /** Inbox list + filters + pagination (read-only). */
  @Get()
  list(@Query() query: ListCommentsQueryDto) {
    return this.inbox.list(query);
  }

  /** Active alert surface for the inbox banner. Declared before ':id' routes. */
  @Get('escalations')
  listEscalations(@Query() query: ListEscalationsQueryDto) {
    return this.escalation.list(query);
  }

  /** Soft-dismiss an alert (does NOT delete — a deleted row would re-fire). */
  @Post('escalations/:id/ack')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  ackEscalation(@Param('id', ParseUUIDPipe) id: string) {
    return this.escalation.acknowledge(id);
  }

  /** Manual 12-month hard-delete purge — step-up guarded (C8). */
  @Post('retention/purge')
  @UseGuards(CsrfGuard, ThrottlerGuard)
  @Throttle(STEP_UP_RATE_LIMIT)
  @HttpCode(HttpStatus.OK)
  async purge(
    @Body() dto: PurgeRetentionDto,
    @CurrentUserId() userId: string,
    @Req() request: Request,
  ) {
    await this.stepUpAuth.assertFreshPassword(
      userId,
      dto.password,
      request.ip,
      'comment_retention_purged',
    );
    return this.retention.purgeExpired(userId);
  }

  /** Step-up reply (never automatic). */
  @Post(':id/reply')
  @UseGuards(CsrfGuard, ThrottlerGuard)
  @Throttle(STEP_UP_RATE_LIMIT)
  @HttpCode(HttpStatus.OK)
  reply(
    @Param('id', ParseUUIDPipe) commentId: string,
    @Body() dto: ReplyCommentDto,
    @CurrentUserId() userId: string,
    @Req() request: Request,
  ) {
    return this.replyService.reply(commentId, dto, userId, request.ip);
  }

  /** PDPA data-subject erasure — single-comment hard-delete on request (C2). */
  @Delete(':id')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async erase(
    @Param('id', ParseUUIDPipe) commentId: string,
    @CurrentUserId() userId: string,
  ): Promise<void> {
    await this.retention.eraseOne(commentId, userId);
  }
}

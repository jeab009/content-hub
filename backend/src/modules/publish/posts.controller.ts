import {
  Body,
  Controller,
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
import { PublishOrchestratorService } from './publish-orchestrator.service';
import { PostResolutionService } from './post-resolution.service';
import { CreatePostDto } from './dto/create-post.dto';
import { PublishRetryDto } from './dto/publish-retry.dto';
import { ResolvePostedDto } from './dto/resolve-posted.dto';
import { ListPostsQueryDto } from './dto/list-posts-query.dto';
import { PostResponseDto } from './dto/post-response.dto';

/**
 * The publish endpoints carry a password (step-up re-auth), so the two
 * dispatch routes get the same strict rate limit as login — without it,
 * they would be an unthrottled password oracle that bypasses the login
 * lockout.
 */
const STEP_UP_RATE_LIMIT = { default: { limit: 5, ttl: 15 * 60 * 1000 } };

/**
 * Manual publish flow (docs/publish-orchestration-addendum.md). Guard
 * stack: SessionAuthGuard + AdminGuard on everything, CsrfGuard on every
 * mutation, ThrottlerGuard on the password-carrying dispatch routes.
 */
@Controller('api/posts')
@UseGuards(SessionAuthGuard, AdminGuard)
export class PostsController {
  constructor(
    private readonly orchestrator: PublishOrchestratorService,
    private readonly resolution: PostResolutionService,
  ) {}

  /** Create a publish intent and dispatch it. Publish is never automatic. */
  @Post()
  @UseGuards(CsrfGuard, ThrottlerGuard)
  @Throttle(STEP_UP_RATE_LIMIT)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreatePostDto,
    @CurrentUserId() userId: string,
    @Req() request: Request,
  ): Promise<PostResponseDto> {
    const post = await this.orchestrator.createAndDispatch(dto, userId, request.ip);
    return PostResponseDto.fromEntity(post);
  }

  /** Retry a draft/failed post (posted_unconfirmed is NEVER retryable here). */
  @Post(':id/publish')
  @UseGuards(CsrfGuard, ThrottlerGuard)
  @Throttle(STEP_UP_RATE_LIMIT)
  @HttpCode(HttpStatus.OK)
  async publish(
    @Param('id', ParseUUIDPipe) postId: string,
    @Body() dto: PublishRetryDto,
    @CurrentUserId() userId: string,
    @Req() request: Request,
  ): Promise<PostResponseDto> {
    const post = await this.orchestrator.redispatch(postId, dto.password, userId, request.ip);
    return PostResponseDto.fromEntity(post);
  }

  @Get()
  async list(@Query() query: ListPostsQueryDto): Promise<PostResponseDto[]> {
    const posts = await this.orchestrator.list(query);
    return posts.map(PostResponseDto.fromEntity);
  }

  /** Admin checked the platform and FOUND the live post. */
  @Post(':id/resolve-posted')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  async resolvePosted(
    @Param('id', ParseUUIDPipe) postId: string,
    @Body() dto: ResolvePostedDto,
    @CurrentUserId() userId: string,
  ): Promise<PostResponseDto> {
    const post = await this.resolution.resolveAsPosted(postId, dto.externalPostId, userId);
    return PostResponseDto.fromEntity(post);
  }

  /** Admin checked the platform and found NOTHING live — reopen for retry. */
  @Post(':id/resolve-not-posted')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  async resolveNotPosted(
    @Param('id', ParseUUIDPipe) postId: string,
    @CurrentUserId() userId: string,
  ): Promise<PostResponseDto> {
    const post = await this.resolution.resolveAsNotPosted(postId, userId);
    return PostResponseDto.fromEntity(post);
  }
}

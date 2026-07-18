import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  AssetPlatform,
  ConnectedAccount,
  Content,
  ContentStatus,
  CopyrightClearance,
  Post,
  Prisma,
  RankingScore,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { toPostPlatform } from '../../common/utils/platform-map.util';
import { CopyrightGateService } from '../content/copyright-gate.service';
import { RankingEngineService } from '../ranking/ranking-engine.service';
import { PUBLISH_QUEUE } from '../queue/queue.constants';
import { StepUpAuthService } from './step-up-auth.service';
import { PlatformAdapterRegistry } from './adapters/platform-adapter.registry';
import { InvalidPostStateTransitionError, isDispatchable } from './post-state';
import { CreatePostDto } from './dto/create-post.dto';
import { ListPostsQueryDto } from './dto/list-posts-query.dto';

export const PUBLISH_JOB_NAME = 'dispatch';

export interface PublishJobData {
  postId: string;
  requestedBy: string;
  connectedAccountId: string;
}

interface Recommendation {
  recommendedPlatform: AssetPlatform | null;
  recommendedAt: Date | null;
  wasOverride: boolean;
  selectedScore: RankingScore | null;
}

/**
 * The manual publish flow. Publish is NEVER automatic: every dispatch
 * starts from an explicit admin request carrying step-up re-auth, passes
 * the copyright gate AGAIN (defense in depth on top of the CMS ready-gate),
 * has its recommendation/override facts recomputed server-side, and leaves
 * a persisted Post intent row BEFORE the queue dispatch so a crash
 * mid-flight always leaves evidence.
 */
@Injectable()
export class PublishOrchestratorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stepUpAuth: StepUpAuthService,
    private readonly copyrightGate: CopyrightGateService,
    private readonly rankingEngine: RankingEngineService,
    private readonly adapterRegistry: PlatformAdapterRegistry,
    private readonly auditLog: AuditLogService,
    @InjectQueue(PUBLISH_QUEUE) private readonly publishQueue: Queue<PublishJobData>,
  ) {}

  /** POST /api/posts — create the intent row, then dispatch. */
  async createAndDispatch(dto: CreatePostDto, userId: string, ip?: string): Promise<Post> {
    await this.stepUpAuth.assertFreshPassword(userId, dto.password, ip);
    this.adapterRegistry.getFor(dto.platform); // throws 400 for Phase 5 platforms

    const content = await this.loadContentOrThrow(dto.contentId);
    this.assertPublishableContent(content);
    const account = await this.findConnectedAccountOrThrow(userId, dto.platform);
    const recommendation = await this.recomputeRecommendation(content.id, dto.platform);

    const post = await this.prisma.post.create({
      data: {
        contentId: content.id,
        platform: toPostPlatform(dto.platform),
        selectedPlatform: dto.platform,
        recommendedPlatform: recommendation.recommendedPlatform,
        recommendedAt: recommendation.recommendedAt,
        wasOverride: recommendation.wasOverride,
        overrideReason: dto.overrideReason ?? null,
        rankingScoreId: recommendation.selectedScore?.id ?? null,
        priorityScore: this.toPriorityScore(recommendation.selectedScore),
      },
    });

    await this.auditAndEnqueue(post, userId, account.id, ip);
    return post;
  }

  /** POST /api/posts/:id/publish — re-dispatch an existing draft/failed post. */
  async redispatch(postId: string, password: string, userId: string, ip?: string): Promise<Post> {
    await this.stepUpAuth.assertFreshPassword(userId, password, ip);

    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: { content: true },
    });
    if (!post) {
      throw new NotFoundException('Post not found');
    }
    if (!isDispatchable(post.status)) {
      throw new InvalidPostStateTransitionError(post.status, 'be (re)published');
    }
    if (!post.selectedPlatform) {
      throw new ConflictException(
        'This post predates platform selection (legacy row) and cannot be dispatched',
      );
    }
    this.adapterRegistry.getFor(post.selectedPlatform);
    this.assertPublishableContent(post.content);
    const account = await this.findConnectedAccountOrThrow(userId, post.selectedPlatform);

    // Recommendation facts are recomputed at every publish confirmation —
    // scores may have changed since the post row was first created.
    const recommendation = await this.recomputeRecommendation(
      post.contentId,
      post.selectedPlatform,
    );
    const updated = await this.prisma.post.update({
      where: { id: post.id },
      data: {
        recommendedPlatform: recommendation.recommendedPlatform,
        recommendedAt: recommendation.recommendedAt,
        wasOverride: recommendation.wasOverride,
        rankingScoreId: recommendation.selectedScore?.id ?? null,
        priorityScore: this.toPriorityScore(recommendation.selectedScore),
      },
    });

    await this.auditAndEnqueue(updated, userId, account.id, ip);
    return updated;
  }

  async list(query: ListPostsQueryDto): Promise<Post[]> {
    return this.prisma.post.findMany({
      where: { ...(query.status && { status: query.status }) },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Publish-time copyright recheck (hard constraint): content must be
   * `ready` AND still satisfy the copyright gate. The CMS enforced this at
   * ready-transition time; rechecking here means a row whose evidence was
   * edited away (or hand-edited in the DB) after being marked ready can
   * still never reach a platform.
   */
  private assertPublishableContent(content: Content): void {
    if (content.status !== ContentStatus.ready) {
      throw new ConflictException(
        `Content must be in "ready" status to publish (currently "${content.status}")`,
      );
    }
    if (content.copyrightCleared !== CopyrightClearance.cleared) {
      throw new ConflictException(
        `Publish blocked: copyrightCleared is "${content.copyrightCleared}", must be "cleared"`,
      );
    }
    if (!this.copyrightGate.canMarkCopyrightCleared(content)) {
      throw new ConflictException(
        'Publish blocked: content no longer satisfies the copyright evidence rule for its pillar',
      );
    }
  }

  /**
   * Server-side recommendation recompute. recommended_platform is the
   * top-scored platform from the latest ranking_scores; was_override is
   * derived here and ONLY here — client-supplied values never exist (the
   * DTO has no such fields and forbidNonWhitelisted rejects extras).
   */
  private async recomputeRecommendation(
    contentId: string,
    selectedPlatform: AssetPlatform,
  ): Promise<Recommendation> {
    const latestScores = await this.rankingEngine.getLatestScores(contentId);
    const recommended = await this.rankingEngine.getRecommendation(contentId);
    const selectedScore = latestScores.find((score) => score.platform === selectedPlatform) ?? null;

    return {
      recommendedPlatform: recommended?.platform ?? null,
      recommendedAt: recommended?.computedAt ?? null,
      wasOverride: recommended !== null && recommended.platform !== selectedPlatform,
      selectedScore,
    };
  }

  private async loadContentOrThrow(contentId: string): Promise<Content> {
    const content = await this.prisma.content.findUnique({ where: { id: contentId } });
    if (!content) {
      throw new NotFoundException('Content not found');
    }
    return content;
  }

  private async findConnectedAccountOrThrow(
    userId: string,
    platform: AssetPlatform,
  ): Promise<ConnectedAccount> {
    const account = await this.prisma.connectedAccount.findFirst({
      where: { userId, platform: toPostPlatform(platform), status: 'connected' },
      orderBy: { connectedAt: 'desc' },
    });
    if (!account) {
      throw new ConflictException(
        `No connected ${platform} account available — connect one in Settings first`,
      );
    }
    return account;
  }

  /**
   * Audit publish_attempt_started, then enqueue. Ordering is deliberate:
   * the Post row (intent) is already persisted by the caller BEFORE this
   * point, so a crash between persist and enqueue leaves a draft row +
   * audit line as evidence instead of a silent no-op. jobId includes the
   * post version so a retry (version bumped by the failed attempt) gets a
   * fresh id while duplicate submissions of the same attempt dedupe.
   */
  private async auditAndEnqueue(
    post: Post,
    userId: string,
    connectedAccountId: string,
    ip?: string,
  ): Promise<void> {
    this.auditLog.record({
      actor: userId,
      action: 'publish_attempt_started',
      result: 'success',
      ip,
      meta: {
        postId: post.id,
        contentId: post.contentId,
        selectedPlatform: post.selectedPlatform,
        recommendedPlatform: post.recommendedPlatform,
        wasOverride: post.wasOverride,
      },
    });

    await this.publishQueue.add(
      PUBLISH_JOB_NAME,
      { postId: post.id, requestedBy: userId, connectedAccountId },
      { jobId: `publish-${post.id}-v${post.version}`, attempts: 1 },
    );
  }

  private toPriorityScore(selectedScore: RankingScore | null): Prisma.Decimal | null {
    return selectedScore === null ? null : new Prisma.Decimal(Number(selectedScore.score));
  }
}

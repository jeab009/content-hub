import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Post, PostStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { InvalidPostStateTransitionError } from './post-state';

/**
 * The two explicit admin exits from `posted_unconfirmed` (addendum §4).
 * Deliberately two distinct operations — not a generic "resolve" — because
 * the outcomes have opposite consequences if the admin picks wrong. No
 * automated transition ever leaves posted_unconfirmed; both writes are
 * conditional on status+version so a double-click or concurrent resolution
 * can't apply twice.
 */
@Injectable()
export class PostResolutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** "Confirmed posted on [platform] — mark as Posted" (externalPostId mandatory). */
  async resolveAsPosted(postId: string, externalPostId: string, adminId: string): Promise<Post> {
    const post = await this.loadUnconfirmedOrThrow(postId, 'be resolved as posted');
    await this.conditionalResolve(post, {
      status: PostStatus.posted,
      externalPostId,
      postedAt: new Date(),
      executedBy: adminId,
    });
    return this.recordResolution(postId, adminId, 'confirmed_posted', externalPostId);
  }

  /** "Confirmed NOT posted — allow retry" (re-enters the failed → retry path). */
  async resolveAsNotPosted(postId: string, adminId: string): Promise<Post> {
    const post = await this.loadUnconfirmedOrThrow(postId, 'be resolved as not posted');
    await this.conditionalResolve(post, { status: PostStatus.failed, executedBy: adminId });
    return this.recordResolution(postId, adminId, 'confirmed_not_posted', null);
  }

  private async loadUnconfirmedOrThrow(postId: string, attempted: string): Promise<Post> {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) {
      throw new NotFoundException('Post not found');
    }
    if (post.status !== PostStatus.posted_unconfirmed) {
      throw new InvalidPostStateTransitionError(post.status, attempted);
    }
    return post;
  }

  private async conditionalResolve(
    post: Post,
    data: {
      status: PostStatus;
      executedBy: string;
      externalPostId?: string;
      postedAt?: Date;
    },
  ): Promise<void> {
    const result = await this.prisma.post.updateMany({
      where: { id: post.id, status: PostStatus.posted_unconfirmed, version: post.version },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count !== 1) {
      throw new ConflictException(
        'Post was modified by another request while resolving — refresh and re-check its state',
      );
    }
  }

  private async recordResolution(
    postId: string,
    adminId: string,
    direction: 'confirmed_posted' | 'confirmed_not_posted',
    externalPostId: string | null,
  ): Promise<Post> {
    // Human override of a system-uncertain state — its own forensic trail,
    // distinct from the automated publish_succeeded/publish_failed events.
    this.auditLog.record({
      actor: adminId,
      action: 'publish_ambiguity_resolved',
      result: 'success',
      meta: { postId, direction, ...(externalPostId && { externalPostId }) },
    });
    return this.prisma.post.findUniqueOrThrow({ where: { id: postId } });
  }
}

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CommerceChannel,
  CommercePlacement,
  CommercePlacementStatus,
  Content,
  ContentStatus,
  CopyrightClearance,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { StepUpAuthService } from '../publish/step-up-auth.service';
import { CopyrightGateService } from '../content/copyright-gate.service';
import { assertShopeeDuration } from './commerce-duration';
import { RecordCommercePlacementDto } from './dto/record-commerce-placement.dto';
import { ListPlacementsQueryDto } from './dto/list-placements-query.dto';

interface ResolvedMedia {
  mediaUrl: string | null;
  durationSeconds: number | null;
}

/**
 * Records a Shopee video placement the admin already published natively on
 * the channel (6A.5) — a RECORD, not a dispatch, mirroring
 * `PublishOrchestratorService.recordManualExternal` 1:1: step-up re-auth,
 * the copyright gate, the active-duplicate guard, and now also the
 * Shopee duration gate (422, fail-closed — see commerce-duration.ts).
 *
 * NFR-6.10 / System Analyst condition C4: `failureAction` is
 * `'commerce_placement_recorded'` — the SAME action used on success,
 * distinguished by `result`, matching the `manual_external_post_recorded`
 * convention. `StepUpAuthService` always tags a step-up failure with the
 * SHARED `meta.reason: 'step_up_reauth_failed'` regardless of the action
 * passed, which is what makes brute-force detection aggregate correctly
 * across every password-carrying route, commerce included.
 */
@Injectable()
export class CommercePlacementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stepUpAuth: StepUpAuthService,
    private readonly copyrightGate: CopyrightGateService,
    private readonly auditLog: AuditLogService,
  ) {}

  async recordManualExternal(
    dto: RecordCommercePlacementDto,
    userId: string,
    ip?: string,
  ): Promise<CommercePlacement> {
    await this.stepUpAuth.assertFreshPassword(
      userId,
      dto.password,
      ip,
      'commerce_placement_recorded',
    );

    const content = await this.loadContentOrThrow(dto.contentId);
    this.assertPublishableContent(content);
    await this.assertNoActiveDuplicate(content.id, dto.channel);

    const media = await this.resolveMedia(dto);
    assertShopeeDuration(dto.channel, media.durationSeconds);

    const placement = await this.createPlacementOrConflict(
      {
        contentId: content.id,
        channel: dto.channel,
        externalMediaId: dto.externalMediaId,
        externalUrl: dto.externalUrl ?? null,
        status: CommercePlacementStatus.recorded,
        sourceAssetId: dto.sourceAssetId ?? null,
        mediaUrl: media.mediaUrl,
        durationSeconds: media.durationSeconds,
        note: dto.note ?? null,
        recordedBy: userId,
        placedAt: new Date(),
      },
      dto.channel,
    );

    this.auditLog.record({
      actor: userId,
      action: 'commerce_placement_recorded',
      result: 'success',
      ip,
      // note is EXCLUDED (System Analyst SA-4 exclusion list).
      meta: {
        placementId: placement.id,
        contentId: placement.contentId,
        channel: placement.channel,
        externalMediaId: placement.externalMediaId,
        durationSeconds: placement.durationSeconds,
      },
    });

    return placement;
  }

  async list(query: ListPlacementsQueryDto): Promise<CommercePlacement[]> {
    const where: Prisma.CommercePlacementWhereInput = {
      ...(query.channel && { channel: query.channel }),
      ...(query.status && { status: query.status }),
      ...(query.contentId && { contentId: query.contentId }),
    };
    return this.prisma.commercePlacement.findMany({ where, orderBy: { placedAt: 'desc' } });
  }

  private async loadContentOrThrow(contentId: string): Promise<Content> {
    const content = await this.prisma.content.findUnique({ where: { id: contentId } });
    if (!content) {
      throw new NotFoundException('Content not found');
    }
    return content;
  }

  /**
   * Same three-part rule `PublishOrchestratorService.assertPublishableContent`
   * enforces: `ready` status, `copyrightCleared === cleared`, and the
   * pillar-based evidence rule must STILL hold. Duplicated rather than
   * imported so `modules/commerce` never has to reach into
   * `modules/publish/publish-orchestrator.service.ts` for a private method —
   * the two copies are small, and the shared authority is
   * `CopyrightGateService`, which IS imported.
   */
  private assertPublishableContent(content: Content): void {
    if (content.status !== ContentStatus.ready) {
      throw new ConflictException(
        `Content must be in "ready" status to record a placement (currently "${content.status}")`,
      );
    }
    if (content.copyrightCleared !== CopyrightClearance.cleared) {
      throw new ConflictException(
        `Placement blocked: copyrightCleared is "${content.copyrightCleared}", must be "cleared"`,
      );
    }
    if (!this.copyrightGate.canMarkCopyrightCleared(content)) {
      throw new ConflictException(
        'Placement blocked: content no longer satisfies the copyright evidence rule for its pillar',
      );
    }
  }

  /**
   * App-level dedupe, matching the DB partial unique index
   * `commerce_placements_content_channel_active_key` (WHERE status <>
   * 'removed'). This is the fast, friendly path; the index is the
   * race-proof backstop (see createPlacementOrConflict).
   */
  private async assertNoActiveDuplicate(
    contentId: string,
    channel: CommerceChannel,
  ): Promise<void> {
    const existing = await this.prisma.commercePlacement.findFirst({
      where: { contentId, channel, status: { not: CommercePlacementStatus.removed } },
      select: { id: true, status: true },
    });
    if (existing) {
      throw new ConflictException(
        `An active ${channel} placement for this content already exists (placement ${existing.id}). ` +
          'Remove it first or pick a different content.',
      );
    }
  }

  /**
   * Pre-fills mediaUrl/durationSeconds from the picked asset when
   * `sourceAssetId` is given and the DTO did not already carry an explicit
   * `durationSeconds` (an admin-entered value always wins over the parsed
   * one — the parse is best-effort, per `mp4-duration.ts`).
   */
  private async resolveMedia(dto: RecordCommercePlacementDto): Promise<ResolvedMedia> {
    if (!dto.sourceAssetId) {
      return { mediaUrl: null, durationSeconds: dto.durationSeconds ?? null };
    }

    const asset = await this.prisma.contentAsset.findUnique({ where: { id: dto.sourceAssetId } });
    if (!asset) {
      throw new NotFoundException('Source content asset not found');
    }

    return {
      mediaUrl: asset.mediaUrl,
      durationSeconds: dto.durationSeconds ?? asset.durationSeconds ?? null,
    };
  }

  private async createPlacementOrConflict(
    data: Prisma.CommercePlacementUncheckedCreateInput,
    channel: string,
  ): Promise<CommercePlacement> {
    try {
      return await this.prisma.commercePlacement.create({ data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          `An active ${channel} placement for this content already exists (created concurrently).`,
        );
      }
      throw error;
    }
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Content, ContentStatus, CopyrightClearance, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { CopyrightGateService, CopyrightGateInput } from './copyright-gate.service';
import { assertMediaUrlIsOwned } from './media-url.util';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { ListContentQueryDto } from './dto/list-content-query.dto';

/** The compliance-relevant slice of a Content row the ready-gate evaluates. */
interface ComplianceState extends CopyrightGateInput {
  copyrightCleared: CopyrightClearance;
}

@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly copyrightGate: CopyrightGateService,
  ) {}

  async create(dto: CreateContentDto, userId: string): Promise<Content> {
    this.assertAgeRangeIsValid(dto.targetAgeMin, dto.targetAgeMax);
    assertMediaUrlIsOwned(dto.mediaUrl);

    const compliance: ComplianceState = {
      contentPillar: dto.contentPillar ?? null,
      copyrightEvidenceUrl: dto.copyrightEvidenceUrl ?? null,
      copyrightCleared: dto.copyrightCleared ?? CopyrightClearance.not_checked,
    };
    if (compliance.copyrightCleared === CopyrightClearance.cleared) {
      this.assertClearanceIsEligible(compliance);
    }
    if (dto.markReady) {
      this.assertReadyTransitionAllowed(compliance);
    }

    const content = await this.prisma.content.create({
      data: {
        type: dto.type,
        title: dto.title,
        mediaUrl: dto.mediaUrl,
        caption: dto.caption ?? null,
        targetAgeMin: dto.targetAgeMin,
        targetAgeMax: dto.targetAgeMax,
        status: dto.markReady ? ContentStatus.ready : ContentStatus.draft,
        licensingStatus: dto.licensingStatus,
        licenseNotes: dto.licenseNotes ?? null,
        licenseExpiresAt: dto.licenseExpiresAt ? new Date(dto.licenseExpiresAt) : null,
        fileSizeBytes: dto.fileSizeBytes !== undefined ? BigInt(dto.fileSizeBytes) : null,
        mimeType: dto.mimeType ?? null,
        contentPillar: compliance.contentPillar,
        copyrightCleared: compliance.copyrightCleared,
        copyrightNotes: dto.copyrightNotes ?? null,
        copyrightEvidenceUrl: compliance.copyrightEvidenceUrl,
        createdBy: userId,
      },
    });

    this.auditLog.record({
      actor: userId,
      action: 'content_created',
      result: 'success',
      meta: { contentId: content.id, type: content.type, status: content.status },
    });

    return content;
  }

  async update(id: string, dto: UpdateContentDto, userId: string): Promise<Content> {
    const existing = await this.findOrThrow(id);

    const nextMin = dto.targetAgeMin ?? existing.targetAgeMin;
    const nextMax = dto.targetAgeMax ?? existing.targetAgeMax;
    this.assertAgeRangeIsValid(nextMin, nextMax);

    // The state the row will be in AFTER this update — validation must run
    // against the merged record, not the patch or the stale row alone.
    const compliance: ComplianceState = {
      contentPillar: dto.contentPillar !== undefined ? dto.contentPillar : existing.contentPillar,
      copyrightEvidenceUrl:
        dto.copyrightEvidenceUrl !== undefined
          ? dto.copyrightEvidenceUrl
          : existing.copyrightEvidenceUrl,
      copyrightCleared: dto.copyrightCleared ?? existing.copyrightCleared,
    };
    if (dto.copyrightCleared === CopyrightClearance.cleared) {
      this.assertClearanceIsEligible(compliance);
    }
    // Re-run the ready-gate whenever the resulting row would BE `ready`, not
    // only when this PATCH explicitly sets status:ready. Otherwise a partial
    // PATCH that edits contentPillar / evidence / clearance on an
    // already-ready row could leave it `ready` while violating its pillar's
    // copyright-evidence rule — a state the architecture says is unreachable
    // (BUG-QA-002). The check runs against the MERGED compliance state above.
    const resultingStatus = dto.status ?? existing.status;
    if (resultingStatus === ContentStatus.ready) {
      this.assertReadyTransitionAllowed(compliance);
    }

    const data: Prisma.ContentUpdateInput = {
      ...(dto.type !== undefined && { type: dto.type }),
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.caption !== undefined && { caption: dto.caption }),
      ...(dto.targetAgeMin !== undefined && { targetAgeMin: dto.targetAgeMin }),
      ...(dto.targetAgeMax !== undefined && { targetAgeMax: dto.targetAgeMax }),
      ...(dto.status !== undefined && { status: dto.status }),
      ...(dto.licensingStatus !== undefined && { licensingStatus: dto.licensingStatus }),
      ...(dto.licenseNotes !== undefined && { licenseNotes: dto.licenseNotes }),
      ...(dto.licenseExpiresAt !== undefined && {
        licenseExpiresAt: dto.licenseExpiresAt ? new Date(dto.licenseExpiresAt) : null,
      }),
      ...(dto.contentPillar !== undefined && { contentPillar: dto.contentPillar }),
      ...(dto.copyrightCleared !== undefined && { copyrightCleared: dto.copyrightCleared }),
      ...(dto.copyrightNotes !== undefined && { copyrightNotes: dto.copyrightNotes }),
      ...(dto.copyrightEvidenceUrl !== undefined && {
        copyrightEvidenceUrl: dto.copyrightEvidenceUrl,
      }),
    };

    const content = await this.prisma.content.update({ where: { id }, data });

    this.auditLog.record({
      actor: userId,
      action: 'content_updated',
      result: 'success',
      meta: { contentId: id, changedFields: Object.keys(data) },
    });

    return content;
  }

  async archive(id: string, userId: string): Promise<Content> {
    await this.findOrThrow(id);
    const content = await this.prisma.content.update({
      where: { id },
      data: { status: ContentStatus.archived },
    });

    this.auditLog.record({
      actor: userId,
      action: 'content_archived',
      result: 'success',
      meta: { contentId: id },
    });

    return content;
  }

  async findOne(id: string): Promise<Content> {
    return this.findOrThrow(id);
  }

  async list(filters: ListContentQueryDto): Promise<Content[]> {
    const where: Prisma.ContentWhereInput = {
      ...(filters.type && { type: filters.type }),
      ...(filters.status && { status: filters.status }),
      ...(filters.licensingStatus && { licensingStatus: filters.licensingStatus }),
      ...(filters.ageBand !== undefined && {
        targetAgeMin: { lte: filters.ageBand },
        targetAgeMax: { gte: filters.ageBand },
      }),
      ...(filters.search && {
        title: { contains: filters.search, mode: Prisma.QueryMode.insensitive },
      }),
    };

    return this.prisma.content.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  private async findOrThrow(id: string): Promise<Content> {
    const content = await this.prisma.content.findUnique({ where: { id } });
    if (!content) {
      throw new NotFoundException('Content not found');
    }
    return content;
  }

  private assertAgeRangeIsValid(min: number, max: number): void {
    if (min > max) {
      throw new BadRequestException('targetAgeMin must be less than or equal to targetAgeMax');
    }
  }

  /**
   * Approved architecture invariant: "`ready` status is unreachable while
   * content.copyright_cleared != cleared". Enforced here at CRUD time (the
   * primary gate); the Pass B publish flow will recheck at publish time as
   * defense in depth. Both conditions are checked against the post-update
   * state: the clearance flag must be `cleared` AND the pillar-based
   * evidence rule must (still) hold — so a row whose flag was set while
   * evidence rules were looser (or set directly in the DB) can never slip
   * into `ready`.
   */
  private assertReadyTransitionAllowed(compliance: ComplianceState): void {
    if (compliance.copyrightCleared !== CopyrightClearance.cleared) {
      throw new BadRequestException(
        `Content cannot be marked ready: copyrightCleared is "${compliance.copyrightCleared}" ` +
          'but must be "cleared" first.',
      );
    }
    this.assertClearanceIsEligible(compliance);
  }

  /**
   * CopyrightGateService rule (System Analyst Condition #3): only `comedy`
   * pillar content may be cleared without evidence; `drama`, `product`, and
   * unclassified (null pillar — fail closed) content require a non-empty
   * copyrightEvidenceUrl.
   */
  private assertClearanceIsEligible(compliance: CopyrightGateInput): void {
    if (this.copyrightGate.canMarkCopyrightCleared(compliance)) {
      return;
    }
    const pillarLabel: string = compliance.contentPillar ?? 'unclassified (no pillar assigned)';
    throw new BadRequestException(
      `Copyright gate: ${pillarLabel} content requires a non-empty copyrightEvidenceUrl ` +
        'before it can be copyright-cleared (only the comedy pillar is exempt).',
    );
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Content, ContentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { ListContentQueryDto } from './dto/list-content-query.dto';

@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async create(dto: CreateContentDto, userId: string): Promise<Content> {
    this.assertAgeRangeIsValid(dto.targetAgeMin, dto.targetAgeMax);
    this.assertMediaUrlIsOwned(dto.mediaUrl);

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
   * The upload endpoint is the only place mediaUrl values are minted (local
   * disk adapter returns `/uploads/<uuid>.<ext>`). Content creation only
   * accepts a mediaUrl that matches that shape — never an arbitrary
   * client-supplied external URL — so this endpoint can't be used as an
   * open redirect / SSRF-adjacent primitive for referencing attacker-hosted
   * content as if it were locally stored.
   */
  private assertMediaUrlIsOwned(mediaUrl: string): void {
    if (!/^\/uploads\/[a-f0-9-]{36}\.(jpg|png|mp4)$/.test(mediaUrl)) {
      throw new BadRequestException(
        'mediaUrl must reference a file previously returned by POST /api/content/upload',
      );
    }
  }
}

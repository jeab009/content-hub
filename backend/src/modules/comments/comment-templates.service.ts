import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import {
  CommentTemplateResponseDto,
  CreateCommentTemplateDto,
  UpdateCommentTemplateDto,
} from './dto/comment-template.dto';

/**
 * Canned reply templates CRUD (capability g) — admin-owned. Inserting a
 * template into a reply still goes through the full step-up reply flow; this
 * service only manages the template rows. Every mutation is audited.
 */
@Injectable()
export class CommentTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async list(): Promise<CommentTemplateResponseDto[]> {
    const templates = await this.prisma.commentReplyTemplate.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    return templates.map(CommentTemplateResponseDto.fromEntity);
  }

  async create(dto: CreateCommentTemplateDto, userId: string): Promise<CommentTemplateResponseDto> {
    const template = await this.prisma.commentReplyTemplate.create({
      data: { title: dto.title, body: dto.body, createdBy: userId },
    });
    this.auditLog.record({
      actor: userId,
      action: 'comment_template_created',
      result: 'success',
      meta: { templateId: template.id },
    });
    return CommentTemplateResponseDto.fromEntity(template);
  }

  async update(
    id: string,
    dto: UpdateCommentTemplateDto,
    userId: string,
  ): Promise<CommentTemplateResponseDto> {
    await this.getOrThrow(id);
    const template = await this.prisma.commentReplyTemplate.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.body !== undefined && { body: dto.body }),
      },
    });
    this.auditLog.record({
      actor: userId,
      action: 'comment_template_updated',
      result: 'success',
      meta: { templateId: id },
    });
    return CommentTemplateResponseDto.fromEntity(template);
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.getOrThrow(id);
    await this.prisma.commentReplyTemplate.delete({ where: { id } });
    this.auditLog.record({
      actor: userId,
      action: 'comment_template_deleted',
      result: 'success',
      meta: { templateId: id },
    });
  }

  private async getOrThrow(id: string): Promise<void> {
    const existing = await this.prisma.commentReplyTemplate.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Comment reply template not found');
    }
  }
}

import { CommentReplyTemplate } from '@prisma/client';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { MAX_TEMPLATE_BODY_LENGTH, MAX_TEMPLATE_TITLE_LENGTH } from '../comments.constants';

/** Canned reply template create body. Length-capped (System Analyst C9). */
export class CreateCommentTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TEMPLATE_TITLE_LENGTH)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TEMPLATE_BODY_LENGTH)
  body!: string;
}

/** Partial update — at least one field, each still length-capped. */
export class UpdateCommentTemplateDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TEMPLATE_TITLE_LENGTH)
  title?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TEMPLATE_BODY_LENGTH)
  body?: string;
}

export class CommentTemplateResponseDto {
  id!: string;
  title!: string;
  body!: string;
  createdBy!: string;
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(template: CommentReplyTemplate): CommentTemplateResponseDto {
    return {
      id: template.id,
      title: template.title,
      body: template.body,
      createdBy: template.createdBy,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }
}

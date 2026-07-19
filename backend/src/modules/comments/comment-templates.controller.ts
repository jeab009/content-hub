import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { CommentTemplatesService } from './comment-templates.service';
import { CreateCommentTemplateDto, UpdateCommentTemplateDto } from './dto/comment-template.dto';

/**
 * Canned reply templates CRUD (capability g). Admin-only; mutations carry
 * CSRF — same guard posture as ContentController. Inserting a template into a
 * reply still goes through the full step-up reply flow.
 */
@Controller('api/comment-templates')
@UseGuards(SessionAuthGuard, AdminGuard)
export class CommentTemplatesController {
  constructor(private readonly templates: CommentTemplatesService) {}

  @Get()
  list() {
    return this.templates.list();
  }

  @Post()
  @UseGuards(CsrfGuard)
  create(@Body() dto: CreateCommentTemplateDto, @CurrentUserId() userId: string) {
    return this.templates.create(dto, userId);
  }

  @Patch(':id')
  @UseGuards(CsrfGuard)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCommentTemplateDto,
    @CurrentUserId() userId: string,
  ) {
    return this.templates.update(id, dto, userId);
  }

  @Delete(':id')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUserId() userId: string,
  ): Promise<void> {
    await this.templates.remove(id, userId);
  }
}

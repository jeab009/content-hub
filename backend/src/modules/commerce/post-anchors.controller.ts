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
  UseGuards,
} from '@nestjs/common';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { CommerceAnchorService } from './commerce-anchor.service';
import { RecordProductAnchorsDto } from './dto/record-product-anchors.dto';
import { ProductAnchorResponseDto } from './dto/product-anchor-response.dto';

/**
 * Product anchors on a TikTok/native post (6A.4). Deliberately lives in
 * `modules/commerce/` even though its route prefix is `/api/posts` — Nest
 * maps routes by decorator, not by directory, and keeping it here means
 * `modules/publish/` never has to import a commerce symbol (which the
 * static boundary scan would otherwise have to grant an exception for).
 *
 * No step-up (SA-3, confirmed) — see CommerceAnchorService's docblock.
 */
@Controller('api/posts')
@UseGuards(SessionAuthGuard, AdminGuard)
export class PostAnchorsController {
  constructor(private readonly anchors: CommerceAnchorService) {}

  @Post(':id/product-anchors')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.CREATED)
  async anchor(
    @Param('id', ParseUUIDPipe) postId: string,
    @Body() dto: RecordProductAnchorsDto,
    @CurrentUserId() userId: string,
  ): Promise<ProductAnchorResponseDto[]> {
    const created = await this.anchors.anchorToPost(postId, dto, userId);
    return created.map(ProductAnchorResponseDto.fromEntity);
  }

  @Get(':id/product-anchors')
  async list(@Param('id', ParseUUIDPipe) postId: string): Promise<ProductAnchorResponseDto[]> {
    const anchors = await this.anchors.listForPost(postId);
    return anchors.map(ProductAnchorResponseDto.fromEntity);
  }

  @Delete(':id/product-anchors/:anchorId')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) postId: string,
    @Param('anchorId', ParseUUIDPipe) anchorId: string,
    @CurrentUserId() userId: string,
  ): Promise<void> {
    await this.anchors.removeFromPost(postId, anchorId, userId);
  }
}

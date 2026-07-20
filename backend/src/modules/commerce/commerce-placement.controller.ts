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
 * Commerce placements (6A.5) and the product anchors attached to them
 * (6A.4). Anchors ship first — see CommerceAnchorService's docblock for why
 * they carry no step-up. `POST manual-external` / `GET` (the placement
 * record itself) land in the same file once 6A.5 is built, so everything
 * about a placement stays in one controller.
 */
@Controller('api/commerce/placements')
@UseGuards(SessionAuthGuard, AdminGuard)
export class CommercePlacementController {
  constructor(private readonly anchors: CommerceAnchorService) {}

  @Post(':id/product-anchors')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.CREATED)
  async anchor(
    @Param('id', ParseUUIDPipe) placementId: string,
    @Body() dto: RecordProductAnchorsDto,
    @CurrentUserId() userId: string,
  ): Promise<ProductAnchorResponseDto[]> {
    const created = await this.anchors.anchorToPlacement(placementId, dto, userId);
    return created.map(ProductAnchorResponseDto.fromEntity);
  }

  @Get(':id/product-anchors')
  async list(@Param('id', ParseUUIDPipe) placementId: string): Promise<ProductAnchorResponseDto[]> {
    const anchors = await this.anchors.listForPlacement(placementId);
    return anchors.map(ProductAnchorResponseDto.fromEntity);
  }

  @Delete(':id/product-anchors/:anchorId')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) placementId: string,
    @Param('anchorId', ParseUUIDPipe) anchorId: string,
    @CurrentUserId() userId: string,
  ): Promise<void> {
    await this.anchors.removeFromPlacement(placementId, anchorId, userId);
  }
}

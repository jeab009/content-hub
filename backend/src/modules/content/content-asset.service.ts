import { Injectable, NotFoundException } from '@nestjs/common';
import { ContentAsset } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { assertMediaUrlIsOwned } from './media-url.util';
import { CreateContentAssetDto } from './dto/create-content-asset.dto';

/**
 * CRUD for `content_assets` (Phase 1.5 schema): per-platform/aspect-ratio
 * variants of a piece of Content. Every operation is scoped to the parent
 * content id from the URL — an asset id is only ever addressable through
 * the content it belongs to, so one content's assets can't be read or
 * removed via another content's route (IDOR guard, same DB-truth pattern
 * as ConnectedAccountsService.findOwnedOrThrow).
 */
@Injectable()
export class ContentAssetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async add(contentId: string, dto: CreateContentAssetDto, userId: string): Promise<ContentAsset> {
    await this.assertContentExists(contentId);
    assertMediaUrlIsOwned(dto.mediaUrl);

    const asset = await this.prisma.contentAsset.create({
      data: {
        contentId,
        platform: dto.platform,
        aspectRatio: dto.aspectRatio,
        mediaUrl: dto.mediaUrl,
      },
    });

    this.auditLog.record({
      actor: userId,
      action: 'content_asset_added',
      result: 'success',
      meta: { contentId, assetId: asset.id, platform: asset.platform },
    });

    return asset;
  }

  async list(contentId: string): Promise<ContentAsset[]> {
    await this.assertContentExists(contentId);
    return this.prisma.contentAsset.findMany({
      where: { contentId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async remove(contentId: string, assetId: string, userId: string): Promise<void> {
    const asset = await this.prisma.contentAsset.findUnique({ where: { id: assetId } });
    // Same 404-not-403 shape for "doesn't exist" and "belongs to a different
    // content" — no existence leakage via status code alone.
    if (!asset || asset.contentId !== contentId) {
      throw new NotFoundException('Content asset not found');
    }

    await this.prisma.contentAsset.delete({ where: { id: assetId } });

    this.auditLog.record({
      actor: userId,
      action: 'content_asset_removed',
      result: 'success',
      meta: { contentId, assetId },
    });
  }

  private async assertContentExists(contentId: string): Promise<void> {
    const content = await this.prisma.content.findUnique({ where: { id: contentId } });
    if (!content) {
      throw new NotFoundException('Content not found');
    }
  }
}

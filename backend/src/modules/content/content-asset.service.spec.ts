import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AspectRatio, AssetPlatform } from '@prisma/client';
import { ContentAssetService } from './content-asset.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { CreateContentAssetDto } from './dto/create-content-asset.dto';

const OWNED_MEDIA_URL = '/uploads/123e4567-e89b-12d3-a456-426614174000.mp4';

function buildDto(overrides: Partial<CreateContentAssetDto> = {}): CreateContentAssetDto {
  const dto = new CreateContentAssetDto();
  Object.assign(dto, {
    platform: AssetPlatform.tiktok,
    aspectRatio: AspectRatio.ratio_9_16,
    mediaUrl: OWNED_MEDIA_URL,
    ...overrides,
  });
  return dto;
}

describe('ContentAssetService', () => {
  let prisma: {
    content: { findUnique: jest.Mock };
    contentAsset: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      delete: jest.Mock;
    };
  };
  let auditLog: { record: jest.Mock };
  let service: ContentAssetService;

  const storedAsset = {
    id: 'asset-1',
    contentId: 'content-1',
    platform: AssetPlatform.tiktok,
    aspectRatio: AspectRatio.ratio_9_16,
    mediaUrl: OWNED_MEDIA_URL,
    createdAt: new Date('2026-07-16T00:00:00Z'),
  };

  beforeEach(() => {
    prisma = {
      content: { findUnique: jest.fn().mockResolvedValue({ id: 'content-1' }) },
      contentAsset: {
        create: jest.fn().mockResolvedValue(storedAsset),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([storedAsset]),
        delete: jest.fn().mockResolvedValue(storedAsset),
      },
    };
    auditLog = { record: jest.fn() };
    service = new ContentAssetService(
      prisma as unknown as PrismaService,
      auditLog as unknown as AuditLogService,
    );
  });

  describe('add', () => {
    it('creates an asset scoped to the parent content and audits it', async () => {
      const asset = await service.add('content-1', buildDto(), 'user-1');

      expect(prisma.contentAsset.create).toHaveBeenCalledWith({
        data: {
          contentId: 'content-1',
          platform: AssetPlatform.tiktok,
          aspectRatio: AspectRatio.ratio_9_16,
          mediaUrl: OWNED_MEDIA_URL,
        },
      });
      expect(asset).toEqual(storedAsset);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'content_asset_added', result: 'success' }),
      );
    });

    it('throws NotFound when the parent content does not exist', async () => {
      prisma.content.findUnique.mockResolvedValue(null);

      await expect(service.add('missing', buildDto(), 'user-1')).rejects.toThrow(NotFoundException);
      expect(prisma.contentAsset.create).not.toHaveBeenCalled();
    });

    it('rejects a mediaUrl not minted by the upload endpoint', async () => {
      await expect(
        service.add(
          'content-1',
          buildDto({ mediaUrl: 'https://evil.example.com/x.mp4' }),
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.contentAsset.create).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('lists assets for the content in insertion order', async () => {
      await expect(service.list('content-1')).resolves.toEqual([storedAsset]);
      expect(prisma.contentAsset.findMany).toHaveBeenCalledWith({
        where: { contentId: 'content-1' },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('throws NotFound when the parent content does not exist', async () => {
      prisma.content.findUnique.mockResolvedValue(null);

      await expect(service.list('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes an asset that belongs to the given content and audits it', async () => {
      prisma.contentAsset.findUnique.mockResolvedValue(storedAsset);

      await service.remove('content-1', 'asset-1', 'user-1');

      expect(prisma.contentAsset.delete).toHaveBeenCalledWith({ where: { id: 'asset-1' } });
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'content_asset_removed', result: 'success' }),
      );
    });

    it('404s (not 403) when the asset belongs to a different content — no cross-content deletion', async () => {
      prisma.contentAsset.findUnique.mockResolvedValue({
        ...storedAsset,
        contentId: 'other-content',
      });

      await expect(service.remove('content-1', 'asset-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.contentAsset.delete).not.toHaveBeenCalled();
    });

    it('404s for a nonexistent asset id', async () => {
      prisma.contentAsset.findUnique.mockResolvedValue(null);

      await expect(service.remove('content-1', 'missing', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

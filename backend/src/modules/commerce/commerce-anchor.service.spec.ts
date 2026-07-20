import { ConflictException, NotFoundException } from '@nestjs/common';
import { CommerceSource, Prisma, ProductAnchor } from '@prisma/client';
import { CommerceAnchorService } from './commerce-anchor.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { RecordProductAnchorsDto } from './dto/record-product-anchors.dto';

function buildAnchor(overrides: Partial<ProductAnchor> = {}): ProductAnchor {
  return {
    id: 'anchor-1',
    postId: 'post-1',
    placementId: null,
    productId: 'product-1',
    affiliateLinkId: null,
    anchorPosition: null,
    anchoredAt: new Date('2026-07-20T00:00:00Z'),
    removedAt: null,
    source: CommerceSource.manual,
    recordedBy: 'user-1',
    createdAt: new Date('2026-07-20T00:00:00Z'),
    ...overrides,
  };
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function anchorsDto(
  ...items: { productId: string; affiliateLinkId?: string }[]
): RecordProductAnchorsDto {
  return Object.assign(new RecordProductAnchorsDto(), { anchors: items });
}

describe('CommerceAnchorService', () => {
  let prisma: {
    post: { findUnique: jest.Mock };
    commercePlacement: { findUnique: jest.Mock };
    commerceProduct: { findUnique: jest.Mock };
    affiliateLink: { findUnique: jest.Mock };
    productAnchor: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let auditLog: { record: jest.Mock };
  let service: CommerceAnchorService;

  beforeEach(() => {
    prisma = {
      post: { findUnique: jest.fn().mockResolvedValue({ id: 'post-1' }) },
      commercePlacement: { findUnique: jest.fn().mockResolvedValue({ id: 'placement-1' }) },
      commerceProduct: {
        findUnique: jest.fn().mockResolvedValue({ id: 'product-1', isActive: true }),
      },
      affiliateLink: {
        findUnique: jest.fn().mockResolvedValue({ id: 'link-1', productId: 'product-1' }),
      },
      productAnchor: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(buildAnchor(data))),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve(buildAnchor(data))),
      },
    };
    auditLog = { record: jest.fn() };
    service = new CommerceAnchorService(
      prisma as unknown as PrismaService,
      auditLog as unknown as AuditLogService,
    );
  });

  describe('anchorToPost', () => {
    it('404s when the post does not exist', async () => {
      prisma.post.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.anchorToPost('missing', anchorsDto({ productId: 'product-1' }), 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates an anchor and audits product_anchor_recorded', async () => {
      const result = await service.anchorToPost(
        'post-1',
        anchorsDto({ productId: 'product-1' }),
        'user-1',
      );

      expect(result).toHaveLength(1);
      expect(prisma.productAnchor.create).toHaveBeenCalledWith({
        data: {
          postId: 'post-1',
          productId: 'product-1',
          affiliateLinkId: null,
          recordedBy: 'user-1',
        },
      });
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'product_anchor_recorded', actor: 'user-1' }),
      );
    });

    it('is idempotent: an already-active anchor for (post, product) is returned, not duplicated', async () => {
      const existing = buildAnchor();
      prisma.productAnchor.findFirst.mockResolvedValueOnce(existing);

      const result = await service.anchorToPost(
        'post-1',
        anchorsDto({ productId: 'product-1' }),
        'user-1',
      );

      expect(result).toEqual([existing]);
      expect(prisma.productAnchor.create).not.toHaveBeenCalled();
    });

    it('rejects anchoring a retired product with 409', async () => {
      prisma.commerceProduct.findUnique.mockResolvedValueOnce({ id: 'product-1', isActive: false });
      await expect(
        service.anchorToPost('post-1', anchorsDto({ productId: 'product-1' }), 'user-1'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.productAnchor.create).not.toHaveBeenCalled();
    });

    it('404s when the product does not exist', async () => {
      prisma.commerceProduct.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.anchorToPost('post-1', anchorsDto({ productId: 'missing' }), 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a link that belongs to a different product with 409', async () => {
      prisma.affiliateLink.findUnique.mockResolvedValueOnce({
        id: 'link-1',
        productId: 'some-other-product',
      });
      await expect(
        service.anchorToPost(
          'post-1',
          anchorsDto({ productId: 'product-1', affiliateLinkId: 'link-1' }),
          'user-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('translates a concurrent-duplicate P2002 into a 409', async () => {
      prisma.productAnchor.create.mockRejectedValueOnce(p2002());
      await expect(
        service.anchorToPost('post-1', anchorsDto({ productId: 'product-1' }), 'user-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('anchorToPlacement', () => {
    it('404s when the placement does not exist', async () => {
      prisma.commercePlacement.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.anchorToPlacement('missing', anchorsDto({ productId: 'product-1' }), 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates an anchor against a placement target', async () => {
      await service.anchorToPlacement(
        'placement-1',
        anchorsDto({ productId: 'product-1' }),
        'user-1',
      );
      expect(prisma.productAnchor.create).toHaveBeenCalledWith({
        data: {
          placementId: 'placement-1',
          productId: 'product-1',
          affiliateLinkId: null,
          recordedBy: 'user-1',
        },
      });
    });
  });

  describe('removeFromPost', () => {
    it('404s when the anchor does not exist or is already removed', async () => {
      prisma.productAnchor.findFirst.mockResolvedValueOnce(null);
      await expect(service.removeFromPost('post-1', 'anchor-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('soft-removes (removedAt set) and audits product_anchor_removed', async () => {
      prisma.productAnchor.findFirst.mockResolvedValueOnce(buildAnchor());

      await service.removeFromPost('post-1', 'anchor-1', 'user-1');

      expect(prisma.productAnchor.update).toHaveBeenCalledWith({
        where: { id: 'anchor-1' },
        data: { removedAt: expect.any(Date) },
      });
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'product_anchor_removed', actor: 'user-1' }),
      );
    });
  });

  describe('listForPost', () => {
    it('orders by anchorPosition then anchoredAt (tie-break)', async () => {
      await service.listForPost('post-1');
      expect(prisma.productAnchor.findMany).toHaveBeenCalledWith({
        where: { postId: 'post-1', removedAt: null },
        orderBy: [{ anchorPosition: 'asc' }, { anchoredAt: 'asc' }],
      });
    });
  });
});

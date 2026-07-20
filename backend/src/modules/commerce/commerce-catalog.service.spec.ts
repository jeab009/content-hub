import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  AffiliateLink,
  CommerceChannel,
  CommerceProduct,
  CommerceSource,
  Prisma,
} from '@prisma/client';
import { CommerceCatalogService } from './commerce-catalog.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateAffiliateLinkDto } from './dto/create-affiliate-link.dto';

function buildProduct(overrides: Partial<CommerceProduct> = {}): CommerceProduct {
  return {
    id: 'product-1',
    channel: CommerceChannel.shopee,
    externalProductId: 'SHOPEE-1',
    name: 'A product',
    sku: null,
    productUrl: null,
    listPrice: null,
    currency: 'THB',
    commissionRatePct: null,
    isActive: true,
    retiredAt: null,
    source: CommerceSource.manual,
    createdBy: 'user-1',
    createdAt: new Date('2026-07-20T00:00:00Z'),
    updatedAt: new Date('2026-07-20T00:00:00Z'),
    ...overrides,
  };
}

function buildLink(overrides: Partial<AffiliateLink> = {}): AffiliateLink {
  return {
    id: 'link-1',
    productId: 'product-1',
    url: 'https://shopee.test/aff/1',
    trackingCode: null,
    subId: null,
    isActive: true,
    retiredAt: null,
    source: CommerceSource.manual,
    createdBy: 'user-1',
    createdAt: new Date('2026-07-20T00:00:00Z'),
    updatedAt: new Date('2026-07-20T00:00:00Z'),
    ...overrides,
  };
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('CommerceCatalogService', () => {
  let prisma: {
    commerceProduct: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
    affiliateLink: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let auditLog: { record: jest.Mock };
  let service: CommerceCatalogService;

  beforeEach(() => {
    prisma = {
      commerceProduct: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(buildProduct(data))),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve(buildProduct(data))),
        findUnique: jest.fn().mockResolvedValue(buildProduct()),
        findMany: jest.fn().mockResolvedValue([]),
      },
      affiliateLink: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(buildLink(data))),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve(buildLink(data))),
        findUnique: jest.fn().mockResolvedValue(buildLink()),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    auditLog = { record: jest.fn() };
    service = new CommerceCatalogService(
      prisma as unknown as PrismaService,
      auditLog as unknown as AuditLogService,
    );
  });

  describe('createProduct', () => {
    function dto(overrides: Partial<CreateProductDto> = {}): CreateProductDto {
      return Object.assign(new CreateProductDto(), {
        channel: CommerceChannel.shopee,
        externalProductId: 'SHOPEE-1',
        name: 'A product',
        ...overrides,
      });
    }

    it('defaults currency to THB and audits commerce_product_created', async () => {
      const product = await service.createProduct(dto(), 'user-1');

      expect(prisma.commerceProduct.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ currency: 'THB', createdBy: 'user-1' }),
      });
      expect(product.name).toBe('A product');
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'commerce_product_created',
          result: 'success',
          actor: 'user-1',
        }),
      );
    });

    it('rejects a non-THB currency (SA-9 service guard)', async () => {
      await expect(service.createProduct(dto({ currency: 'USD' }), 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.commerceProduct.create).not.toHaveBeenCalled();
    });

    it('translates a UNIQUE(channel, externalProductId) violation into a 409', async () => {
      prisma.commerceProduct.create.mockRejectedValueOnce(p2002());
      await expect(service.createProduct(dto(), 'user-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('updateProduct', () => {
    it('404s when the product does not exist', async () => {
      prisma.commerceProduct.findUnique.mockResolvedValueOnce(null);
      await expect(service.updateProduct('missing', {}, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('applies only the provided fields and audits changedFields', async () => {
      await service.updateProduct('product-1', { name: 'Renamed' }, 'user-1');

      expect(prisma.commerceProduct.update).toHaveBeenCalledWith({
        where: { id: 'product-1' },
        data: { name: 'Renamed' },
      });
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'commerce_product_updated',
          meta: expect.objectContaining({ changedFields: ['name'] }),
        }),
      );
    });

    it('rejects a non-THB currency on update too', async () => {
      await expect(
        service.updateProduct('product-1', { currency: 'USD' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('retireProduct', () => {
    it('soft-retires: isActive=false, retiredAt set, never a hard delete', async () => {
      await service.retireProduct('product-1', 'user-1');

      expect(prisma.commerceProduct.update).toHaveBeenCalledWith({
        where: { id: 'product-1' },
        data: { isActive: false, retiredAt: expect.any(Date) },
      });
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'commerce_product_retired' }),
      );
    });
  });

  describe('listProducts', () => {
    it('filters by channel/isActive/q', async () => {
      await service.listProducts({ channel: CommerceChannel.shopee, isActive: true, q: 'abc' });

      expect(prisma.commerceProduct.findMany).toHaveBeenCalledWith({
        where: {
          channel: CommerceChannel.shopee,
          isActive: true,
          name: { contains: 'abc', mode: Prisma.QueryMode.insensitive },
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('createLink', () => {
    function dto(overrides: Partial<CreateAffiliateLinkDto> = {}): CreateAffiliateLinkDto {
      return Object.assign(new CreateAffiliateLinkDto(), {
        url: 'https://shopee.test/aff/1',
        ...overrides,
      });
    }

    it('404s when the product does not exist', async () => {
      prisma.commerceProduct.findUnique.mockResolvedValueOnce(null);
      await expect(service.createLink('missing', dto(), 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('creates a link and excludes url/trackingCode from audit meta (SA-4)', async () => {
      const link = await service.createLink('product-1', dto({ trackingCode: 'TRACK1' }), 'user-1');

      expect(link.productId).toBe('product-1');
      const call = auditLog.record.mock.calls.find(
        ([entry]) => entry.action === 'affiliate_link_created',
      );
      expect(call[0].meta).not.toHaveProperty('url');
      expect(call[0].meta).not.toHaveProperty('trackingCode');
      expect(call[0].meta).toEqual(expect.objectContaining({ productId: 'product-1' }));
    });

    it('translates a UNIQUE(productId, url) violation into a 409', async () => {
      prisma.affiliateLink.create.mockRejectedValueOnce(p2002());
      await expect(service.createLink('product-1', dto(), 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('retireLink', () => {
    it('404s when the link does not exist', async () => {
      prisma.affiliateLink.findUnique.mockResolvedValueOnce(null);
      await expect(service.retireLink('missing', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('soft-retires: isActive=false, retiredAt set', async () => {
      await service.retireLink('link-1', 'user-1');

      expect(prisma.affiliateLink.update).toHaveBeenCalledWith({
        where: { id: 'link-1' },
        data: { isActive: false, retiredAt: expect.any(Date) },
      });
    });
  });

  describe('listLinks', () => {
    it('404s when the product does not exist', async () => {
      prisma.commerceProduct.findUnique.mockResolvedValueOnce(null);
      await expect(service.listLinks('missing')).rejects.toThrow(NotFoundException);
    });

    it('lists links for an existing product', async () => {
      await service.listLinks('product-1');
      expect(prisma.affiliateLink.findMany).toHaveBeenCalledWith({
        where: { productId: 'product-1' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });
});

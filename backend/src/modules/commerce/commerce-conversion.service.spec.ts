import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CommerceChannel, CommerceConversion, CommerceSource, Prisma } from '@prisma/client';
import { CommerceConversionService } from './commerce-conversion.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { CreateConversionDto } from './dto/create-conversion.dto';

function buildConversion(overrides: Partial<CommerceConversion> = {}): CommerceConversion {
  return {
    id: 'conversion-1',
    channel: CommerceChannel.shopee,
    periodStart: new Date('2026-07-01T00:00:00Z'),
    periodEnd: new Date('2026-07-07T00:00:00Z'),
    ordersCount: 10,
    itemsSold: 12,
    grossSalesAmount: new Prisma.Decimal('3000.00'),
    commissionAmount: new Prisma.Decimal('300.00'),
    currency: 'THB',
    postId: null,
    placementId: null,
    productId: null,
    affiliateLinkId: null,
    statementRef: 'SHP-2026-W27',
    reversalOfId: null,
    source: CommerceSource.manual,
    recordedBy: 'user-1',
    createdAt: new Date('2026-07-20T00:00:00Z'),
    ...overrides,
  };
}

function dto(overrides: Partial<CreateConversionDto> = {}): CreateConversionDto {
  return Object.assign(new CreateConversionDto(), {
    channel: CommerceChannel.shopee,
    periodStart: '2026-07-01',
    periodEnd: '2026-07-07',
    commissionAmount: 300,
    ...overrides,
  });
}

describe('CommerceConversionService', () => {
  let prisma: {
    commerceConversion: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
    };
  };
  let auditLog: { record: jest.Mock };
  let service: CommerceConversionService;

  beforeEach(() => {
    prisma = {
      commerceConversion: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(buildConversion(data))),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
      },
    };
    auditLog = { record: jest.fn() };
    service = new CommerceConversionService(
      prisma as unknown as PrismaService,
      auditLog as unknown as AuditLogService,
    );
  });

  describe('create', () => {
    it('appends a row, always writing THB currency server-side, and audits commerce_conversion_added', async () => {
      const conversion = await service.create(dto(), 'user-1');

      expect(prisma.commerceConversion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ currency: 'THB', recordedBy: 'user-1' }),
      });
      expect(conversion.channel).toBe(CommerceChannel.shopee);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'commerce_conversion_added', actor: 'user-1' }),
      );
    });

    it('allows a negative commissionAmount (reversal)', async () => {
      await service.create(dto({ commissionAmount: -4500 }), 'user-1');
      expect(prisma.commerceConversion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ commissionAmount: new Prisma.Decimal(-4500) }),
      });
    });

    it('excludes statementRef from audit meta (SA-4)', async () => {
      await service.create(dto({ statementRef: 'SHP-2026-W29' }), 'user-1');
      const call = auditLog.record.mock.calls.find(
        ([entry]) => entry.action === 'commerce_conversion_added',
      );
      expect(call[0].meta).not.toHaveProperty('statementRef');
    });

    describe('statementRef enforcement (QA-1 — service layer, not only the DTO)', () => {
      it('rejects a Latin-script personal name at the service layer', async () => {
        await expect(service.create(dto({ statementRef: 'John Smith' }), 'user-1')).rejects.toThrow(
          BadRequestException,
        );
        expect(prisma.commerceConversion.create).not.toHaveBeenCalled();
      });

      it('accepts a statement-shaped reference', async () => {
        await expect(
          service.create(dto({ statementRef: 'SHP-2026-W29' }), 'user-1'),
        ).resolves.toBeDefined();
      });
    });

    describe('M-4: periodEnd before periodStart rejects with a clean 400, not a raw DB error', () => {
      it('rejects periodEnd before periodStart', async () => {
        await expect(
          service.create(dto({ periodStart: '2026-07-10', periodEnd: '2026-07-01' }), 'user-1'),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.commerceConversion.create).not.toHaveBeenCalled();
      });

      it('accepts periodEnd equal to periodStart', async () => {
        await expect(
          service.create(dto({ periodStart: '2026-07-10', periodEnd: '2026-07-10' }), 'user-1'),
        ).resolves.toBeDefined();
      });
    });

    describe('idempotency window (C6)', () => {
      it('rejects a byte-identical payload from the same user within the window with 409', async () => {
        prisma.commerceConversion.findFirst.mockResolvedValueOnce({ id: 'earlier-conversion' });
        await expect(service.create(dto(), 'user-1')).rejects.toThrow(ConflictException);
        expect(prisma.commerceConversion.create).not.toHaveBeenCalled();
      });

      it('scopes the duplicate check to the SAME user (recordedBy)', async () => {
        await service.create(dto(), 'user-2');
        expect(prisma.commerceConversion.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ recordedBy: 'user-2' }),
          }),
        );
      });
    });

    describe('reversalOfId validation (SA-2)', () => {
      it('404s when the reversed row does not exist', async () => {
        prisma.commerceConversion.findUnique.mockResolvedValueOnce(null);
        await expect(service.create(dto({ reversalOfId: 'missing' }), 'user-1')).rejects.toThrow(
          NotFoundException,
        );
      });

      it('rejects a reversal pointing at a different channel', async () => {
        prisma.commerceConversion.findUnique.mockResolvedValueOnce(
          buildConversion({ channel: CommerceChannel.tiktok_shop }),
        );
        await expect(
          service.create(
            dto({ reversalOfId: 'conversion-1', channel: CommerceChannel.shopee }),
            'user-1',
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('accepts a same-channel reversal and links reversalOfId', async () => {
        prisma.commerceConversion.findUnique.mockResolvedValueOnce(
          buildConversion({ id: 'conversion-1', channel: CommerceChannel.shopee }),
        );

        await service.create(
          dto({
            reversalOfId: 'conversion-1',
            channel: CommerceChannel.shopee,
            commissionAmount: -300,
          }),
          'user-1',
        );

        expect(prisma.commerceConversion.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ reversalOfId: 'conversion-1' }),
        });
      });

      it('BUG-QA-6A-01: inherits linkage from the target row, ignoring whatever the client sent — a reversal that omitted/mismatched postId/placementId used to net correctly in the GLOBAL summary but silently vanish from the PER-CONTENT one, since that view filters by placementId/postId', async () => {
        prisma.commerceConversion.findUnique.mockResolvedValueOnce(
          buildConversion({
            id: 'conversion-1',
            channel: CommerceChannel.shopee,
            postId: 'post-original',
            placementId: 'placement-original',
            productId: 'product-original',
            affiliateLinkId: 'link-original',
          }),
        );

        // Client sends NO linkage fields at all (the exact repro: omitted,
        // not just wrong) alongside an unrelated productId that must be
        // discarded rather than trusted.
        await service.create(
          dto({
            reversalOfId: 'conversion-1',
            channel: CommerceChannel.shopee,
            commissionAmount: -300,
            postId: undefined,
            placementId: undefined,
            productId: 'product-attacker-supplied',
            affiliateLinkId: undefined,
          }),
          'user-1',
        );

        expect(prisma.commerceConversion.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            postId: 'post-original',
            placementId: 'placement-original',
            productId: 'product-original',
            affiliateLinkId: 'link-original',
          }),
        });
      });

      it('a non-reversal row still uses the client-supplied linkage (no target to inherit from)', async () => {
        await service.create(
          dto({ postId: 'post-1', placementId: 'placement-1', productId: 'product-1' }),
          'user-1',
        );

        expect(prisma.commerceConversion.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            postId: 'post-1',
            placementId: 'placement-1',
            productId: 'product-1',
          }),
        });
      });
    });
  });

  describe('list', () => {
    it('filters by channel/productId/placementId/postId and orders newest first', async () => {
      await service.list({
        channel: CommerceChannel.shopee,
        productId: 'product-1',
        placementId: 'placement-1',
        postId: 'post-1',
      });
      expect(prisma.commerceConversion.findMany).toHaveBeenCalledWith({
        where: {
          channel: CommerceChannel.shopee,
          productId: 'product-1',
          placementId: 'placement-1',
          postId: 'post-1',
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('checkOverlap', () => {
    it('probes for a period overlap on the same channel (warn-only)', async () => {
      await service.checkOverlap({
        channel: CommerceChannel.shopee,
        periodStart: '2026-07-01',
        periodEnd: '2026-07-07',
      });
      expect(prisma.commerceConversion.findMany).toHaveBeenCalledWith({
        where: {
          channel: CommerceChannel.shopee,
          periodStart: { lte: new Date('2026-07-07') },
          periodEnd: { gte: new Date('2026-07-01') },
        },
        orderBy: { periodStart: 'asc' },
      });
    });
  });
});

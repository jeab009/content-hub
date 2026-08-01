import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AdCampaign, AdCampaignStatus, AdChannel, AdSource, Prisma } from '@prisma/client';
import { PaidCampaignService } from './paid-campaign.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { ContentService } from '../content/content.service';
import { CreatePaidCampaignDto } from './dto/create-paid-campaign.dto';

function buildCampaign(overrides: Partial<AdCampaign> = {}): AdCampaign {
  return {
    id: 'campaign-1',
    channel: AdChannel.meta,
    externalCampaignName: 'Summer Skincare Reach',
    externalCampaignId: 'META-1',
    objective: 'Traffic',
    contentId: null,
    startDate: new Date('2026-07-01T00:00:00Z'),
    endDate: null,
    plannedBudget: null,
    currency: 'THB',
    status: AdCampaignStatus.active,
    isActive: true,
    retiredAt: null,
    source: AdSource.manual,
    createdBy: 'user-1',
    createdAt: new Date('2026-07-20T00:00:00Z'),
    updatedAt: new Date('2026-07-20T00:00:00Z'),
    ...overrides,
  };
}

function dto(overrides: Partial<CreatePaidCampaignDto> = {}): CreatePaidCampaignDto {
  return Object.assign(new CreatePaidCampaignDto(), {
    channel: AdChannel.meta,
    externalCampaignName: 'Summer Skincare Reach',
    objective: 'Traffic',
    startDate: '2026-07-01',
    ...overrides,
  });
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('PaidCampaignService', () => {
  let prisma: {
    adCampaign: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let auditLog: { record: jest.Mock };
  let content: { findOne: jest.Mock };
  let service: PaidCampaignService;

  beforeEach(() => {
    prisma = {
      adCampaign: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(buildCampaign(data))),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve(buildCampaign(data))),
        findUnique: jest.fn().mockResolvedValue(buildCampaign()),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    auditLog = { record: jest.fn() };
    content = { findOne: jest.fn().mockResolvedValue({ id: 'content-1' }) };
    service = new PaidCampaignService(
      prisma as unknown as PrismaService,
      auditLog as unknown as AuditLogService,
      content as unknown as ContentService,
    );
  });

  describe('create', () => {
    it('creates a campaign, defaulting to THB, and audits ad_campaign_created', async () => {
      const campaign = await service.create(dto(), 'user-1');

      expect(prisma.adCampaign.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ currency: 'THB', createdBy: 'user-1' }),
      });
      expect(campaign.channel).toBe(AdChannel.meta);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ad_campaign_created', actor: 'user-1' }),
      );
    });

    it('excludes objective/externalCampaignName/externalCampaignId from audit meta (SA-P4)', async () => {
      await service.create(dto({ externalCampaignId: 'META-99' }), 'user-1');
      const call = auditLog.record.mock.calls.find(
        ([entry]) => entry.action === 'ad_campaign_created',
      );
      expect(call[0].meta).not.toHaveProperty('objective');
      expect(call[0].meta).not.toHaveProperty('externalCampaignName');
      expect(call[0].meta).not.toHaveProperty('externalCampaignId');
    });

    it('rejects a non-THB currency (SA-P6)', async () => {
      await expect(service.create(dto({ currency: 'USD' }), 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.adCampaign.create).not.toHaveBeenCalled();
    });

    it('validates the optional contentId picker via ContentService.findOne', async () => {
      await service.create(dto({ contentId: 'content-1' }), 'user-1');
      expect(content.findOne).toHaveBeenCalledWith('content-1');
    });

    it('404s when contentId does not refer to a real content row', async () => {
      content.findOne.mockRejectedValueOnce(new NotFoundException('Content not found'));
      await expect(service.create(dto({ contentId: 'missing' }), 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.adCampaign.create).not.toHaveBeenCalled();
    });

    it('translates a UNIQUE(channel, externalCampaignId) violation into a 409', async () => {
      prisma.adCampaign.create.mockRejectedValueOnce(p2002());
      await expect(service.create(dto({ externalCampaignId: 'META-1' }), 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });

    describe('BUG-7A-01: endDate before startDate rejects with a clean 400, not a raw DB error', () => {
      it('rejects endDate before startDate', async () => {
        await expect(
          service.create(dto({ startDate: '2026-07-10', endDate: '2026-07-01' }), 'user-1'),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.adCampaign.create).not.toHaveBeenCalled();
      });

      it('accepts endDate equal to startDate', async () => {
        await expect(
          service.create(dto({ startDate: '2026-07-10', endDate: '2026-07-10' }), 'user-1'),
        ).resolves.toBeDefined();
      });

      it('accepts a null endDate ("still running")', async () => {
        await expect(
          service.create(dto({ startDate: '2026-07-10' }), 'user-1'),
        ).resolves.toBeDefined();
      });
    });
  });

  describe('update', () => {
    it("does not accept channel or externalCampaignId — they aren't on UpdatePaidCampaignDto", async () => {
      await service.update('campaign-1', { objective: 'Conversions' }, 'user-1');
      expect(prisma.adCampaign.update).toHaveBeenCalledWith({
        where: { id: 'campaign-1' },
        data: { objective: 'Conversions' },
      });
    });

    it('404s when the campaign does not exist', async () => {
      prisma.adCampaign.findUnique.mockResolvedValueOnce(null);
      await expect(service.update('missing', { objective: 'x' }, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('validates a newly-set contentId picker', async () => {
      await service.update('campaign-1', { contentId: 'content-2' }, 'user-1');
      expect(content.findOne).toHaveBeenCalledWith('content-2');
    });

    describe('BUG-7A-01: partial update checks the EFFECTIVE date range', () => {
      it('rejects a new endDate that falls before the EXISTING startDate (2026-07-01)', async () => {
        await expect(
          service.update('campaign-1', { endDate: '2026-06-01' }, 'user-1'),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.adCampaign.update).not.toHaveBeenCalled();
      });

      it('rejects a new startDate that falls after the EXISTING endDate', async () => {
        prisma.adCampaign.findUnique.mockResolvedValueOnce(
          buildCampaign({ startDate: new Date('2026-07-01'), endDate: new Date('2026-07-10') }),
        );
        await expect(
          service.update('campaign-1', { startDate: '2026-07-20' }, 'user-1'),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.adCampaign.update).not.toHaveBeenCalled();
      });

      it('accepts a new endDate that is still after the existing startDate', async () => {
        await expect(
          service.update('campaign-1', { endDate: '2026-08-01' }, 'user-1'),
        ).resolves.toBeDefined();
      });
    });
  });

  describe('retire', () => {
    it('soft-retires: isActive=false, retiredAt set, never a hard delete', async () => {
      await service.retire('campaign-1', 'user-1');
      expect(prisma.adCampaign.update).toHaveBeenCalledWith({
        where: { id: 'campaign-1' },
        data: expect.objectContaining({ isActive: false, retiredAt: expect.any(Date) }),
      });
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ad_campaign_retired' }),
      );
    });

    it('404s when the campaign does not exist', async () => {
      prisma.adCampaign.findUnique.mockResolvedValueOnce(null);
      await expect(service.retire('missing', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('filters by isActive/contentId/q', async () => {
      await service.list({ isActive: true, contentId: 'content-1', q: 'summer' });
      expect(prisma.adCampaign.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ isActive: true, contentId: 'content-1' }),
        orderBy: { createdAt: 'desc' },
      });
    });
  });
});

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  AdCampaign,
  AdCampaignStatus,
  AdChannel,
  AdPerformanceEntry,
  AdSource,
  Prisma,
} from '@prisma/client';
import { PaidPerformanceService } from './paid-performance.service';
import { PaidCampaignService } from './paid-campaign.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { CreatePerformanceEntryDto } from './dto/create-performance-entry.dto';

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

function buildEntry(overrides: Partial<AdPerformanceEntry> = {}): AdPerformanceEntry {
  return {
    id: 'entry-1',
    campaignId: 'campaign-1',
    spend: new Prisma.Decimal('300.00'),
    reach: 5000,
    impressions: 9000,
    clicks: 120,
    resultType: 'link_clicks',
    resultCount: 120,
    currency: 'THB',
    periodStart: new Date('2026-07-01T00:00:00Z'),
    periodEnd: new Date('2026-07-07T00:00:00Z'),
    sourceRef: 'META-ADSMGR-W27',
    correctsEntryId: null,
    source: AdSource.manual,
    recordedBy: 'user-1',
    createdAt: new Date('2026-07-20T00:00:00Z'),
    ...overrides,
  };
}

function dto(overrides: Partial<CreatePerformanceEntryDto> = {}): CreatePerformanceEntryDto {
  return Object.assign(new CreatePerformanceEntryDto(), {
    periodStart: '2026-07-01',
    periodEnd: '2026-07-07',
    spend: 300,
    ...overrides,
  });
}

describe('PaidPerformanceService', () => {
  let prisma: {
    adPerformanceEntry: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
    };
  };
  let auditLog: { record: jest.Mock };
  let campaigns: { findOrThrow: jest.Mock };
  let service: PaidPerformanceService;

  beforeEach(() => {
    prisma = {
      adPerformanceEntry: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(buildEntry(data))),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
      },
    };
    auditLog = { record: jest.fn() };
    campaigns = { findOrThrow: jest.fn().mockResolvedValue(buildCampaign()) };
    service = new PaidPerformanceService(
      prisma as unknown as PrismaService,
      auditLog as unknown as AuditLogService,
      campaigns as unknown as PaidCampaignService,
    );
  });

  describe('addEntry', () => {
    it('appends a row, defaults to THB, and audits ad_performance_entry_added', async () => {
      const entry = await service.addEntry('campaign-1', dto(), 'user-1');

      expect(campaigns.findOrThrow).toHaveBeenCalledWith('campaign-1');
      expect(prisma.adPerformanceEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ currency: 'THB', recordedBy: 'user-1' }),
      });
      expect(entry.campaignId).toBe('campaign-1');
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ad_performance_entry_added', actor: 'user-1' }),
      );
    });

    it('404s when the campaign does not exist', async () => {
      campaigns.findOrThrow.mockRejectedValueOnce(new NotFoundException('Ad campaign not found'));
      await expect(service.addEntry('missing', dto(), 'user-1')).rejects.toThrow(NotFoundException);
      expect(prisma.adPerformanceEntry.create).not.toHaveBeenCalled();
    });

    it('excludes sourceRef from audit meta (SA-P4)', async () => {
      await service.addEntry('campaign-1', dto({ sourceRef: 'META-ADSMGR-W29' }), 'user-1');
      const call = auditLog.record.mock.calls.find(
        ([entry]) => entry.action === 'ad_performance_entry_added',
      );
      expect(call[0].meta).not.toHaveProperty('sourceRef');
    });

    it('rejects a non-THB currency (SA-P6)', async () => {
      await expect(
        service.addEntry('campaign-1', dto({ currency: 'USD' }), 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.adPerformanceEntry.create).not.toHaveBeenCalled();
    });

    describe('sourceRef enforcement (P-A1 — service layer, not only the DTO)', () => {
      it('rejects a Latin-script personal name at the service layer', async () => {
        await expect(
          service.addEntry('campaign-1', dto({ sourceRef: 'John Smith' }), 'user-1'),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.adPerformanceEntry.create).not.toHaveBeenCalled();
      });

      it('accepts a source-ref-shaped reference', async () => {
        await expect(
          service.addEntry('campaign-1', dto({ sourceRef: 'META-ADSMGR-W29' }), 'user-1'),
        ).resolves.toBeDefined();
      });
    });

    describe('BUG-7B-01: periodEnd before periodStart rejects with a clean 400, not a raw DB error', () => {
      it('rejects periodEnd before periodStart', async () => {
        await expect(
          service.addEntry(
            'campaign-1',
            dto({ periodStart: '2026-07-10', periodEnd: '2026-07-01' }),
            'user-1',
          ),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.adPerformanceEntry.create).not.toHaveBeenCalled();
      });

      it('accepts periodEnd equal to periodStart', async () => {
        await expect(
          service.addEntry(
            'campaign-1',
            dto({ periodStart: '2026-07-10', periodEnd: '2026-07-10' }),
            'user-1',
          ),
        ).resolves.toBeDefined();
      });
    });

    describe('idempotency window (§4.2 finding, condition 9)', () => {
      it('rejects a byte-identical payload from the same recordedBy within the window with 409', async () => {
        prisma.adPerformanceEntry.findFirst.mockResolvedValueOnce({ id: 'earlier-entry' });
        await expect(service.addEntry('campaign-1', dto(), 'user-1')).rejects.toThrow(
          ConflictException,
        );
        expect(prisma.adPerformanceEntry.create).not.toHaveBeenCalled();
      });

      it('scopes the duplicate check to the SAME recordedBy', async () => {
        await service.addEntry('campaign-1', dto(), 'user-2');
        expect(prisma.adPerformanceEntry.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ recordedBy: 'user-2', campaignId: 'campaign-1' }),
          }),
        );
      });
    });

    describe('correctsEntryId validation (P-A3)', () => {
      it('404s when the corrected entry does not exist', async () => {
        prisma.adPerformanceEntry.findUnique.mockResolvedValueOnce(null);
        await expect(
          service.addEntry('campaign-1', dto({ correctsEntryId: 'missing' }), 'user-1'),
        ).rejects.toThrow(NotFoundException);
        expect(prisma.adPerformanceEntry.create).not.toHaveBeenCalled();
      });

      it('rejects a correction pointing at an entry on a DIFFERENT campaign', async () => {
        prisma.adPerformanceEntry.findUnique.mockResolvedValueOnce(
          buildEntry({ id: 'entry-1', campaignId: 'campaign-OTHER' }),
        );
        await expect(
          service.addEntry('campaign-1', dto({ correctsEntryId: 'entry-1' }), 'user-1'),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.adPerformanceEntry.create).not.toHaveBeenCalled();
      });

      it('accepts a correction pointing at an entry on the SAME campaign', async () => {
        prisma.adPerformanceEntry.findUnique.mockResolvedValueOnce(
          buildEntry({ id: 'entry-1', campaignId: 'campaign-1' }),
        );
        await service.addEntry('campaign-1', dto({ correctsEntryId: 'entry-1' }), 'user-1');
        expect(prisma.adPerformanceEntry.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ correctsEntryId: 'entry-1' }),
        });
      });
    });
  });

  describe('list', () => {
    it('validates the campaign exists and returns history newest-first', async () => {
      await service.list('campaign-1');
      expect(campaigns.findOrThrow).toHaveBeenCalledWith('campaign-1');
      expect(prisma.adPerformanceEntry.findMany).toHaveBeenCalledWith({
        where: { campaignId: 'campaign-1' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('checkOverlap', () => {
    it('probes for a period overlap on the same campaign (warn-only)', async () => {
      await service.checkOverlap('campaign-1', {
        periodStart: '2026-07-01',
        periodEnd: '2026-07-07',
      });
      expect(prisma.adPerformanceEntry.findMany).toHaveBeenCalledWith({
        where: {
          campaignId: 'campaign-1',
          periodStart: { lte: new Date('2026-07-07') },
          periodEnd: { gte: new Date('2026-07-01') },
        },
        orderBy: { periodStart: 'asc' },
      });
    });
  });
});

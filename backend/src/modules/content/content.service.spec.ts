import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  Content,
  ContentPillar,
  ContentStatus,
  ContentType,
  CopyrightClearance,
  LicensingStatus,
  Prisma,
} from '@prisma/client';
import { ContentService } from './content.service';
import { CopyrightGateService } from './copyright-gate.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { CreateContentDto } from './dto/create-content.dto';

const OWNED_MEDIA_URL = '/uploads/123e4567-e89b-12d3-a456-426614174000.jpg';
const EVIDENCE_URL = 'https://evidence.example.com/license-123.pdf';

function buildContent(overrides: Partial<Content> = {}): Content {
  return {
    id: 'content-1',
    type: ContentType.image,
    title: 'Existing title',
    mediaUrl: OWNED_MEDIA_URL,
    caption: null,
    targetAgeMin: 18,
    targetAgeMax: 30,
    status: ContentStatus.draft,
    licensingStatus: LicensingStatus.unlicensed,
    licenseNotes: null,
    licenseExpiresAt: null,
    fileSizeBytes: null,
    mimeType: null,
    contentPillar: null,
    targetAgeSegment: null,
    copyrightCleared: CopyrightClearance.not_checked,
    copyrightNotes: null,
    copyrightEvidenceUrl: null,
    createdBy: 'user-1',
    createdAt: new Date('2026-07-16T00:00:00Z'),
    updatedAt: new Date('2026-07-16T00:00:00Z'),
    ...overrides,
  };
}

function buildCreateDto(overrides: Partial<CreateContentDto> = {}): CreateContentDto {
  const dto = new CreateContentDto();
  Object.assign(dto, {
    type: ContentType.image,
    title: 'New content',
    mediaUrl: OWNED_MEDIA_URL,
    targetAgeMin: 18,
    targetAgeMax: 30,
    licensingStatus: LicensingStatus.unlicensed,
    ...overrides,
  });
  return dto;
}

describe('ContentService', () => {
  let prisma: {
    content: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let auditLog: { record: jest.Mock };
  let service: ContentService;

  beforeEach(() => {
    prisma = {
      content: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(buildContent(data))),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve(buildContent(data))),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    auditLog = { record: jest.fn() };

    // Real gate service on purpose: it is pure, already unit-tested, and
    // using it here proves the integration (not just that a mock was called).
    service = new ContentService(
      prisma as unknown as PrismaService,
      auditLog as unknown as AuditLogService,
      new CopyrightGateService(),
    );
  });

  describe('create', () => {
    it('creates a draft and records an audit entry', async () => {
      const content = await service.create(buildCreateDto(), 'user-1');

      expect(prisma.content.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: 'New content',
          status: ContentStatus.draft,
          copyrightCleared: CopyrightClearance.not_checked,
          createdBy: 'user-1',
        }),
      });
      expect(content.status).toBe(ContentStatus.draft);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'content_created', result: 'success', actor: 'user-1' }),
      );
    });

    it('rejects an inverted age range', async () => {
      await expect(
        service.create(buildCreateDto({ targetAgeMin: 40, targetAgeMax: 20 }), 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.content.create).not.toHaveBeenCalled();
    });

    it('rejects a mediaUrl that was not minted by the upload endpoint', async () => {
      await expect(
        service.create(buildCreateDto({ mediaUrl: 'https://evil.example.com/x.jpg' }), 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.content.create).not.toHaveBeenCalled();
    });

    it('rejects a mediaUrl with a traversal-shaped path', async () => {
      await expect(
        service.create(buildCreateDto({ mediaUrl: '/uploads/../../etc/passwd' }), 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.content.create).not.toHaveBeenCalled();
    });

    it('allows markReady for cleared comedy content with no evidence', async () => {
      const content = await service.create(
        buildCreateDto({
          markReady: true,
          contentPillar: ContentPillar.comedy,
          copyrightCleared: CopyrightClearance.cleared,
        }),
        'user-1',
      );

      expect(content.status).toBe(ContentStatus.ready);
    });

    it('rejects markReady when copyrightCleared is not "cleared"', async () => {
      await expect(
        service.create(
          buildCreateDto({ markReady: true, contentPillar: ContentPillar.comedy }),
          'user-1',
        ),
      ).rejects.toThrow(/copyrightCleared/);
      expect(prisma.content.create).not.toHaveBeenCalled();
    });

    it('rejects markReady for drama content without evidence even when the cleared flag is set', async () => {
      await expect(
        service.create(
          buildCreateDto({
            markReady: true,
            contentPillar: ContentPillar.drama,
            copyrightCleared: CopyrightClearance.cleared,
          }),
          'user-1',
        ),
      ).rejects.toThrow(/copyrightEvidenceUrl/);
      expect(prisma.content.create).not.toHaveBeenCalled();
    });

    it('allows markReady for cleared drama content that has evidence', async () => {
      const content = await service.create(
        buildCreateDto({
          markReady: true,
          contentPillar: ContentPillar.drama,
          copyrightCleared: CopyrightClearance.cleared,
          copyrightEvidenceUrl: EVIDENCE_URL,
        }),
        'user-1',
      );

      expect(content.status).toBe(ContentStatus.ready);
    });

    it('rejects setting copyrightCleared=cleared on unclassified (null pillar) content without evidence', async () => {
      await expect(
        service.create(buildCreateDto({ copyrightCleared: CopyrightClearance.cleared }), 'user-1'),
      ).rejects.toThrow(/unclassified/);
      expect(prisma.content.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('applies a partial update and audits the changed fields', async () => {
      prisma.content.findUnique.mockResolvedValue(buildContent());

      await service.update('content-1', { title: 'Renamed' }, 'user-1');

      expect(prisma.content.update).toHaveBeenCalledWith({
        where: { id: 'content-1' },
        data: { title: 'Renamed' },
      });
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'content_updated',
          meta: { contentId: 'content-1', changedFields: ['title'] },
        }),
      );
    });

    it('throws NotFound for a nonexistent content id', async () => {
      prisma.content.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', { title: 'X' }, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.content.update).not.toHaveBeenCalled();
    });

    it('validates the merged age range (patch min above stored max)', async () => {
      prisma.content.findUnique.mockResolvedValue(buildContent({ targetAgeMax: 30 }));

      await expect(service.update('content-1', { targetAgeMin: 45 }, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.content.update).not.toHaveBeenCalled();
    });

    it('allows the ready transition for cleared comedy content with no evidence', async () => {
      prisma.content.findUnique.mockResolvedValue(
        buildContent({
          contentPillar: ContentPillar.comedy,
          copyrightCleared: CopyrightClearance.cleared,
        }),
      );

      await service.update('content-1', { status: ContentStatus.ready }, 'user-1');

      expect(prisma.content.update).toHaveBeenCalledWith({
        where: { id: 'content-1' },
        data: { status: ContentStatus.ready },
      });
    });

    it('blocks the ready transition while copyrightCleared != cleared', async () => {
      prisma.content.findUnique.mockResolvedValue(
        buildContent({
          contentPillar: ContentPillar.comedy,
          copyrightCleared: CopyrightClearance.not_checked,
        }),
      );

      await expect(
        service.update('content-1', { status: ContentStatus.ready }, 'user-1'),
      ).rejects.toThrow(/copyrightCleared/);
      expect(prisma.content.update).not.toHaveBeenCalled();
    });

    it('blocks the ready transition for blocked content', async () => {
      prisma.content.findUnique.mockResolvedValue(
        buildContent({
          contentPillar: ContentPillar.comedy,
          copyrightCleared: CopyrightClearance.blocked,
        }),
      );

      await expect(
        service.update('content-1', { status: ContentStatus.ready }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('blocks the ready transition for drama content without evidence even when the stored flag says cleared', async () => {
      prisma.content.findUnique.mockResolvedValue(
        buildContent({
          contentPillar: ContentPillar.drama,
          copyrightCleared: CopyrightClearance.cleared,
          copyrightEvidenceUrl: null,
        }),
      );

      await expect(
        service.update('content-1', { status: ContentStatus.ready }, 'user-1'),
      ).rejects.toThrow(/copyrightEvidenceUrl/);
      expect(prisma.content.update).not.toHaveBeenCalled();
    });

    it('blocks the ready transition for product content without evidence', async () => {
      prisma.content.findUnique.mockResolvedValue(
        buildContent({
          contentPillar: ContentPillar.product,
          copyrightCleared: CopyrightClearance.cleared,
          copyrightEvidenceUrl: null,
        }),
      );

      await expect(
        service.update('content-1', { status: ContentStatus.ready }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows marking ready when the same patch supplies clearance and evidence for drama', async () => {
      prisma.content.findUnique.mockResolvedValue(
        buildContent({ contentPillar: ContentPillar.drama }),
      );

      await service.update(
        'content-1',
        {
          status: ContentStatus.ready,
          copyrightCleared: CopyrightClearance.cleared,
          copyrightEvidenceUrl: EVIDENCE_URL,
        },
        'user-1',
      );

      expect(prisma.content.update).toHaveBeenCalled();
    });

    it('rejects setting copyrightCleared=cleared for drama content without evidence', async () => {
      prisma.content.findUnique.mockResolvedValue(
        buildContent({ contentPillar: ContentPillar.drama }),
      );

      await expect(
        service.update('content-1', { copyrightCleared: CopyrightClearance.cleared }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.content.update).not.toHaveBeenCalled();
    });

    it('allows setting copyrightCleared=cleared for comedy content without evidence', async () => {
      prisma.content.findUnique.mockResolvedValue(
        buildContent({ contentPillar: ContentPillar.comedy }),
      );

      await service.update('content-1', { copyrightCleared: CopyrightClearance.cleared }, 'user-1');

      expect(prisma.content.update).toHaveBeenCalled();
    });

    describe('BUG-QA-002: ready-gate cannot be bypassed via a partial PATCH', () => {
      const readyComedy = () =>
        buildContent({
          status: ContentStatus.ready,
          contentPillar: ContentPillar.comedy,
          copyrightCleared: CopyrightClearance.cleared,
          copyrightEvidenceUrl: null,
        });

      const readyDramaWithEvidence = () =>
        buildContent({
          status: ContentStatus.ready,
          contentPillar: ContentPillar.drama,
          copyrightCleared: CopyrightClearance.cleared,
          copyrightEvidenceUrl: EVIDENCE_URL,
        });

      it('rejects flipping an already-ready comedy row to drama (no evidence) even without status in the patch', async () => {
        prisma.content.findUnique.mockResolvedValue(readyComedy());

        await expect(
          service.update('content-1', { contentPillar: ContentPillar.drama }, 'user-1'),
        ).rejects.toThrow(/copyrightEvidenceUrl/);
        // Row is left untouched — stays comedy/ready.
        expect(prisma.content.update).not.toHaveBeenCalled();
      });

      it('rejects blanking the evidence url of an already-ready drama row', async () => {
        prisma.content.findUnique.mockResolvedValue(readyDramaWithEvidence());

        // Empty string is the realistic PATCH form of "remove evidence" — the
        // gate treats a blank url as no-evidence (hasEvidence trims).
        await expect(
          service.update('content-1', { copyrightEvidenceUrl: '' }, 'user-1'),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.content.update).not.toHaveBeenCalled();
      });

      it('rejects downgrading clearance to not_checked on an already-ready row', async () => {
        prisma.content.findUnique.mockResolvedValue(readyComedy());

        await expect(
          service.update(
            'content-1',
            { copyrightCleared: CopyrightClearance.not_checked },
            'user-1',
          ),
        ).rejects.toThrow(/copyrightCleared/);
        expect(prisma.content.update).not.toHaveBeenCalled();
      });

      it('still allows a compliant PATCH on a ready row (e.g. caption edit)', async () => {
        prisma.content.findUnique.mockResolvedValue(readyComedy());

        await service.update('content-1', { caption: 'Updated caption' }, 'user-1');

        expect(prisma.content.update).toHaveBeenCalledWith({
          where: { id: 'content-1' },
          data: { caption: 'Updated caption' },
        });
      });

      it('allows a compliant pillar swap on a ready row when evidence still satisfies the new pillar', async () => {
        // drama (with evidence) -> product (evidence still present) stays valid.
        prisma.content.findUnique.mockResolvedValue(readyDramaWithEvidence());

        await service.update('content-1', { contentPillar: ContentPillar.product }, 'user-1');

        expect(prisma.content.update).toHaveBeenCalled();
      });
    });
  });

  describe('archive', () => {
    it('archives (soft-deletes) and audits', async () => {
      prisma.content.findUnique.mockResolvedValue(buildContent());

      await service.archive('content-1', 'user-1');

      expect(prisma.content.update).toHaveBeenCalledWith({
        where: { id: 'content-1' },
        data: { status: ContentStatus.archived },
      });
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'content_archived', result: 'success' }),
      );
    });

    it('throws NotFound for a nonexistent content id', async () => {
      prisma.content.findUnique.mockResolvedValue(null);

      await expect(service.archive('missing', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('builds an ageBand filter spanning min/max and passes other filters through', async () => {
      await service.list({
        type: ContentType.video,
        status: ContentStatus.draft,
        ageBand: 25,
        search: 'promo',
      });

      expect(prisma.content.findMany).toHaveBeenCalledWith({
        where: {
          type: ContentType.video,
          status: ContentStatus.draft,
          targetAgeMin: { lte: 25 },
          targetAgeMax: { gte: 25 },
          title: { contains: 'promo', mode: Prisma.QueryMode.insensitive },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('lists everything when no filters are given', async () => {
      await service.list({});

      expect(prisma.content.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findOne', () => {
    it('returns the content when it exists', async () => {
      const existing = buildContent();
      prisma.content.findUnique.mockResolvedValue(existing);

      await expect(service.findOne('content-1')).resolves.toEqual(existing);
    });

    it('throws NotFound when it does not', async () => {
      prisma.content.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });
});

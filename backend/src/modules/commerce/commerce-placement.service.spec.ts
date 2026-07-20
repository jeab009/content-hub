import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  CommerceChannel,
  CommercePlacement,
  CommercePlacementStatus,
  CommerceSource,
  Content,
  ContentPillar,
  ContentStatus,
  ContentType,
  CopyrightClearance,
  LicensingStatus,
  Prisma,
  PublishMethod,
} from '@prisma/client';
import { CommercePlacementService } from './commerce-placement.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { StepUpAuthService } from '../publish/step-up-auth.service';
import { CopyrightGateService } from '../content/copyright-gate.service';
import { RecordCommercePlacementDto } from './dto/record-commerce-placement.dto';

function buildContent(overrides: Partial<Content> = {}): Content {
  return {
    id: 'content-1',
    type: ContentType.video,
    title: 'A video',
    mediaUrl: '/uploads/a.mp4',
    caption: null,
    targetAgeMin: 18,
    targetAgeMax: 30,
    status: ContentStatus.ready,
    licensingStatus: LicensingStatus.unlicensed,
    licenseNotes: null,
    licenseExpiresAt: null,
    fileSizeBytes: null,
    mimeType: null,
    contentPillar: ContentPillar.comedy,
    targetAgeSegment: null,
    copyrightCleared: CopyrightClearance.cleared,
    copyrightNotes: null,
    copyrightEvidenceUrl: null,
    createdBy: 'user-1',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

function buildPlacement(overrides: Partial<CommercePlacement> = {}): CommercePlacement {
  return {
    id: 'placement-1',
    contentId: 'content-1',
    channel: CommerceChannel.shopee,
    externalMediaId: 'SHOPEE-MEDIA-1',
    externalUrl: null,
    status: CommercePlacementStatus.recorded,
    publishMethod: PublishMethod.manual_external,
    sourceAssetId: null,
    mediaUrl: null,
    durationSeconds: 30,
    note: null,
    version: 0,
    source: CommerceSource.manual,
    recordedBy: 'user-1',
    placedAt: new Date('2026-07-20T00:00:00Z'),
    removedAt: null,
    createdAt: new Date('2026-07-20T00:00:00Z'),
    updatedAt: new Date('2026-07-20T00:00:00Z'),
    ...overrides,
  };
}

function dto(overrides: Partial<RecordCommercePlacementDto> = {}): RecordCommercePlacementDto {
  return Object.assign(new RecordCommercePlacementDto(), {
    contentId: 'content-1',
    channel: CommerceChannel.shopee,
    externalMediaId: 'SHOPEE-MEDIA-1',
    durationSeconds: 30,
    password: 'correct-password',
    ...overrides,
  });
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('CommercePlacementService', () => {
  let prisma: {
    content: { findUnique: jest.Mock };
    commercePlacement: { findFirst: jest.Mock; findMany: jest.Mock; create: jest.Mock };
    contentAsset: { findUnique: jest.Mock };
  };
  let stepUpAuth: { assertFreshPassword: jest.Mock };
  let auditLog: { record: jest.Mock };
  let service: CommercePlacementService;

  beforeEach(() => {
    prisma = {
      content: { findUnique: jest.fn().mockResolvedValue(buildContent()) },
      commercePlacement: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(buildPlacement(data))),
      },
      contentAsset: { findUnique: jest.fn() },
    };
    stepUpAuth = { assertFreshPassword: jest.fn().mockResolvedValue(undefined) };
    auditLog = { record: jest.fn() };
    service = new CommercePlacementService(
      prisma as unknown as PrismaService,
      stepUpAuth as unknown as StepUpAuthService,
      new CopyrightGateService(),
      auditLog as unknown as AuditLogService,
    );
  });

  it('requires step-up re-auth with a commerce-specific failureAction (SA-6/C4)', async () => {
    await service.recordManualExternal(dto(), 'user-1', '1.2.3.4');
    expect(stepUpAuth.assertFreshPassword).toHaveBeenCalledWith(
      'user-1',
      'correct-password',
      '1.2.3.4',
      'commerce_placement_recorded',
    );
  });

  it('propagates a step-up failure before touching content', async () => {
    stepUpAuth.assertFreshPassword.mockRejectedValueOnce(new Error('bad password'));
    await expect(service.recordManualExternal(dto(), 'user-1')).rejects.toThrow('bad password');
    expect(prisma.content.findUnique).not.toHaveBeenCalled();
  });

  it('404s when the content does not exist', async () => {
    prisma.content.findUnique.mockResolvedValueOnce(null);
    await expect(service.recordManualExternal(dto(), 'user-1')).rejects.toThrow(NotFoundException);
  });

  it('409s when content is not ready', async () => {
    prisma.content.findUnique.mockResolvedValueOnce(buildContent({ status: ContentStatus.draft }));
    await expect(service.recordManualExternal(dto(), 'user-1')).rejects.toThrow(ConflictException);
  });

  it('409s when copyright is not cleared (the gate bypass this endpoint must not open)', async () => {
    prisma.content.findUnique.mockResolvedValueOnce(
      buildContent({ copyrightCleared: CopyrightClearance.not_checked }),
    );
    await expect(service.recordManualExternal(dto(), 'user-1')).rejects.toThrow(ConflictException);
  });

  it('409s on an active duplicate placement for the same (content, channel)', async () => {
    prisma.commercePlacement.findFirst.mockResolvedValueOnce({
      id: 'existing',
      status: CommercePlacementStatus.recorded,
    });
    await expect(service.recordManualExternal(dto(), 'user-1')).rejects.toThrow(ConflictException);
    expect(prisma.commercePlacement.create).not.toHaveBeenCalled();
  });

  it('translates a concurrent-duplicate P2002 into a 409', async () => {
    prisma.commercePlacement.create.mockRejectedValueOnce(p2002());
    await expect(service.recordManualExternal(dto(), 'user-1')).rejects.toThrow(ConflictException);
  });

  describe('duration gate (422, fail-closed)', () => {
    it('rejects a null duration for shopee with no sourceAssetId', async () => {
      await expect(
        service.recordManualExternal(dto({ durationSeconds: undefined }), 'user-1'),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(prisma.commercePlacement.create).not.toHaveBeenCalled();
    });

    it('rejects an out-of-range duration', async () => {
      await expect(
        service.recordManualExternal(dto({ durationSeconds: 9 }), 'user-1'),
      ).rejects.toThrow(UnprocessableEntityException);
      await expect(
        service.recordManualExternal(dto({ durationSeconds: 61 }), 'user-1'),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('accepts a boundary duration (10 and 60)', async () => {
      await expect(
        service.recordManualExternal(dto({ durationSeconds: 10 }), 'user-1'),
      ).resolves.toBeDefined();
      await expect(
        service.recordManualExternal(dto({ durationSeconds: 60 }), 'user-1'),
      ).resolves.toBeDefined();
    });
  });

  describe('sourceAssetId prefill', () => {
    it('404s when the source asset does not exist', async () => {
      prisma.contentAsset.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.recordManualExternal(
          dto({ durationSeconds: undefined, sourceAssetId: 'asset-missing' }),
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('pre-fills mediaUrl/durationSeconds from the asset when the DTO omits duration', async () => {
      prisma.contentAsset.findUnique.mockResolvedValueOnce({
        id: 'asset-1',
        mediaUrl: '/uploads/asset-1.mp4',
        durationSeconds: 45,
      });

      const placement = await service.recordManualExternal(
        dto({ durationSeconds: undefined, sourceAssetId: 'asset-1' }),
        'user-1',
      );

      expect(prisma.commercePlacement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sourceAssetId: 'asset-1',
          mediaUrl: '/uploads/asset-1.mp4',
          durationSeconds: 45,
        }),
      });
      expect(placement.durationSeconds).toBe(45);
    });

    it('an explicit durationSeconds in the DTO wins over the parsed asset value', async () => {
      prisma.contentAsset.findUnique.mockResolvedValueOnce({
        id: 'asset-1',
        mediaUrl: '/uploads/asset-1.mp4',
        durationSeconds: 45,
      });

      await service.recordManualExternal(
        dto({ durationSeconds: 20, sourceAssetId: 'asset-1' }),
        'user-1',
      );

      expect(prisma.commercePlacement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ durationSeconds: 20 }),
      });
    });
  });

  it('creates a recorded placement and audits success with note excluded from meta (SA-4)', async () => {
    const placement = await service.recordManualExternal(
      dto({ note: 'internal note, never audited' }),
      'user-1',
      '1.2.3.4',
    );

    expect(placement.status).toBe(CommercePlacementStatus.recorded);
    const call = auditLog.record.mock.calls.find(
      ([entry]) => entry.action === 'commerce_placement_recorded' && entry.result === 'success',
    );
    expect(call).toBeDefined();
    expect(call[0].meta).not.toHaveProperty('note');
    expect(call[0].ip).toBe('1.2.3.4');
  });

  it('list() filters by channel/status/contentId', async () => {
    await service.list({
      channel: CommerceChannel.shopee,
      status: CommercePlacementStatus.recorded,
      contentId: 'content-1',
    });
    expect(prisma.commercePlacement.findMany).toHaveBeenCalledWith({
      where: {
        channel: CommerceChannel.shopee,
        status: CommercePlacementStatus.recorded,
        contentId: 'content-1',
      },
      orderBy: { placedAt: 'desc' },
    });
  });
});

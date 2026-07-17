import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import {
  AspectRatio,
  AssetPlatform,
  Content,
  ContentStatus,
  ContentType,
  CopyrightClearance,
  LicensingStatus,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { ContentAssetService } from './content-asset.service';
import { UploadValidationService } from './upload-validation.service';
import { STORAGE_ADAPTER } from './storage/storage-adapter.interface';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const VIEWER_ID = '22222222-2222-4222-8222-222222222222';
const CONTENT_ID = '33333333-3333-4333-8333-333333333333';
const ASSET_ID = '44444444-4444-4444-8444-444444444444';
const CSRF_TOKEN = 'test-csrf-token';
const MAX_IMAGE_BYTES = 1024;
const MAX_VIDEO_BYTES = 2048;

const contentEntity: Content = {
  id: CONTENT_ID,
  type: ContentType.image,
  title: 'A title',
  mediaUrl: '/uploads/123e4567-e89b-12d3-a456-426614174000.jpg',
  caption: null,
  targetAgeMin: 18,
  targetAgeMax: 30,
  status: ContentStatus.draft,
  licensingStatus: LicensingStatus.unlicensed,
  licenseNotes: null,
  licenseExpiresAt: null,
  fileSizeBytes: BigInt(512),
  mimeType: 'image/jpeg',
  contentPillar: null,
  targetAgeSegment: null,
  copyrightCleared: CopyrightClearance.not_checked,
  copyrightNotes: null,
  copyrightEvidenceUrl: null,
  createdBy: ADMIN_ID,
  createdAt: new Date('2026-07-16T00:00:00Z'),
  updatedAt: new Date('2026-07-16T00:00:00Z'),
};

const assetEntity = {
  id: ASSET_ID,
  contentId: CONTENT_ID,
  platform: AssetPlatform.tiktok,
  aspectRatio: AspectRatio.ratio_9_16,
  mediaUrl: '/uploads/123e4567-e89b-12d3-a456-426614174000.mp4',
  createdAt: new Date('2026-07-16T00:00:00Z'),
};

const validCreateBody = {
  type: 'image',
  title: 'A title',
  mediaUrl: '/uploads/123e4567-e89b-12d3-a456-426614174000.jpg',
  targetAgeMin: 18,
  targetAgeMax: 30,
  licensingStatus: 'unlicensed',
};

function jpegBuffer(size = 64): Buffer {
  const buffer = Buffer.alloc(size);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  buffer[2] = 0xff;
  buffer[3] = 0xe0;
  return buffer;
}

/**
 * HTTP-level tests: real routing, guards (session, admin-from-DB, CSRF),
 * ValidationPipe, and multipart handling — services and Prisma mocked at the
 * module boundary. The session middleware stands in for express-session:
 * an `x-test-user` header materializes an authenticated session for that
 * user id; omitting it simulates an anonymous request.
 */
describe('ContentController (HTTP)', () => {
  let app: INestApplication;
  let contentService: Record<string, jest.Mock>;
  let assetService: Record<string, jest.Mock>;
  let storage: { save: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock } };

  beforeAll(async () => {
    contentService = {
      create: jest.fn().mockResolvedValue(contentEntity),
      update: jest.fn().mockResolvedValue(contentEntity),
      archive: jest.fn().mockResolvedValue(contentEntity),
      findOne: jest.fn().mockResolvedValue(contentEntity),
      list: jest.fn().mockResolvedValue([contentEntity]),
    };
    assetService = {
      add: jest.fn().mockResolvedValue(assetEntity),
      list: jest.fn().mockResolvedValue([assetEntity]),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    storage = {
      save: jest.fn().mockResolvedValue({
        mediaUrl: '/uploads/123e4567-e89b-12d3-a456-426614174000.jpg',
        fileSizeBytes: 64,
        mimeType: 'image/jpeg',
      }),
    };
    prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(
              where.id === ADMIN_ID
                ? { id: ADMIN_ID, role: 'admin' }
                : where.id === VIEWER_ID
                  ? { id: VIEWER_ID, role: 'viewer' }
                  : null,
            ),
          ),
      },
    };

    const uploadValidationService = new UploadValidationService({
      get: () => ({
        upload: { maxImageBytes: MAX_IMAGE_BYTES, maxVideoBytes: MAX_VIDEO_BYTES },
      }),
    } as unknown as ConfigService);

    const moduleRef = await Test.createTestingModule({
      controllers: [ContentController],
      providers: [
        { provide: ContentService, useValue: contentService },
        { provide: ContentAssetService, useValue: assetService },
        { provide: UploadValidationService, useValue: uploadValidationService },
        { provide: STORAGE_ADAPTER, useValue: storage },
        { provide: AuditLogService, useValue: { record: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const testUser = req.headers['x-test-user'];
      if (typeof testUser === 'string') {
        (req as unknown as { session: Record<string, unknown> }).session = {
          userId: testUser,
          csrfToken: CSRF_TOKEN,
        };
      }
      next();
    });
    // Mirrors main.ts's global pipe so validation behaves like production.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const asAdmin = (req: request.Test): request.Test =>
    req.set('x-test-user', ADMIN_ID).set('x-csrf-token', CSRF_TOKEN);

  describe('authentication and authorization', () => {
    it.each([
      ['GET', '/api/contents'],
      ['POST', '/api/contents'],
      ['GET', `/api/contents/${CONTENT_ID}`],
      ['PATCH', `/api/contents/${CONTENT_ID}`],
      ['DELETE', `/api/contents/${CONTENT_ID}`],
      ['POST', '/api/contents/upload'],
      ['GET', `/api/contents/${CONTENT_ID}/assets`],
      ['POST', `/api/contents/${CONTENT_ID}/assets`],
      ['DELETE', `/api/contents/${CONTENT_ID}/assets/${ASSET_ID}`],
    ])('%s %s rejects an unauthenticated request with 401', async (method, url) => {
      const server = app.getHttpServer();
      const req =
        method === 'GET'
          ? request(server).get(url)
          : method === 'POST'
            ? request(server).post(url)
            : method === 'PATCH'
              ? request(server).patch(url)
              : request(server).delete(url);
      await req.expect(401);
    });

    it('rejects an authenticated non-admin with 403 (role re-read from DB)', async () => {
      await request(app.getHttpServer())
        .get('/api/contents')
        .set('x-test-user', VIEWER_ID)
        .expect(403);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: VIEWER_ID } });
    });

    it('rejects a mutating request without the CSRF header with 403', async () => {
      await request(app.getHttpServer())
        .post('/api/contents')
        .set('x-test-user', ADMIN_ID)
        .send(validCreateBody)
        .expect(403);
      expect(contentService.create).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/contents', () => {
    it('creates content and returns the mapped response', async () => {
      const response = await asAdmin(request(app.getHttpServer()).post('/api/contents'))
        .send(validCreateBody)
        .expect(201);

      expect(contentService.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'A title' }),
        ADMIN_ID,
      );
      expect(response.body).toMatchObject({
        id: CONTENT_ID,
        fileSizeBytes: '512', // BigInt serialized as string
        copyrightCleared: 'not_checked',
      });
    });

    it('rejects a body missing required fields with 400', async () => {
      await asAdmin(request(app.getHttpServer()).post('/api/contents'))
        .send({ title: 'No type or mediaUrl' })
        .expect(400);
      expect(contentService.create).not.toHaveBeenCalled();
    });

    it('rejects unknown extra fields with 400 (forbidNonWhitelisted)', async () => {
      await asAdmin(request(app.getHttpServer()).post('/api/contents'))
        .send({ ...validCreateBody, isAdminBypass: true })
        .expect(400);
    });
  });

  describe('GET /api/contents', () => {
    it('lists content, passing validated query filters through', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/contents?status=draft&ageBand=25')
        .set('x-test-user', ADMIN_ID)
        .expect(200);

      expect(contentService.list).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'draft', ageBand: 25 }),
      );
      expect(response.body).toHaveLength(1);
    });

    it('rejects an invalid filter value with 400', async () => {
      await request(app.getHttpServer())
        .get('/api/contents?ageBand=not-a-number')
        .set('x-test-user', ADMIN_ID)
        .expect(400);
    });
  });

  describe('GET /api/contents/:id', () => {
    it('returns one content item', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/contents/${CONTENT_ID}`)
        .set('x-test-user', ADMIN_ID)
        .expect(200);

      expect(contentService.findOne).toHaveBeenCalledWith(CONTENT_ID);
      expect(response.body.id).toBe(CONTENT_ID);
    });

    it('rejects a non-uuid id with 400', async () => {
      await request(app.getHttpServer())
        .get('/api/contents/not-a-uuid')
        .set('x-test-user', ADMIN_ID)
        .expect(400);
    });
  });

  describe('PATCH /api/contents/:id', () => {
    it('applies a partial update', async () => {
      await asAdmin(request(app.getHttpServer()).patch(`/api/contents/${CONTENT_ID}`))
        .send({ status: 'ready', copyrightCleared: 'cleared' })
        .expect(200);

      expect(contentService.update).toHaveBeenCalledWith(
        CONTENT_ID,
        expect.objectContaining({ status: 'ready', copyrightCleared: 'cleared' }),
        ADMIN_ID,
      );
    });

    it('rejects an invalid enum value with 400', async () => {
      await asAdmin(request(app.getHttpServer()).patch(`/api/contents/${CONTENT_ID}`))
        .send({ status: 'published' })
        .expect(400);
      expect(contentService.update).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/contents/:id', () => {
    it('archives (soft-deletes) and returns 204', async () => {
      await asAdmin(request(app.getHttpServer()).delete(`/api/contents/${CONTENT_ID}`)).expect(204);
      expect(contentService.archive).toHaveBeenCalledWith(CONTENT_ID, ADMIN_ID);
    });
  });

  describe('POST /api/contents/upload', () => {
    it('accepts a real JPEG and returns the stored file metadata', async () => {
      const response = await asAdmin(request(app.getHttpServer()).post('/api/contents/upload'))
        .attach('file', jpegBuffer(), 'photo.jpg')
        .expect(201);

      expect(storage.save).toHaveBeenCalledWith(expect.any(Buffer), {
        mimeType: 'image/jpeg',
        extension: 'jpg',
      });
      expect(response.body).toMatchObject({ mimeType: 'image/jpeg', fileSizeBytes: 64 });
    });

    it('rejects a spoofed file (jpg name + image Content-Type, non-image bytes) with 400', async () => {
      await asAdmin(request(app.getHttpServer()).post('/api/contents/upload'))
        .attach('file', Buffer.from('<script>alert(1)</script>'), {
          filename: 'totally-real-photo.jpg',
          contentType: 'image/jpeg',
        })
        .expect(400);
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('rejects an oversized image with 413', async () => {
      await asAdmin(request(app.getHttpServer()).post('/api/contents/upload'))
        .attach('file', jpegBuffer(MAX_IMAGE_BYTES + 1), 'big.jpg')
        .expect(413);
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('rejects a request with no file field with 400', async () => {
      await asAdmin(request(app.getHttpServer()).post('/api/contents/upload')).expect(400);
    });
  });

  describe('content assets', () => {
    it('POST /api/contents/:id/assets creates an asset variant', async () => {
      const response = await asAdmin(
        request(app.getHttpServer()).post(`/api/contents/${CONTENT_ID}/assets`),
      )
        .send({ platform: 'tiktok', aspectRatio: 'ratio_9_16', mediaUrl: assetEntity.mediaUrl })
        .expect(201);

      expect(assetService.add).toHaveBeenCalledWith(
        CONTENT_ID,
        expect.objectContaining({ platform: 'tiktok' }),
        ADMIN_ID,
      );
      expect(response.body.id).toBe(ASSET_ID);
    });

    it('POST /api/contents/:id/assets rejects an unknown platform with 400', async () => {
      await asAdmin(request(app.getHttpServer()).post(`/api/contents/${CONTENT_ID}/assets`))
        .send({ platform: 'myspace', aspectRatio: 'ratio_9_16', mediaUrl: assetEntity.mediaUrl })
        .expect(400);
      expect(assetService.add).not.toHaveBeenCalled();
    });

    it('GET /api/contents/:id/assets lists asset variants', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/contents/${CONTENT_ID}/assets`)
        .set('x-test-user', ADMIN_ID)
        .expect(200);

      expect(assetService.list).toHaveBeenCalledWith(CONTENT_ID);
      expect(response.body).toHaveLength(1);
    });

    it('DELETE /api/contents/:id/assets/:assetId removes an asset variant', async () => {
      await asAdmin(
        request(app.getHttpServer()).delete(`/api/contents/${CONTENT_ID}/assets/${ASSET_ID}`),
      ).expect(204);

      expect(assetService.remove).toHaveBeenCalledWith(CONTENT_ID, ASSET_ID, ADMIN_ID);
    });
  });
});

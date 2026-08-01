import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { AdCampaignStatus, AdChannel, AdSource, Prisma } from '@prisma/client';
import { PaidController } from './paid.controller';
import { PaidCampaignService } from './paid-campaign.service';
import { PaidPerformanceService } from './paid-performance.service';
import { PaidReadService } from './paid-read.service';
import { PrismaService } from '../prisma/prisma.service';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const VIEWER_ID = '22222222-2222-4222-8222-222222222222';
const CSRF_TOKEN = 'test-csrf-token';
const CAMPAIGN_ID = '33333333-3333-4333-8333-333333333333';
const ENTRY_ID = '44444444-4444-4444-8444-444444444444';

const campaignEntity = {
  id: CAMPAIGN_ID,
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
  createdBy: ADMIN_ID,
  createdAt: new Date('2026-07-20T00:00:00Z'),
  updatedAt: new Date('2026-07-20T00:00:00Z'),
};

const entryEntity = {
  id: ENTRY_ID,
  campaignId: CAMPAIGN_ID,
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
  recordedBy: ADMIN_ID,
  createdAt: new Date('2026-07-20T00:00:00Z'),
};

/**
 * HTTP-level tests. The one thing that MUST be proved at this layer, not the
 * service layer: `PATCH`/`DELETE` on
 * `/api/paid/campaigns/:id/performance-entries/:entryId` do not exist as
 * routes at all (append-only, exit criterion #3 / design §3.2). A unit test
 * on the service can prove "no update method exists"; it cannot prove "no
 * route reaches one" the way an actual HTTP request can. Mirrors
 * `CommerceConversionController`'s equivalent test exactly.
 */
describe('PaidController (HTTP)', () => {
  let app: INestApplication;
  let campaigns: Record<string, jest.Mock>;
  let performance: Record<string, jest.Mock>;
  let read: Record<string, jest.Mock>;
  let prisma: { user: { findUnique: jest.Mock } };

  beforeAll(async () => {
    campaigns = {
      create: jest.fn().mockResolvedValue(campaignEntity),
      list: jest.fn().mockResolvedValue([campaignEntity]),
      update: jest.fn().mockResolvedValue(campaignEntity),
      retire: jest.fn().mockResolvedValue({ ...campaignEntity, isActive: false }),
    };
    performance = {
      addEntry: jest.fn().mockResolvedValue(entryEntity),
      list: jest.fn().mockResolvedValue([entryEntity]),
      checkOverlap: jest.fn().mockResolvedValue([]),
    };
    read = {
      summary: jest.fn().mockResolvedValue({
        generatedAt: new Date(),
        totals: [],
        byCampaign: [],
        byResultType: [],
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

    const moduleRef = await Test.createTestingModule({
      controllers: [PaidController],
      providers: [
        { provide: PaidCampaignService, useValue: campaigns },
        { provide: PaidPerformanceService, useValue: performance },
        { provide: PaidReadService, useValue: read },
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
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const asAdmin = (req: request.Test): request.Test =>
    req.set('x-test-user', ADMIN_ID).set('x-csrf-token', CSRF_TOKEN);

  describe('append-only: no route exists to modify or remove a performance entry', () => {
    const path = `/api/paid/campaigns/${CAMPAIGN_ID}/performance-entries/${ENTRY_ID}`;

    it('PATCH /:entryId is not a route (404, not 403/401 — the handler does not exist)', async () => {
      await asAdmin(request(app.getHttpServer()).patch(path)).send({ spend: 1 }).expect(404);
    });

    it('DELETE /:entryId is not a route (404)', async () => {
      await asAdmin(request(app.getHttpServer()).delete(path)).expect(404);
    });

    it('PUT /:entryId is not a route (404)', async () => {
      await asAdmin(request(app.getHttpServer()).put(path)).send({}).expect(404);
    });
  });

  describe('campaign routes', () => {
    it('POST creates a campaign (admin + CSRF)', async () => {
      await asAdmin(request(app.getHttpServer()).post('/api/paid/campaigns'))
        .send({
          channel: 'meta',
          externalCampaignName: 'Summer Skincare Reach',
          objective: 'Traffic',
          startDate: '2026-07-01',
        })
        .expect(201);
      expect(campaigns.create).toHaveBeenCalled();
    });

    it('POST without a CSRF token is rejected', async () => {
      await request(app.getHttpServer())
        .post('/api/paid/campaigns')
        .set('x-test-user', ADMIN_ID)
        .send({
          channel: 'meta',
          externalCampaignName: 'Summer Skincare Reach',
          objective: 'Traffic',
          startDate: '2026-07-01',
        })
        .expect(403);
    });

    it('GET lists campaigns', async () => {
      await asAdmin(request(app.getHttpServer()).get('/api/paid/campaigns')).expect(200);
      expect(campaigns.list).toHaveBeenCalled();
    });

    it('PATCH updates a campaign', async () => {
      await asAdmin(request(app.getHttpServer()).patch(`/api/paid/campaigns/${CAMPAIGN_ID}`))
        .send({ objective: 'Conversions' })
        .expect(200);
      expect(campaigns.update).toHaveBeenCalled();
    });

    it('POST retire soft-retires a campaign', async () => {
      await asAdmin(
        request(app.getHttpServer()).post(`/api/paid/campaigns/${CAMPAIGN_ID}/retire`),
      ).expect(201);
      expect(campaigns.retire).toHaveBeenCalled();
    });

    it('rejects a non-admin (viewer) with 403', async () => {
      await request(app.getHttpServer())
        .get('/api/paid/campaigns')
        .set('x-test-user', VIEWER_ID)
        .expect(403);
    });

    it('rejects an unauthenticated request with 401', async () => {
      await request(app.getHttpServer()).get('/api/paid/campaigns').expect(401);
    });
  });

  describe('performance-entry routes that DO exist', () => {
    it('POST appends a performance entry (admin + CSRF)', async () => {
      await asAdmin(
        request(app.getHttpServer()).post(`/api/paid/campaigns/${CAMPAIGN_ID}/performance-entries`),
      )
        .send({ periodStart: '2026-07-01', periodEnd: '2026-07-07', spend: 300 })
        .expect(201);
      expect(performance.addEntry).toHaveBeenCalled();
    });

    it('GET lists performance-entry history', async () => {
      await asAdmin(
        request(app.getHttpServer()).get(`/api/paid/campaigns/${CAMPAIGN_ID}/performance-entries`),
      ).expect(200);
      expect(performance.list).toHaveBeenCalled();
    });

    it('GET overlap-check probes for an overlap', async () => {
      await asAdmin(
        request(app.getHttpServer()).get(
          `/api/paid/campaigns/${CAMPAIGN_ID}/performance-entries/overlap-check` +
            '?periodStart=2026-07-01&periodEnd=2026-07-07',
        ),
      ).expect(200);
      expect(performance.checkOverlap).toHaveBeenCalled();
    });
  });

  describe('summary route', () => {
    it('GET /api/paid/summary reads the paid summary', async () => {
      await asAdmin(request(app.getHttpServer()).get('/api/paid/summary')).expect(200);
      expect(read.summary).toHaveBeenCalled();
    });
  });
});

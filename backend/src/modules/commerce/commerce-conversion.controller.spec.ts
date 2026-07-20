import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { CommerceChannel, CommerceConversion, CommerceSource, Prisma } from '@prisma/client';
import { CommerceConversionController } from './commerce-conversion.controller';
import { CommerceConversionService } from './commerce-conversion.service';
import { PrismaService } from '../prisma/prisma.service';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const VIEWER_ID = '22222222-2222-4222-8222-222222222222';
const CSRF_TOKEN = 'test-csrf-token';

const conversionEntity: CommerceConversion = {
  id: '33333333-3333-4333-8333-333333333333',
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
  recordedBy: ADMIN_ID,
  createdAt: new Date('2026-07-20T00:00:00Z'),
};

/**
 * HTTP-level tests. The one thing that MUST be proved at this layer, not
 * the service layer: `PATCH`/`DELETE` on `/api/commerce/conversions/:id`
 * do not exist as routes at all (append-only, 6A.7 acceptance criterion).
 * A unit test on the service can prove "no update method exists"; it
 * cannot prove "no route reaches one" the way an actual HTTP request can.
 */
describe('CommerceConversionController (HTTP)', () => {
  let app: INestApplication;
  let conversions: Record<string, jest.Mock>;
  let prisma: { user: { findUnique: jest.Mock } };

  beforeAll(async () => {
    conversions = {
      create: jest.fn().mockResolvedValue(conversionEntity),
      list: jest.fn().mockResolvedValue([conversionEntity]),
      checkOverlap: jest.fn().mockResolvedValue([]),
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
      controllers: [CommerceConversionController],
      providers: [
        { provide: CommerceConversionService, useValue: conversions },
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

  describe('append-only: no route exists to modify or remove a conversion', () => {
    const conversionId = conversionEntity.id;

    it('PATCH /:id is not a route (404, not 403/401 — the handler does not exist)', async () => {
      await asAdmin(request(app.getHttpServer()).patch(`/api/commerce/conversions/${conversionId}`))
        .send({ commissionAmount: 1 })
        .expect(404);
    });

    it('DELETE /:id is not a route (404)', async () => {
      await asAdmin(
        request(app.getHttpServer()).delete(`/api/commerce/conversions/${conversionId}`),
      ).expect(404);
    });

    it('PUT /:id is not a route (404)', async () => {
      await asAdmin(request(app.getHttpServer()).put(`/api/commerce/conversions/${conversionId}`))
        .send({})
        .expect(404);
    });
  });

  describe('the routes that DO exist still work', () => {
    it('POST creates a conversion (admin + CSRF)', async () => {
      await asAdmin(request(app.getHttpServer()).post('/api/commerce/conversions'))
        .send({
          channel: 'shopee',
          periodStart: '2026-07-01',
          periodEnd: '2026-07-07',
          commissionAmount: 300,
        })
        .expect(201);
      expect(conversions.create).toHaveBeenCalled();
    });

    it('POST without a CSRF token is rejected', async () => {
      await request(app.getHttpServer())
        .post('/api/commerce/conversions')
        .set('x-test-user', ADMIN_ID)
        .send({
          channel: 'shopee',
          periodStart: '2026-07-01',
          periodEnd: '2026-07-07',
          commissionAmount: 300,
        })
        .expect(403);
    });

    it('GET lists conversions', async () => {
      await asAdmin(request(app.getHttpServer()).get('/api/commerce/conversions')).expect(200);
      expect(conversions.list).toHaveBeenCalled();
    });

    it('GET overlap-check probes for an overlap', async () => {
      await asAdmin(
        request(app.getHttpServer()).get(
          '/api/commerce/conversions/overlap-check?channel=shopee&periodStart=2026-07-01&periodEnd=2026-07-07',
        ),
      ).expect(200);
      expect(conversions.checkOverlap).toHaveBeenCalled();
    });

    it('rejects a non-admin (viewer) with 403', async () => {
      await request(app.getHttpServer())
        .get('/api/commerce/conversions')
        .set('x-test-user', VIEWER_ID)
        .expect(403);
    });

    it('rejects an unauthenticated request with 401', async () => {
      await request(app.getHttpServer()).get('/api/commerce/conversions').expect(401);
    });
  });
});

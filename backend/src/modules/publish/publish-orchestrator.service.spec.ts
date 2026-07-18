import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AssetPlatform, ContentPillar, PostStatus, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { PublishOrchestratorService } from './publish-orchestrator.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { CopyrightGateService } from '../content/copyright-gate.service';
import { RankingEngineService } from '../ranking/ranking-engine.service';
import { StepUpAuthService } from './step-up-auth.service';
import { PlatformAdapterRegistry } from './adapters/platform-adapter.registry';
import { CreatePostDto } from './dto/create-post.dto';

const ADMIN_ID = 'admin-1';

const readyContent = {
  id: 'content-1',
  status: 'ready',
  copyrightCleared: 'cleared',
  contentPillar: ContentPillar.comedy,
  copyrightEvidenceUrl: null,
};

const facebookScore = {
  id: 'score-fb',
  platform: AssetPlatform.facebook,
  score: 0.8,
  computedAt: new Date('2026-07-17T00:00:00Z'),
};
const youtubeScore = {
  id: 'score-yt',
  platform: AssetPlatform.youtube,
  score: 0.6,
  computedAt: new Date('2026-07-17T00:00:00Z'),
};

function buildDto(overrides: Partial<CreatePostDto> = {}): CreatePostDto {
  const dto = new CreatePostDto();
  Object.assign(dto, {
    contentId: 'content-1',
    platform: AssetPlatform.facebook,
    password: 'correct-password',
    ...overrides,
  });
  return dto;
}

describe('PublishOrchestratorService', () => {
  let prisma: {
    content: { findUnique: jest.Mock };
    connectedAccount: { findFirst: jest.Mock };
    post: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let stepUp: { assertFreshPassword: jest.Mock };
  let rankingEngine: { getLatestScores: jest.Mock; getRecommendation: jest.Mock };
  let queue: { add: jest.Mock };
  let auditLog: { record: jest.Mock };
  let service: PublishOrchestratorService;
  let callOrder: string[];

  beforeEach(() => {
    callOrder = [];
    prisma = {
      content: { findUnique: jest.fn().mockResolvedValue(readyContent) },
      connectedAccount: {
        findFirst: jest.fn().mockResolvedValue({ id: 'acct-1', platform: 'facebook' }),
      },
      post: {
        create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
          callOrder.push('post.create');
          return { id: 'post-1', version: 0, ...args.data };
        }),
        update: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => ({
          id: 'post-1',
          version: 1,
          contentId: 'content-1',
          selectedPlatform: AssetPlatform.facebook,
          ...args.data,
        })),
        findUnique: jest.fn(),
        // No active duplicate by default (BUG-QA-001 guard queries this).
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    stepUp = { assertFreshPassword: jest.fn().mockResolvedValue(undefined) };
    rankingEngine = {
      getLatestScores: jest.fn().mockResolvedValue([facebookScore, youtubeScore]),
      getRecommendation: jest.fn().mockResolvedValue(facebookScore),
    };
    queue = {
      add: jest.fn().mockImplementation(() => {
        callOrder.push('queue.add');
        return Promise.resolve({});
      }),
    };
    auditLog = { record: jest.fn() };

    service = new PublishOrchestratorService(
      prisma as unknown as PrismaService,
      stepUp as unknown as StepUpAuthService,
      new CopyrightGateService(),
      rankingEngine as unknown as RankingEngineService,
      // Real registry shape not needed — only getFor() is called for support checks.
      { getFor: jest.fn() } as unknown as PlatformAdapterRegistry,
      auditLog as unknown as AuditLogService,
      queue as unknown as Queue,
    );
  });

  describe('step-up re-auth', () => {
    it('rejects the publish before any other work when step-up fails', async () => {
      stepUp.assertFreshPassword.mockRejectedValue(new UnauthorizedException());

      await expect(service.createAndDispatch(buildDto(), ADMIN_ID)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.post.create).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('publish-time copyright recheck', () => {
    it('rejects content that is not in ready status', async () => {
      prisma.content.findUnique.mockResolvedValue({ ...readyContent, status: 'draft' });

      await expect(service.createAndDispatch(buildDto(), ADMIN_ID)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.post.create).not.toHaveBeenCalled();
    });

    it('rejects content whose clearance flag is not cleared', async () => {
      prisma.content.findUnique.mockResolvedValue({
        ...readyContent,
        copyrightCleared: 'not_checked',
      });

      await expect(service.createAndDispatch(buildDto(), ADMIN_ID)).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects ready+cleared content whose evidence no longer satisfies the gate', async () => {
      prisma.content.findUnique.mockResolvedValue({
        ...readyContent,
        contentPillar: ContentPillar.drama,
        copyrightEvidenceUrl: null, // drama requires evidence — gate fails
      });

      await expect(service.createAndDispatch(buildDto(), ADMIN_ID)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('server-side was_override recompute', () => {
    it('sets wasOverride=false when the selected platform matches the recommendation', async () => {
      await service.createAndDispatch(buildDto({ platform: AssetPlatform.facebook }), ADMIN_ID);

      const [{ data }] = prisma.post.create.mock.calls[0] as [{ data: Record<string, unknown> }];
      expect(data.wasOverride).toBe(false);
      expect(data.recommendedPlatform).toBe(AssetPlatform.facebook);
      expect(data.rankingScoreId).toBe('score-fb');
    });

    it('sets wasOverride=true when the admin picks the non-recommended platform', async () => {
      await service.createAndDispatch(
        buildDto({ platform: AssetPlatform.youtube, overrideReason: 'yt push this week' }),
        ADMIN_ID,
      );

      const [{ data }] = prisma.post.create.mock.calls[0] as [{ data: Record<string, unknown> }];
      expect(data.wasOverride).toBe(true);
      expect(data.recommendedPlatform).toBe(AssetPlatform.facebook);
      expect(data.selectedPlatform).toBe(AssetPlatform.youtube);
      expect(data.overrideReason).toBe('yt push this week');
      expect(data.rankingScoreId).toBe('score-yt');
    });

    it('records no recommendation and no override when the content was never ranked', async () => {
      rankingEngine.getLatestScores.mockResolvedValue([]);
      rankingEngine.getRecommendation.mockResolvedValue(null);

      await service.createAndDispatch(buildDto(), ADMIN_ID);

      const [{ data }] = prisma.post.create.mock.calls[0] as [{ data: Record<string, unknown> }];
      expect(data.recommendedPlatform).toBeNull();
      expect(data.wasOverride).toBe(false);
      expect(data.rankingScoreId).toBeNull();
    });
  });

  describe('dispatch mechanics', () => {
    it('persists the intent row BEFORE enqueuing the dispatch job', async () => {
      await service.createAndDispatch(buildDto(), ADMIN_ID);

      expect(callOrder).toEqual(['post.create', 'queue.add']);
    });

    it('enqueues a job keyed on the post id + version', async () => {
      await service.createAndDispatch(buildDto(), ADMIN_ID);

      expect(queue.add).toHaveBeenCalledWith(
        'dispatch',
        { postId: 'post-1', requestedBy: ADMIN_ID, connectedAccountId: 'acct-1' },
        expect.objectContaining({ jobId: 'publish-post-1-v0', attempts: 1 }),
      );
    });

    it('audit-logs publish_attempt_started on success', async () => {
      await service.createAndDispatch(buildDto(), ADMIN_ID);

      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'publish_attempt_started', result: 'success' }),
      );
    });

    it('rejects when no connected account exists for the platform', async () => {
      prisma.connectedAccount.findFirst.mockResolvedValue(null);

      await expect(service.createAndDispatch(buildDto(), ADMIN_ID)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.post.create).not.toHaveBeenCalled();
    });
  });

  describe('BUG-QA-001: duplicate publish intent guard', () => {
    it('rejects (409) a second create while an active post for the same (content, platform) exists', async () => {
      // First create succeeds (no active duplicate).
      await service.createAndDispatch(buildDto({ platform: AssetPlatform.facebook }), ADMIN_ID);
      expect(prisma.post.create).toHaveBeenCalledTimes(1);

      // Now an active (draft) post exists for content-1/facebook.
      prisma.post.findFirst.mockResolvedValue({ id: 'post-1', status: PostStatus.draft });

      await expect(
        service.createAndDispatch(buildDto({ platform: AssetPlatform.facebook }), ADMIN_ID),
      ).rejects.toThrow(ConflictException);
      // No second row created, no second dispatch enqueued.
      expect(prisma.post.create).toHaveBeenCalledTimes(1);
    });

    it('blocks a duplicate against an already-posted (succeeded) post too', async () => {
      prisma.post.findFirst.mockResolvedValue({ id: 'post-1', status: PostStatus.posted });

      await expect(
        service.createAndDispatch(buildDto({ platform: AssetPlatform.facebook }), ADMIN_ID),
      ).rejects.toThrow(ConflictException);
      expect(prisma.post.create).not.toHaveBeenCalled();
    });

    it('queries only active statuses so a failed prior attempt can be re-created', async () => {
      // Guard finds nothing active (failed rows are excluded from the query).
      await service.createAndDispatch(buildDto({ platform: AssetPlatform.facebook }), ADMIN_ID);

      expect(prisma.post.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            contentId: 'content-1',
            platform: 'facebook',
            status: {
              in: [
                PostStatus.draft,
                PostStatus.scheduled,
                PostStatus.posted,
                PostStatus.posted_unconfirmed,
              ],
            },
          }),
        }),
      );
      expect(prisma.post.create).toHaveBeenCalledTimes(1);
    });

    it('allows a different platform for the same content', async () => {
      await service.createAndDispatch(buildDto({ platform: AssetPlatform.facebook }), ADMIN_ID);
      // Different platform → guard still sees no active duplicate → allowed.
      await service.createAndDispatch(buildDto({ platform: AssetPlatform.youtube }), ADMIN_ID);

      expect(prisma.post.create).toHaveBeenCalledTimes(2);
    });

    it('maps a concurrent DB unique-violation (P2002) to a 409 (race backstop)', async () => {
      // App-level check passes (TOCTOU window), but the partial unique index
      // rejects the losing racer.
      prisma.post.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.createAndDispatch(buildDto({ platform: AssetPlatform.facebook }), ADMIN_ID),
      ).rejects.toThrow(ConflictException);
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('redispatch', () => {
    it('404s for a missing post', async () => {
      prisma.post.findUnique.mockResolvedValue(null);

      await expect(service.redispatch('missing', 'pw', ADMIN_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses to redispatch a posted post (terminal state)', async () => {
      prisma.post.findUnique.mockResolvedValue({
        id: 'post-1',
        status: PostStatus.posted,
        selectedPlatform: AssetPlatform.facebook,
        content: readyContent,
      });

      await expect(service.redispatch('post-1', 'pw', ADMIN_ID)).rejects.toThrow(ConflictException);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('refuses to redispatch posted_unconfirmed — only the resolution endpoints may exit that state', async () => {
      prisma.post.findUnique.mockResolvedValue({
        id: 'post-1',
        status: PostStatus.posted_unconfirmed,
        selectedPlatform: AssetPlatform.facebook,
        content: readyContent,
      });

      await expect(service.redispatch('post-1', 'pw', ADMIN_ID)).rejects.toThrow(ConflictException);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('re-dispatches a failed post and recomputes recommendation facts', async () => {
      prisma.post.findUnique.mockResolvedValue({
        id: 'post-1',
        status: PostStatus.failed,
        version: 2,
        contentId: 'content-1',
        selectedPlatform: AssetPlatform.youtube,
        content: readyContent,
      });

      await service.redispatch('post-1', 'pw', ADMIN_ID);

      const [{ data }] = prisma.post.update.mock.calls[0] as [{ data: Record<string, unknown> }];
      expect(data.wasOverride).toBe(true); // facebook recommended, youtube selected
      expect(queue.add).toHaveBeenCalled();
    });
  });
});

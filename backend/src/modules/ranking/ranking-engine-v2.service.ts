import { Injectable, NotFoundException } from '@nestjs/common';
import { ContentPillar, EngineVersion, Prisma, RankingScore } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { RankingFactorsV2Service } from './ranking-factors-v2.service';
import { RankingReasoning, round4 } from './ranking.constants';
import { RANKED_PLATFORMS_V2 } from './ranking-v2.constants';

/**
 * Rule-based ranking engine v2 — still a transparent weighted rule set, NOT a
 * learned model (System Analyst constraint C-D). Two things change versus v1:
 * it scores all four platforms, and it consumes data that did not exist when
 * v1 shipped (real per-pillar earnings, and the admin's own override history).
 *
 * v2 is a SEPARATE service rather than a branch inside v1 so that v1 stays
 * byte-frozen: every v1-tagged ranking_scores row remains attributable to the
 * exact logic that produced it, which is the whole reason EngineVersion exists.
 * Which engine serves a recompute is decided by RankingEngineSelectorService
 * from the RANKING_ENGINE flag.
 *
 * The reads (getLatestScores / getRecommendation) are NOT duplicated here:
 * they operate on persisted rows and are engine-agnostic, so both engines
 * share v1's implementation and can never disagree about what "latest" or
 * "recommended" means.
 */
@Injectable()
export class RankingEngineV2Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly factors: RankingFactorsV2Service,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Recomputes and persists scores for all four ranked platforms. */
  async computeScores(contentId: string, actorId: string): Promise<RankingScore[]> {
    const content = await this.prisma.content.findUnique({ where: { id: contentId } });
    if (!content) {
      throw new NotFoundException('Content not found');
    }

    const scored = await Promise.all(
      RANKED_PLATFORMS_V2.map(async (platform) => ({
        platform,
        reasoning: await this.scoreOnePlatform(content.contentPillar, platform),
      })),
    );

    const created = await this.prisma.$transaction(
      scored.map(({ platform, reasoning }) =>
        this.prisma.rankingScore.create({
          data: {
            contentId,
            platform,
            score: new Prisma.Decimal(reasoning.total),
            // Cast is safe: RankingReasoning is a plain JSON-serializable
            // object; Prisma's InputJsonValue just can't see that through the
            // interface type. Same rationale as v1.
            reasoning: reasoning as unknown as Prisma.InputJsonValue,
            engineVersion: EngineVersion.v2,
          },
        }),
      ),
    );

    // Reuses the v1 action on purpose: it already carries engineVersion in its
    // meta, so existing alerting on 'ranking_recomputed' keeps seeing every
    // recompute instead of going quiet the day the flag flips to v2.
    this.auditLog.record({
      actor: actorId,
      action: 'ranking_recomputed',
      result: 'success',
      meta: {
        contentId,
        engineVersion: EngineVersion.v2,
        scores: created.map((row) => ({ platform: row.platform, score: Number(row.score) })),
      },
    });

    return created;
  }

  private async scoreOnePlatform(
    pillar: ContentPillar | null,
    platform: Parameters<RankingFactorsV2Service['apiAvailability']>[0],
  ): Promise<RankingReasoning> {
    const factorList = [
      await this.factors.engagementHistory(pillar, platform),
      await this.factors.overrideFeedback(pillar, platform),
      await this.factors.cadencePressure(platform),
      await this.factors.pillarAlignment(pillar),
      this.factors.apiAvailability(platform),
    ];

    const total = round4(factorList.reduce((sum, factor) => sum + factor.contribution, 0));
    return { engineVersion: EngineVersion.v2, factors: factorList, total };
  }
}

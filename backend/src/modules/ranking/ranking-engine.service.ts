import { Injectable, NotFoundException } from '@nestjs/common';
import { AssetPlatform, EngineVersion, Prisma, RankingScore } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { RankingFactorsService } from './ranking-factors.service';
import { ActiveRankingEngineService } from './active-ranking-engine.service';
import {
  LATEST_SCORE_ORDER_BY,
  RANKED_PLATFORMS,
  RankingReasoning,
  latestScorePerPlatform,
  pickRecommendedScore,
  round4,
} from './ranking.constants';

/**
 * Rule-based ranking engine v1. Produces one ranking_scores row per ranked
 * platform for a piece of content; each row's `reasoning` jsonb carries the
 * complete factor breakdown (name, raw inputs, weight, normalized value,
 * contribution) so any recommendation can be explained after the fact —
 * explicitly NOT a black box (System Analyst requirement).
 */
@Injectable()
export class RankingEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly factors: RankingFactorsService,
    private readonly auditLog: AuditLogService,
    private readonly activeEngine: ActiveRankingEngineService,
  ) {}

  /** Recomputes and persists scores for every ranked platform. */
  async computeScores(contentId: string, actorId: string): Promise<RankingScore[]> {
    const content = await this.prisma.content.findUnique({ where: { id: contentId } });
    if (!content) {
      throw new NotFoundException('Content not found');
    }

    const scored = await Promise.all(
      RANKED_PLATFORMS.map(async (platform) => ({
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
            // object (typed factor list + numbers); Prisma's InputJsonValue
            // just can't see that through the interface type.
            reasoning: reasoning as unknown as Prisma.InputJsonValue,
            engineVersion: EngineVersion.v1,
          },
        }),
      ),
    );

    this.auditLog.record({
      actor: actorId,
      action: 'ranking_recomputed',
      result: 'success',
      meta: {
        contentId,
        engineVersion: EngineVersion.v1,
        scores: created.map((row) => ({ platform: row.platform, score: Number(row.score) })),
      },
    });

    return created;
  }

  /**
   * Latest persisted score per platform for a piece of content, SCOPED TO THE
   * ACTIVE ENGINE (the rows the publish flow's recommendation recompute and
   * the scheduler UI read).
   *
   * BUG-P5-02: this read used to aggregate latest-per-platform across every
   * engine version. v1 writes 2 rows (facebook, youtube); v2 writes 4. So a
   * v2 -> v1 rollback left the tiktok/line_oa rows written by v2 permanently
   * in the recommendation set — v1 never writes those platforms, so nothing
   * ever superseded them — and pickRecommendedScore then compared a v1 score
   * against a v2 score. Those are not on the same scale: different factor
   * sets, different weight vectors. The engine filter below is what makes a
   * recommendation set internally comparable.
   *
   * The filter is applied in the WHERE clause rather than in memory so the
   * database never returns foreign-engine rows in the first place, and so the
   * (content_id, computed_at) index still serves the query.
   *
   * Rows from the non-active engine are IGNORED, never deleted — see the
   * migration note in docs: history stays attributable, which is the entire
   * reason EngineVersion exists.
   */
  async getLatestScores(contentId: string): Promise<RankingScore[]> {
    const rows = await this.prisma.rankingScore.findMany({
      where: { contentId, engineVersion: this.activeEngine.version },
      orderBy: LATEST_SCORE_ORDER_BY,
    });

    return latestScorePerPlatform(rows);
  }

  /**
   * The platform with the highest latest score, or null when the content has
   * never been ranked BY THE ACTIVE ENGINE (a content ranked only under the
   * other engine reads as unranked — see getLatestScores; the honest answer
   * is "no current recommendation", not a stale cross-engine one).
   * Ties break toward the earlier entry in
   * RANKED_PLATFORMS order (deterministic, documented) — via the SHARED
   * pickRecommendedScore so this agrees with the scheduler overview.
   */
  async getRecommendation(contentId: string): Promise<RankingScore | null> {
    return pickRecommendedScore(await this.getLatestScores(contentId));
  }

  private async scoreOnePlatform(
    pillar: Parameters<RankingFactorsService['engagementHistory']>[0],
    platform: AssetPlatform,
  ): Promise<RankingReasoning> {
    const factorList = [
      await this.factors.engagementHistory(pillar, platform),
      this.factors.apiAvailability(platform),
      await this.factors.pillarAlignment(pillar),
      await this.factors.cadencePressure(platform),
    ];

    const total = round4(factorList.reduce((sum, factor) => sum + factor.contribution, 0));
    return { engineVersion: EngineVersion.v1, factors: factorList, total };
  }
}

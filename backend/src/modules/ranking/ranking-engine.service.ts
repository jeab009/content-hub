import { Injectable, NotFoundException } from '@nestjs/common';
import { AssetPlatform, EngineVersion, Prisma, RankingScore } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { RankingFactorsService } from './ranking-factors.service';
import { RANKED_PLATFORMS, RankingReasoning, round4 } from './ranking.constants';

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
   * Latest persisted score per platform for a piece of content (the rows
   * the publish flow's recommendation recompute and the scheduler UI read).
   */
  async getLatestScores(contentId: string): Promise<RankingScore[]> {
    const rows = await this.prisma.rankingScore.findMany({
      where: { contentId },
      orderBy: { computedAt: 'desc' },
    });

    const latestByPlatform = new Map<AssetPlatform, RankingScore>();
    for (const row of rows) {
      if (!latestByPlatform.has(row.platform)) {
        latestByPlatform.set(row.platform, row);
      }
    }
    return [...latestByPlatform.values()];
  }

  /**
   * The platform with the highest latest score, or null when the content
   * has never been ranked. Ties break toward the earlier entry in
   * RANKED_PLATFORMS order (deterministic, documented).
   */
  async getRecommendation(contentId: string): Promise<RankingScore | null> {
    const latest = await this.getLatestScores(contentId);
    if (latest.length === 0) {
      return null;
    }
    return latest.reduce((best, row) => (Number(row.score) > Number(best.score) ? row : best));
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

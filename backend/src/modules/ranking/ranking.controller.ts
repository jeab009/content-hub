import { Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { RankingEngineService } from './ranking-engine.service';
import { RankingScoreResponseDto } from './dto/ranking-score-response.dto';

/**
 * Ranking endpoints, nested under the content resource. Same guard stack
 * as the CMS controller: SessionAuthGuard + AdminGuard everywhere, CsrfGuard
 * on the mutating recompute. Routes are two segments deep (`:id/rank`,
 * `:id/scores`) so they can never collide with ContentController's `:id`.
 */
@Controller('api/contents')
@UseGuards(SessionAuthGuard, AdminGuard)
export class RankingController {
  constructor(private readonly rankingEngine: RankingEngineService) {}

  /** Recomputes scores for every ranked platform and returns the new rows. */
  @Post(':id/rank')
  @UseGuards(CsrfGuard)
  async rank(
    @Param('id', ParseUUIDPipe) contentId: string,
    @CurrentUserId() userId: string,
  ): Promise<RankingScoreResponseDto[]> {
    const scores = await this.rankingEngine.computeScores(contentId, userId);
    return scores.map(RankingScoreResponseDto.fromEntity);
  }

  /** Latest persisted score per platform (empty array if never ranked). */
  @Get(':id/scores')
  async latestScores(
    @Param('id', ParseUUIDPipe) contentId: string,
  ): Promise<RankingScoreResponseDto[]> {
    const scores = await this.rankingEngine.getLatestScores(contentId);
    return scores.map(RankingScoreResponseDto.fromEntity);
  }
}

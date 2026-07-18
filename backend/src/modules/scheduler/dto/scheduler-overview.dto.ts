import { AssetPlatform, CadencePeriodUnit, ContentPillar, ContentType } from '@prisma/client';

export type CadencePaceStatus = 'on_pace' | 'under_target' | 'target_met';

/**
 * Pace judgment for the current period: `target_met` once the full target
 * is reached; otherwise compare against the pro-rated expectation for how
 * far into the period we are (e.g. 3.5 days into a 7-day week with a
 * target of 7 → expected ≥ 3). Pure function so the week-boundary math is
 * directly unit-testable.
 */
export function cadencePaceStatus(
  published: number,
  target: number,
  periodStart: Date,
  periodEnd: Date,
  now: Date,
): CadencePaceStatus {
  if (published >= target) {
    return 'target_met';
  }
  const periodMs = periodEnd.getTime() - periodStart.getTime();
  const elapsedMs = Math.min(Math.max(now.getTime() - periodStart.getTime(), 0), periodMs);
  const expectedSoFar = Math.floor(target * (elapsedMs / periodMs));
  return published >= expectedSoFar ? 'on_pace' : 'under_target';
}

export interface CadenceOverviewItemDto {
  platform: AssetPlatform;
  targetPostsPerPeriod: number;
  periodUnit: CadencePeriodUnit;
  periodStart: Date;
  periodEnd: Date;
  publishedThisPeriod: number;
  remaining: number;
  status: CadencePaceStatus;
}

export interface ReadyContentScoreDto {
  id: string;
  platform: AssetPlatform;
  score: number;
  computedAt: Date;
}

export interface ReadyContentOverviewDto {
  contentId: string;
  title: string;
  type: ContentType;
  contentPillar: ContentPillar | null;
  createdAt: Date;
  latestScores: ReadyContentScoreDto[];
  recommendedPlatform: AssetPlatform | null;
}

export interface SchedulerOverviewDto {
  generatedAt: Date;
  cadence: CadenceOverviewItemDto[];
  readyContents: ReadyContentOverviewDto[];
}

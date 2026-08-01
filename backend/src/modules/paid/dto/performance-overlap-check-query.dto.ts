import { IsDateString } from 'class-validator';

/**
 * Query for GET /api/paid/campaigns/:id/performance-entries/overlap-check —
 * a WARN-ONLY probe for the entry form (design §3.2): "does a performance
 * entry already exist covering part of this period for this campaign?"
 * Scoped by the `:id` path param, so no `channel`/campaign filter is needed
 * here, unlike Commerce's equivalent (which is global across a channel).
 */
export class PerformanceOverlapCheckQueryDto {
  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;
}

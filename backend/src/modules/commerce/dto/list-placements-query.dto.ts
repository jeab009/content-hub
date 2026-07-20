import { CommerceChannel, CommercePlacementStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

/** Query filters for GET /api/commerce/placements. All optional, ANDed. */
export class ListPlacementsQueryDto {
  @IsOptional()
  @IsEnum(CommerceChannel)
  channel?: CommerceChannel;

  @IsOptional()
  @IsEnum(CommercePlacementStatus)
  status?: CommercePlacementStatus;

  @IsOptional()
  @IsUUID()
  contentId?: string;
}

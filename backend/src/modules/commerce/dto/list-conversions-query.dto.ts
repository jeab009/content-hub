import { CommerceChannel } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

/** Query filters for GET /api/commerce/conversions. All optional, ANDed. */
export class ListConversionsQueryDto {
  @IsOptional()
  @IsEnum(CommerceChannel)
  channel?: CommerceChannel;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  placementId?: string;

  @IsOptional()
  @IsUUID()
  postId?: string;
}

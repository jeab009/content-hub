import { PostStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

/** Query params of GET /api/posts. */
export class ListPostsQueryDto {
  @IsOptional()
  @IsEnum(PostStatus)
  status?: PostStatus;
}

import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

const EXTERNAL_POST_ID_MAX_LENGTH = 255;

/**
 * Body of POST /api/posts/:id/resolve-posted ("Confirmed posted — mark as
 * Posted"). `externalPostId` is mandatory per the addendum: a `posted` row
 * without an external id is not auditable/linkable later.
 */
export class ResolvePostedDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(EXTERNAL_POST_ID_MAX_LENGTH)
  externalPostId!: string;
}

import { IsNotEmpty, IsString } from 'class-validator';

/** Body of POST /api/posts/:id/publish — retry of a draft/failed post. */
export class PublishRetryDto {
  /** Step-up re-auth: required on every publish confirmation, retries included. */
  @IsString()
  @IsNotEmpty()
  password!: string;
}

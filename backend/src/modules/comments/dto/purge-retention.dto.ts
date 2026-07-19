import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Manual retention purge body. The purge is an irreversible mass hard-delete,
 * so it carries step-up re-auth (System Analyst condition C8) — matching the
 * authority bar of the reply write beside it.
 */
export class PurgeRetentionDto {
  @IsString()
  @IsNotEmpty()
  password!: string;
}

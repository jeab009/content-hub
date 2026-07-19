import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { MAX_REPLY_MESSAGE_LENGTH } from '../comments.constants';

/**
 * Reply body. `password` is the step-up re-auth (same as publish). `message`
 * is length-capped (System Analyst condition C9) and required. The controller
 * validates with `forbidNonWhitelisted` so a smuggled field (e.g. a spoofed
 * `repliedBy`) is rejected — same posture as CreatePostDto.
 */
export class ReplyCommentDto {
  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_REPLY_MESSAGE_LENGTH)
  message!: string;
}

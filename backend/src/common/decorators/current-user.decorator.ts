import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';

/** Extracts the authenticated user's id from the session. Use behind SessionAuthGuard. */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.session.userId as string;
  },
);

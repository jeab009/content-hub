import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

/**
 * Protects routes behind an authenticated session. Session-based
 * (connect-redis), not JWT, per approved architecture. Attaches
 * `request.userId` for downstream handlers/ownership checks.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (!request.session?.userId) {
      throw new UnauthorizedException('Authentication required');
    }

    return true;
  }
}

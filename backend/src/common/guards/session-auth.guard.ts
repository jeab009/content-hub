import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Protects routes behind an authenticated session. Session-based
 * (connect-redis), not JWT, per approved architecture. Attaches
 * `request.userId` for downstream handlers/ownership checks.
 *
 * Registered globally as APP_GUARD (see AppModule) — every route is
 * authenticated by default; `@Public()` is the explicit opt-out (L-3,
 * defense-in-depth backstop for the M-1 gap class: a controller shipped
 * without a guard because auth was opt-in per controller).
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();

    if (!request.session?.userId) {
      throw new UnauthorizedException('Authentication required');
    }

    return true;
  }
}

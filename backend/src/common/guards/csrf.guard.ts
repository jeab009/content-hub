import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';

export const CSRF_HEADER = 'x-csrf-token';

/**
 * Header-based (double-submit-adjacent) CSRF protection for mutating
 * endpoints (security decision #2). SameSite=Lax on the session cookie
 * already blocks most cross-site form/GET-based CSRF, but Lax still allows
 * top-level cross-site GET navigations and some simple-request cases, so a
 * dedicated token is required for state-changing requests. Fetch a token
 * from GET /api/auth/csrf (issued into the session after login) and send it
 * back as the `x-csrf-token` header on every mutating call. The OAuth
 * callback is intentionally exempt (Meta's redirect can't attach a custom
 * header) — that endpoint is instead protected by the `state` parameter.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const headerToken = request.headers[CSRF_HEADER];
    const sessionToken = request.session?.csrfToken;

    if (!sessionToken || !headerToken || headerToken !== sessionToken) {
      throw new ForbiddenException('Invalid or missing CSRF token');
    }

    return true;
  }
}

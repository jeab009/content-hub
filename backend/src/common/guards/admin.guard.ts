import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../modules/prisma/prisma.service';

/**
 * Authorization check for admin-only mutating actions (publish, ranking
 * recompute, manual ambiguity resolution). Must run AFTER SessionAuthGuard
 * (which establishes `request.session.userId` is a real, authenticated
 * session) — this guard adds the authorization layer on top of that
 * authentication layer.
 *
 * Phase 2 has exactly one role value (`admin`), same as Phase 1, but this
 * guard deliberately does NOT take a shortcut of "any authenticated session
 * is authorized" — it re-reads the user's role from the database on every
 * request, the same DB-truth-not-client-claim pattern
 * ConnectedAccountsService.findOwnedOrThrow() uses for ownership checks.
 * That keeps the check meaningful (and not silently bypassable) the moment
 * a second role is introduced, rather than needing every call site rewired
 * at that point (System Analyst condition #5 — IDOR / structure guard so
 * it isn't trivially bypassable when multi-user is added later).
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const userId = request.session?.userId;

    if (!userId) {
      throw new ForbiddenException('Authentication required');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'admin') {
      throw new ForbiddenException('Admin role required for this action');
    }

    return true;
  }
}

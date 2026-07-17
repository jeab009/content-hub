import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { PrismaService } from '../../modules/prisma/prisma.service';

function contextWithSession(session: Record<string, unknown> | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ session }),
    }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  let prisma: { user: { findUnique: jest.Mock } };
  let guard: AdminGuard;

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn() } };
    guard = new AdminGuard(prisma as unknown as PrismaService);
  });

  it('allows a session whose user is an admin in the database', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'admin' });

    await expect(guard.canActivate(contextWithSession({ userId: 'user-1' }))).resolves.toBe(true);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } });
  });

  it('rejects when there is no authenticated session', async () => {
    await expect(guard.canActivate(contextWithSession(undefined))).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a session without a userId', async () => {
    await expect(guard.canActivate(contextWithSession({}))).rejects.toThrow(ForbiddenException);
  });

  it('rejects a non-admin user', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'viewer' });

    await expect(guard.canActivate(contextWithSession({ userId: 'user-1' }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects a session whose user no longer exists', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(contextWithSession({ userId: 'ghost' }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('re-reads the role from the DB — a client-claimed role in the session is ignored', async () => {
    // Session data claims admin, but the DB (the only authority) says otherwise.
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'viewer' });

    await expect(
      guard.canActivate(contextWithSession({ userId: 'user-1', role: 'admin' })),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } });
  });
});

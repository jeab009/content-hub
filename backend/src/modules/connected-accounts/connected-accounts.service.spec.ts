import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConnectedAccountsService } from './connected-accounts.service';
import { PrismaService } from '../prisma/prisma.service';
import { FacebookGraphApiClient } from './services/facebook-graph-api.client';
import { TokenEncryptionService } from './services/token-encryption.service';
import { AuditLogService } from '../../common/audit/audit-log.service';

/**
 * Covers security decision #6: ownership/ACL checks on connected-accounts
 * mutation endpoints, even though Phase 1 has only one role value.
 */
describe('ConnectedAccountsService ownership checks', () => {
  let prisma: { connectedAccount: { findUnique: jest.Mock; update: jest.Mock } };
  let service: ConnectedAccountsService;

  const ownedAccount = {
    id: 'acct-1',
    userId: 'user-owner',
    platform: 'facebook',
    accessTokenEncrypted: 'ciphertext',
    status: 'connected',
  };

  beforeEach(() => {
    prisma = {
      connectedAccount: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(ownedAccount),
      },
    };

    service = new ConnectedAccountsService(
      prisma as unknown as PrismaService,
      {} as unknown as FacebookGraphApiClient,
      {
        decrypt: jest.fn().mockReturnValue('plaintext-token'),
      } as unknown as TokenEncryptionService,
      { record: jest.fn() } as unknown as AuditLogService,
    );
  });

  it('allows the owning user to read a token', async () => {
    prisma.connectedAccount.findUnique.mockResolvedValue(ownedAccount);

    const token = await service.getValidToken('acct-1', 'user-owner');
    expect(token).toBe('plaintext-token');
  });

  it('rejects a different authenticated user from reading the token', async () => {
    prisma.connectedAccount.findUnique.mockResolvedValue(ownedAccount);

    await expect(service.getValidToken('acct-1', 'user-attacker')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects a different authenticated user from disconnecting the account', async () => {
    prisma.connectedAccount.findUnique.mockResolvedValue(ownedAccount);

    await expect(service.disconnect('acct-1', 'user-attacker')).rejects.toThrow(ForbiddenException);
    expect(prisma.connectedAccount.update).not.toHaveBeenCalled();
  });

  it('returns 404 (not 403) for a nonexistent account id, avoiding existence leakage via status code alone', async () => {
    prisma.connectedAccount.findUnique.mockResolvedValue(null);

    await expect(service.getValidToken('does-not-exist', 'user-owner')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('allows the owning user to disconnect their own account', async () => {
    prisma.connectedAccount.findUnique.mockResolvedValue(ownedAccount);

    await service.disconnect('acct-1', 'user-owner');

    expect(prisma.connectedAccount.update).toHaveBeenCalledWith({
      where: { id: 'acct-1' },
      data: expect.objectContaining({
        status: 'disconnected',
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
      }),
    });
  });
});

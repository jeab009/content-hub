import { NotFoundException } from '@nestjs/common';
import { ConnectedAccountsService } from './connected-accounts.service';
import { PrismaService } from '../prisma/prisma.service';
import { FacebookGraphApiClient } from './services/facebook-graph-api.client';
import { GoogleOAuthApiClient } from './services/google-oauth-api.client';
import { TokenEncryptionService } from './services/token-encryption.service';
import { AuditLogService } from '../../common/audit/audit-log.service';

describe('ConnectedAccountsService.completeGoogleConnection', () => {
  let prisma: { connectedAccount: { upsert: jest.Mock } };
  let googleClient: {
    assertConfigured: jest.Mock;
    exchangeCodeForTokens: jest.Mock;
    getOwnChannel: jest.Mock;
    getConfiguredScopes: jest.Mock;
  };
  let auditLog: { record: jest.Mock };
  let service: ConnectedAccountsService;

  beforeEach(() => {
    prisma = {
      connectedAccount: {
        upsert: jest.fn().mockImplementation((args: { create: Record<string, unknown> }) => ({
          id: 'acct-yt-1',
          ...args.create,
        })),
      },
    };
    googleClient = {
      assertConfigured: jest.fn(),
      exchangeCodeForTokens: jest.fn().mockResolvedValue({
        access_token: 'google-access-token',
        refresh_token: 'google-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
      getOwnChannel: jest.fn().mockResolvedValue({ id: 'channel-1', title: 'My Channel' }),
      getConfiguredScopes: jest
        .fn()
        .mockReturnValue(['https://www.googleapis.com/auth/youtube.upload']),
    };
    auditLog = { record: jest.fn() };

    service = new ConnectedAccountsService(
      prisma as unknown as PrismaService,
      {} as unknown as FacebookGraphApiClient,
      googleClient as unknown as GoogleOAuthApiClient,
      {
        encrypt: jest.fn((plain: string) => `enc(${plain})`),
      } as unknown as TokenEncryptionService,
      auditLog as unknown as AuditLogService,
    );
  });

  it('exchanges the code, encrypts BOTH tokens, and upserts a youtube ConnectedAccount', async () => {
    await service.completeGoogleConnection('user-1', 'auth-code');

    const [{ where, create }] = prisma.connectedAccount.upsert.mock.calls[0] as [
      { where: Record<string, unknown>; create: Record<string, unknown> },
    ];
    expect(where).toEqual({
      userId_platform_platformAccountId: {
        userId: 'user-1',
        platform: 'youtube',
        platformAccountId: 'channel-1',
      },
    });
    expect(create.accessTokenEncrypted).toBe('enc(google-access-token)');
    expect(create.refreshTokenEncrypted).toBe('enc(google-refresh-token)');
    expect(create.platformAccountName).toBe('My Channel');
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'connected_account.oauth.connect',
        meta: expect.objectContaining({ platform: 'youtube' }),
      }),
    );
  });

  it('never nulls out a stored refresh token on reconnect when Google omits it', async () => {
    googleClient.exchangeCodeForTokens.mockResolvedValue({
      access_token: 'fresh-access-token',
      token_type: 'Bearer',
      expires_in: 3600,
      // no refresh_token — Google only returns it on first consent
    });

    await service.completeGoogleConnection('user-1', 'auth-code');

    const [{ update }] = prisma.connectedAccount.upsert.mock.calls[0] as [
      { update: Record<string, unknown> },
    ];
    expect(update).not.toHaveProperty('refreshTokenEncrypted');
  });

  it('throws (and writes no partial row) when the Google account has no YouTube channel', async () => {
    googleClient.getOwnChannel.mockResolvedValue(null);

    await expect(service.completeGoogleConnection('user-1', 'auth-code')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.connectedAccount.upsert).not.toHaveBeenCalled();
  });

  it('retries a failed Google call once before surfacing the error', async () => {
    googleClient.exchangeCodeForTokens
      .mockRejectedValueOnce(new Error('transient network error'))
      .mockResolvedValueOnce({
        access_token: 'google-access-token',
        refresh_token: 'google-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
      });

    await service.completeGoogleConnection('user-1', 'auth-code');

    expect(googleClient.exchangeCodeForTokens).toHaveBeenCalledTimes(2);
    expect(prisma.connectedAccount.upsert).toHaveBeenCalledTimes(1);
  });

  it('refuses to run when Google OAuth env vars are not configured', async () => {
    googleClient.assertConfigured.mockImplementation(() => {
      throw new Error('not configured');
    });

    await expect(service.completeGoogleConnection('user-1', 'auth-code')).rejects.toThrow(
      'not configured',
    );
    expect(googleClient.exchangeCodeForTokens).not.toHaveBeenCalled();
  });
});

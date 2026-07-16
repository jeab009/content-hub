import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConnectedAccount, Platform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { FacebookGraphApiClient } from './services/facebook-graph-api.client';
import { TokenEncryptionService } from './services/token-encryption.service';
import { ConnectedAccountResponseDto } from './dto/connected-account-response.dto';

const SECONDS_PER_DAY = 24 * 60 * 60;
const DEFAULT_LONG_LIVED_TOKEN_TTL_SECONDS = 60 * SECONDS_PER_DAY; // Meta long-lived page tokens are typically non-expiring, but we store a conservative estimate when Meta doesn't return expires_in.

@Injectable()
export class ConnectedAccountsService {
  private readonly logger = new Logger(ConnectedAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly facebookClient: FacebookGraphApiClient,
    private readonly tokenEncryption: TokenEncryptionService,
    private readonly auditLog: AuditLogService,
  ) {}

  async listForUser(userId: string): Promise<ConnectedAccountResponseDto[]> {
    const accounts = await this.prisma.connectedAccount.findMany({
      where: { userId },
      orderBy: { connectedAt: 'desc' },
    });
    return accounts.map((account) => this.toResponseDto(account));
  }

  /**
   * Full OAuth callback flow: exchange code -> long-lived token -> fetch
   * managed Pages -> encrypt token -> upsert ConnectedAccount. Network calls
   * to Meta are retried once on transport failure; if both attempts fail no
   * partial row is written (spec: "no partial persistence").
   */
  async completeFacebookConnection(userId: string, code: string): Promise<ConnectedAccount> {
    const shortLived = await this.withOneRetry(() =>
      this.facebookClient.exchangeCodeForShortLivedToken(code),
    );
    const longLived = await this.withOneRetry(() =>
      this.facebookClient.exchangeForLongLivedToken(shortLived.access_token),
    );
    const pages = await this.withOneRetry(() =>
      this.facebookClient.getManagedPages(longLived.access_token),
    );

    if (pages.length === 0) {
      throw new NotFoundException(
        'No Facebook Pages available for this account. Grant Page access and retry the connection.',
      );
    }

    // Phase 1 UI connects a single primary Page; first returned Page is used.
    const [page] = pages;
    const expiresAt = new Date(
      Date.now() + (longLived.expires_in ?? DEFAULT_LONG_LIVED_TOKEN_TTL_SECONDS) * 1000,
    );

    const account = await this.prisma.connectedAccount.upsert({
      where: {
        userId_platform_platformAccountId: {
          userId,
          platform: Platform.facebook,
          platformAccountId: page.id,
        },
      },
      create: {
        userId,
        platform: Platform.facebook,
        platformAccountId: page.id,
        platformAccountName: page.name,
        accessTokenEncrypted: this.tokenEncryption.encrypt(page.access_token),
        refreshTokenEncrypted: null,
        tokenExpiresAt: expiresAt,
        scopes: this.facebookScopesList(),
        status: 'connected',
        connectedAt: new Date(),
        disconnectedAt: null,
      },
      update: {
        platformAccountName: page.name,
        accessTokenEncrypted: this.tokenEncryption.encrypt(page.access_token),
        tokenExpiresAt: expiresAt,
        scopes: this.facebookScopesList(),
        status: 'connected',
        connectedAt: new Date(),
        disconnectedAt: null,
      },
    });

    this.auditLog.record({
      actor: userId,
      action: 'connected_account.oauth.connect',
      result: 'success',
      meta: { platform: 'facebook', connectedAccountId: account.id },
    });

    return account;
  }

  /**
   * The ONLY sanctioned way for other modules to read a decrypted token.
   * Enforces ownership by requiring the caller to pass the expected userId.
   */
  async getValidToken(accountId: string, userId: string): Promise<string> {
    const account = await this.findOwnedOrThrow(accountId, userId);
    if (!account.accessTokenEncrypted || account.status !== 'connected') {
      throw new ConflictException('Connected account has no valid token; reconnect required');
    }
    return this.tokenEncryption.decrypt(account.accessTokenEncrypted);
  }

  /**
   * Disconnects an account: marks disconnected AND overwrites the encrypted
   * token columns with null so a leaked DB backup can't reveal a still-valid
   * credential after "disconnect".
   */
  async disconnect(accountId: string, userId: string): Promise<void> {
    await this.findOwnedOrThrow(accountId, userId);

    await this.prisma.connectedAccount.update({
      where: { id: accountId },
      data: {
        status: 'disconnected',
        disconnectedAt: new Date(),
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
      },
    });

    this.auditLog.record({
      actor: userId,
      action: 'connected_account.disconnect',
      result: 'success',
      meta: { connectedAccountId: accountId },
    });
  }

  /** Used by the daily token-refresh job (QueueModule). */
  async findAccountsExpiringWithin(days: number): Promise<ConnectedAccount[]> {
    const threshold = new Date(Date.now() + days * SECONDS_PER_DAY * 1000);
    return this.prisma.connectedAccount.findMany({
      where: {
        tokenExpiresAt: { lt: threshold },
        status: 'connected',
      },
    });
  }

  async refreshToken(accountId: string): Promise<void> {
    const account = await this.prisma.connectedAccount.findUnique({ where: { id: accountId } });
    if (!account || !account.accessTokenEncrypted) {
      return;
    }

    try {
      const currentToken = this.tokenEncryption.decrypt(account.accessTokenEncrypted);
      const refreshed = await this.withOneRetry(() =>
        this.facebookClient.exchangeForLongLivedToken(currentToken),
      );

      await this.prisma.connectedAccount.update({
        where: { id: account.id },
        data: {
          accessTokenEncrypted: this.tokenEncryption.encrypt(refreshed.access_token),
          tokenExpiresAt: new Date(
            Date.now() + (refreshed.expires_in ?? DEFAULT_LONG_LIVED_TOKEN_TTL_SECONDS) * 1000,
          ),
        },
      });
    } catch (error) {
      this.logger.warn(
        `Token refresh failed for connected account ${account.id}: ${(error as Error).message}`,
      );
      this.auditLog.record({
        actor: 'system:token-refresh-job',
        action: 'connected_account.token_refresh.failure',
        result: 'failure',
        meta: { connectedAccountId: account.id },
      });
      await this.prisma.connectedAccount.update({
        where: { id: account.id },
        data: { status: 'expired' },
      });
    }
  }

  private async findOwnedOrThrow(accountId: string, userId: string): Promise<ConnectedAccount> {
    const account = await this.prisma.connectedAccount.findUnique({ where: { id: accountId } });

    if (!account) {
      throw new NotFoundException('Connected account not found');
    }

    // Ownership/ACL check (security decision #6) — even though Phase 1 has
    // only one role value, never let "any authenticated admin can act on any
    // row" become the default.
    if (account.userId !== userId) {
      throw new ForbiddenException('You do not have access to this connected account');
    }

    return account;
  }

  private facebookScopesList(): string[] {
    return this.facebookClient.getConfiguredScopes();
  }

  private toResponseDto(account: ConnectedAccount): ConnectedAccountResponseDto {
    return {
      id: account.id,
      platform: account.platform,
      platformAccountId: account.platformAccountId,
      platformAccountName: account.platformAccountName,
      status: account.status,
      scopes: account.scopes,
      tokenExpiresAt: account.tokenExpiresAt,
      connectedAt: account.connectedAt,
      disconnectedAt: account.disconnectedAt,
    };
  }

  /** Retries a Meta API call once on failure before surfacing the error (spec: "retry once then surface error"). */
  private async withOneRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (firstError) {
      this.logger.warn(`Meta API call failed, retrying once: ${(firstError as Error).message}`);
      return fn();
    }
  }
}

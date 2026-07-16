import { ConnectedAccountStatus, Platform } from '@prisma/client';

/**
 * API-facing shape for a ConnectedAccount. Deliberately omits
 * accessTokenEncrypted/refreshTokenEncrypted — tokens must never leave the
 * server (ConnectedAccountsService.getValidToken() is the only sanctioned
 * reader, and it's for internal use, not exposed via HTTP).
 */
export class ConnectedAccountResponseDto {
  id!: string;
  platform!: Platform;
  platformAccountId!: string;
  platformAccountName!: string;
  status!: ConnectedAccountStatus;
  scopes!: string[];
  tokenExpiresAt!: Date;
  connectedAt!: Date;
  disconnectedAt!: Date | null;
}

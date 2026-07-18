import { Module } from '@nestjs/common';
import { ConnectedAccountsController } from './connected-accounts.controller';
import { ConnectedAccountsService } from './connected-accounts.service';
import { OAuthStateService } from './services/oauth-state.service';
import { FacebookGraphApiClient } from './services/facebook-graph-api.client';
import { GoogleOAuthApiClient } from './services/google-oauth-api.client';
import { TokenEncryptionService } from './services/token-encryption.service';

/**
 * Module boundary per approved architecture: ConnectedAccountsService.
 * getValidToken() is the ONLY way other modules may ever read a decrypted
 * token — TokenEncryptionService is provided here but intentionally NOT
 * exported, so nothing outside this module can import it and decrypt
 * directly.
 */
@Module({
  controllers: [ConnectedAccountsController],
  providers: [
    ConnectedAccountsService,
    OAuthStateService,
    FacebookGraphApiClient,
    GoogleOAuthApiClient,
    TokenEncryptionService,
  ],
  exports: [ConnectedAccountsService],
})
export class ConnectedAccountsModule {}

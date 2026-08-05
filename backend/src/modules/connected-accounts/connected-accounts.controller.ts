import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { AppConfig } from '../../config/configuration';
import { ConnectedAccountsService } from './connected-accounts.service';
import { OAuthStateService, OAuthProvider } from './services/oauth-state.service';
import { FacebookGraphApiClient } from './services/facebook-graph-api.client';
import { GoogleOAuthApiClient } from './services/google-oauth-api.client';
import { ConnectedAccountResponseDto } from './dto/connected-account-response.dto';

/**
 * OAuth connect/disconnect flows, exactly per the approved sequence:
 * GET .../authorize -> generate state, store in session -> 302 to provider.
 * GET .../callback -> validate state -> exchange code -> fetch account
 * identity -> encrypt token(s) -> upsert -> redirect to /settings?status=....
 * Facebook is Phase 1; the Google/YouTube flow (Phase 2 Pass B) follows the
 * same structure with its own state keys and token exchange.
 */
@Controller('api/connected-accounts')
@UseGuards(SessionAuthGuard, AdminGuard)
export class ConnectedAccountsController {
  // The callback runs on the backend's own origin (Google/Facebook redirect
  // the browser straight back to it), but the destination page lives on the
  // frontend — a different origin in every environment except behind a
  // shared reverse proxy. A relative '/settings?...' redirect resolves
  // against the backend's own origin and 404s there; found live testing
  // the Google connect flow (the exchange itself succeeded — this was
  // purely the post-success redirect landing on the wrong host).
  private readonly frontendOrigin: string;

  constructor(
    private readonly connectedAccountsService: ConnectedAccountsService,
    private readonly oauthStateService: OAuthStateService,
    private readonly facebookClient: FacebookGraphApiClient,
    private readonly googleClient: GoogleOAuthApiClient,
    private readonly auditLog: AuditLogService,
    configService: ConfigService,
  ) {
    const app = configService.get<AppConfig>('app');
    if (!app) {
      throw new Error('App config not loaded');
    }
    this.frontendOrigin = app.corsOrigin.split(',')[0].trim();
  }

  private settingsRedirectUrl(query: string): string {
    return `${this.frontendOrigin}/settings?${query}`;
  }

  @Get()
  async list(@CurrentUserId() userId: string): Promise<ConnectedAccountResponseDto[]> {
    return this.connectedAccountsService.listForUser(userId);
  }

  @Get('facebook/authorize')
  authorize(@Req() request: Request, @Res() response: Response): void {
    const state = this.oauthStateService.generate(request.session);
    const consentUrl = this.facebookClient.buildConsentUrl(state);
    response.redirect(HttpStatus.FOUND, consentUrl);
  }

  @Get('facebook/callback')
  async callback(
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUserId() userId: string,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    await this.handleOAuthCallback('facebook', request, response, userId, code, state, error);
  }

  /** Google/YouTube connect — same authorize/callback structure as Facebook. */
  @Get('google/authorize')
  googleAuthorize(@Req() request: Request, @Res() response: Response): void {
    this.googleClient.assertConfigured();
    const state = this.oauthStateService.generate(request.session, 'google');
    const consentUrl = this.googleClient.buildConsentUrl(state);
    response.redirect(HttpStatus.FOUND, consentUrl);
  }

  @Get('google/callback')
  async googleCallback(
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUserId() userId: string,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    await this.handleOAuthCallback('google', request, response, userId, code, state, error);
  }

  /**
   * Shared callback sequence for both providers: provider-reported error →
   * cancelled redirect; state mismatch → 403 with NO exchange attempted;
   * missing code → cancelled; otherwise exchange + upsert with a
   * user-facing retry message on failure (auth codes are single-use, so a
   * double-submitted callback legitimately fails — security decision #8).
   */
  private async handleOAuthCallback(
    provider: OAuthProvider,
    request: Request,
    response: Response,
    userId: string,
    code?: string,
    state?: string,
    error?: string,
  ): Promise<void> {
    const providerLabel = provider === 'facebook' ? 'Facebook' : 'Google';

    if (error) {
      this.auditLog.record({
        actor: userId,
        action: 'connected_account.oauth.error',
        result: 'failure',
        meta: { provider, reason: error },
      });
      response.redirect(
        HttpStatus.FOUND,
        this.settingsRedirectUrl('status=cancelled&reason=access_denied'),
      );
      return;
    }

    const stateIsValid = this.oauthStateService.validate(request.session, state, provider);
    if (!stateIsValid) {
      this.auditLog.record({
        actor: userId,
        action: 'connected_account.oauth.error',
        result: 'failure',
        meta: { provider, reason: 'state_mismatch' },
      });
      throw new ForbiddenException('Invalid or expired OAuth state');
    }

    if (!code) {
      response.redirect(
        HttpStatus.FOUND,
        this.settingsRedirectUrl('status=cancelled&reason=missing_code'),
      );
      return;
    }

    try {
      if (provider === 'facebook') {
        await this.connectedAccountsService.completeFacebookConnection(userId, code);
      } else {
        await this.connectedAccountsService.completeGoogleConnection(userId, code);
      }
      response.redirect(HttpStatus.FOUND, this.settingsRedirectUrl('status=success'));
    } catch {
      this.auditLog.record({
        actor: userId,
        action: 'connected_account.oauth.error',
        result: 'failure',
        meta: { provider, reason: 'exchange_failed' },
      });
      response.redirect(
        HttpStatus.FOUND,
        this.settingsRedirectUrl(
          'status=error&reason=exchange_failed&message=' +
            encodeURIComponent(
              `Could not connect to ${providerLabel}. Please retry the connection.`,
            ),
        ),
      );
    }
  }

  @Delete(':id')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async disconnect(@Param('id') id: string, @CurrentUserId() userId: string): Promise<void> {
    await this.connectedAccountsService.disconnect(id, userId);
  }
}

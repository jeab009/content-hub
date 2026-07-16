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
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { ConnectedAccountsService } from './connected-accounts.service';
import { OAuthStateService } from './services/oauth-state.service';
import { FacebookGraphApiClient } from './services/facebook-graph-api.client';
import { ConnectedAccountResponseDto } from './dto/connected-account-response.dto';

/**
 * Facebook OAuth connect/disconnect flow, exactly per the approved sequence:
 * GET .../authorize -> generate state, store in session -> 302 to Meta.
 * GET .../callback -> validate state -> exchange code -> exchange long-lived
 * -> fetch Pages -> encrypt -> upsert -> redirect to /settings?status=....
 */
@Controller('api/connected-accounts')
export class ConnectedAccountsController {
  constructor(
    private readonly connectedAccountsService: ConnectedAccountsService,
    private readonly oauthStateService: OAuthStateService,
    private readonly facebookClient: FacebookGraphApiClient,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get()
  @UseGuards(SessionAuthGuard)
  async list(@CurrentUserId() userId: string): Promise<ConnectedAccountResponseDto[]> {
    return this.connectedAccountsService.listForUser(userId);
  }

  @Get('facebook/authorize')
  @UseGuards(SessionAuthGuard)
  authorize(@Req() request: Request, @Res() response: Response): void {
    const state = this.oauthStateService.generate(request.session);
    const consentUrl = this.facebookClient.buildConsentUrl(state);
    response.redirect(HttpStatus.FOUND, consentUrl);
  }

  @Get('facebook/callback')
  @UseGuards(SessionAuthGuard)
  async callback(
    @Req() request: Request,
    @Res() response: Response,
    @CurrentUserId() userId: string,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    // Meta access_denied path: user declined consent. Non-destructive,
    // user-facing message, no exchange attempted.
    if (error) {
      this.auditLog.record({
        actor: userId,
        action: 'connected_account.oauth.error',
        result: 'failure',
        meta: { reason: error },
      });
      response.redirect(HttpStatus.FOUND, '/settings?status=cancelled&reason=access_denied');
      return;
    }

    const stateIsValid = this.oauthStateService.validate(request.session, state);
    if (!stateIsValid) {
      this.auditLog.record({
        actor: userId,
        action: 'connected_account.oauth.error',
        result: 'failure',
        meta: { reason: 'state_mismatch' },
      });
      throw new ForbiddenException('Invalid or expired OAuth state');
    }

    if (!code) {
      response.redirect(HttpStatus.FOUND, '/settings?status=cancelled&reason=missing_code');
      return;
    }

    try {
      await this.connectedAccountsService.completeFacebookConnection(userId, code);
      response.redirect(HttpStatus.FOUND, '/settings?status=success');
    } catch {
      this.auditLog.record({
        actor: userId,
        action: 'connected_account.oauth.error',
        result: 'failure',
        meta: { reason: 'exchange_failed' },
      });
      // Authorization codes are single-use; a retried callback (double
      // submit, browser back-button) will legitimately fail the exchange.
      // User-facing copy asks for a fresh attempt rather than implying the
      // app is broken (security decision #8).
      response.redirect(
        HttpStatus.FOUND,
        '/settings?status=error&reason=exchange_failed&message=' +
          encodeURIComponent('Could not connect to Facebook. Please retry the connection.'),
      );
    }
  }

  @Delete(':id')
  @UseGuards(SessionAuthGuard, CsrfGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async disconnect(@Param('id') id: string, @CurrentUserId() userId: string): Promise<void> {
    await this.connectedAccountsService.disconnect(id, userId);
  }
}

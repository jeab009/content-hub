import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../config/configuration';

export interface FacebookTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

export interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
}

interface FacebookPagesResponse {
  data: FacebookPage[];
}

/**
 * Thin HTTP client over the Meta Graph API. Uses Node 20's built-in `fetch`
 * rather than adding an HTTP client dependency. Every method here performs
 * exactly one Graph API call — retry-once-on-network-failure semantics
 * (required by the OAuth error-path spec) live in the caller
 * (ConnectedAccountsService), not here, so this class stays a simple,
 * mockable transport for unit tests.
 */
@Injectable()
export class FacebookGraphApiClient {
  private readonly appConfig: AppConfig['facebook'];
  private readonly graphBaseUrl: string;

  constructor(configService: ConfigService) {
    const app = configService.get<AppConfig>('app');
    if (!app) {
      throw new Error('App config not loaded');
    }
    this.appConfig = app.facebook;
    this.graphBaseUrl = `https://graph.facebook.com/${this.appConfig.graphApiVersion}`;
  }

  getConfiguredScopes(): string[] {
    return this.appConfig.scopes;
  }

  buildConsentUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.appConfig.appId,
      redirect_uri: this.appConfig.redirectUri,
      state,
      scope: this.appConfig.scopes.join(','),
      response_type: 'code',
    });
    return `https://www.facebook.com/${this.appConfig.graphApiVersion}/dialog/oauth?${params.toString()}`;
  }

  async exchangeCodeForShortLivedToken(code: string): Promise<FacebookTokenResponse> {
    const params = new URLSearchParams({
      client_id: this.appConfig.appId,
      client_secret: this.appConfig.appSecret,
      redirect_uri: this.appConfig.redirectUri,
      code,
    });
    return this.get<FacebookTokenResponse>(`/oauth/access_token?${params.toString()}`);
  }

  async exchangeForLongLivedToken(shortLivedToken: string): Promise<FacebookTokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: this.appConfig.appId,
      client_secret: this.appConfig.appSecret,
      fb_exchange_token: shortLivedToken,
    });
    return this.get<FacebookTokenResponse>(`/oauth/access_token?${params.toString()}`);
  }

  async getManagedPages(userAccessToken: string): Promise<FacebookPage[]> {
    const params = new URLSearchParams({ access_token: userAccessToken });
    const response = await this.get<FacebookPagesResponse>(`/me/accounts?${params.toString()}`);
    return response.data;
  }

  private async get<T>(path: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.graphBaseUrl}${path}`);
    } catch {
      throw new BadGatewayException('Network error contacting Meta Graph API');
    }

    if (!response.ok) {
      throw new BadGatewayException(`Meta Graph API returned status ${response.status}`);
    }

    return (await response.json()) as T;
  }
}

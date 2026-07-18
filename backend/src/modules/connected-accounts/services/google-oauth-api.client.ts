import { BadGatewayException, ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../config/configuration';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YOUTUBE_CHANNELS_URL =
  'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true';

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type: string;
}

export interface YouTubeChannel {
  id: string;
  title: string;
}

interface YouTubeChannelsApiResponse {
  items?: Array<{ id: string; snippet?: { title?: string } }>;
}

/**
 * Thin HTTP client over Google's OAuth token endpoint + the YouTube Data
 * API channel lookup — structurally the mirror of FacebookGraphApiClient:
 * one network call per method, no retry logic here (retry-once semantics
 * live in ConnectedAccountsService), Node 20 built-in fetch.
 *
 * `access_type=offline&prompt=consent` on the consent URL makes Google
 * return a refresh_token — Google access tokens live ~1 hour, so without
 * the refresh token the connection would die within the hour.
 */
@Injectable()
export class GoogleOAuthApiClient {
  private readonly googleConfig: AppConfig['google'];

  constructor(configService: ConfigService) {
    const app = configService.get<AppConfig>('app');
    if (!app) {
      throw new Error('App config not loaded');
    }
    this.googleConfig = app.google;
  }

  getConfiguredScopes(): string[] {
    return this.googleConfig.scopes;
  }

  /** Throws 409 with a clear message when the env vars are still blank. */
  assertConfigured(): void {
    if (!this.googleConfig.clientId || !this.googleConfig.clientSecret) {
      throw new ConflictException(
        'Google OAuth is not configured (set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)',
      );
    }
  }

  buildConsentUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.googleConfig.clientId,
      redirect_uri: this.googleConfig.redirectUri,
      response_type: 'code',
      scope: this.googleConfig.scopes.join(' '),
      state,
      access_type: 'offline',
      prompt: 'consent',
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
    const body = new URLSearchParams({
      code,
      client_id: this.googleConfig.clientId,
      client_secret: this.googleConfig.clientSecret,
      redirect_uri: this.googleConfig.redirectUri,
      grant_type: 'authorization_code',
    });

    let response: Response;
    try {
      response = await fetch(GOOGLE_TOKEN_URL, { method: 'POST', body });
    } catch {
      throw new BadGatewayException('Network error contacting Google OAuth token endpoint');
    }
    if (!response.ok) {
      throw new BadGatewayException(
        `Google OAuth token endpoint returned status ${response.status}`,
      );
    }
    return (await response.json()) as GoogleTokenResponse;
  }

  async getOwnChannel(accessToken: string): Promise<YouTubeChannel | null> {
    let response: Response;
    try {
      response = await fetch(YOUTUBE_CHANNELS_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      throw new BadGatewayException('Network error contacting YouTube Data API');
    }
    if (!response.ok) {
      throw new BadGatewayException(`YouTube Data API returned status ${response.status}`);
    }

    const payload = (await response.json()) as YouTubeChannelsApiResponse;
    const [channel] = payload.items ?? [];
    if (!channel) {
      return null;
    }
    return { id: channel.id, title: channel.snippet?.title ?? 'YouTube channel' };
  }
}

import { Injectable } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Session, SessionData } from 'express-session';

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — generous enough for the consent redirect round trip.

/** OAuth providers with a connect flow. Each gets its own session state keys. */
export type OAuthProvider = 'facebook' | 'google';

interface StateSessionKeys {
  stateKey: 'fbOauthState' | 'googleOauthState';
  expiresKey: 'fbOauthStateExpiresAt' | 'googleOauthStateExpiresAt';
}

const PROVIDER_SESSION_KEYS: Record<OAuthProvider, StateSessionKeys> = {
  facebook: { stateKey: 'fbOauthState', expiresKey: 'fbOauthStateExpiresAt' },
  google: { stateKey: 'googleOauthState', expiresKey: 'googleOauthStateExpiresAt' },
};

/**
 * CSRF state-token generation/validation for OAuth handshakes (Facebook
 * Phase 1, Google/YouTube Phase 2 Pass B). The token is stored in the
 * user's Redis-backed session (not a separate store) so it is
 * automatically scoped to one browser session and expires with it. Each
 * provider uses distinct session keys so an in-flight Facebook handshake
 * can never validate a Google callback or vice versa. Validation rejects
 * on any mismatch, expiry, or missing state — no exchange is ever
 * attempted unless this passes (security requirement: "reject mismatch ->
 * 403, no exchange attempted").
 */
@Injectable()
export class OAuthStateService {
  generate(session: Session & Partial<SessionData>, provider: OAuthProvider = 'facebook'): string {
    const { stateKey, expiresKey } = PROVIDER_SESSION_KEYS[provider];
    const state = randomBytes(32).toString('hex');
    session[stateKey] = state;
    session[expiresKey] = Date.now() + STATE_TTL_MS;
    return state;
  }

  /**
   * Validates and, on success, consumes (clears) the stored state so it
   * cannot be replayed for a second callback.
   */
  validate(
    session: Session & Partial<SessionData>,
    providedState: string | undefined,
    provider: OAuthProvider = 'facebook',
  ): boolean {
    const { stateKey, expiresKey } = PROVIDER_SESSION_KEYS[provider];
    const storedState = session[stateKey];
    const expiresAt = session[expiresKey];

    const isValid = Boolean(
      storedState &&
      providedState &&
      expiresAt &&
      Date.now() < expiresAt &&
      this.constantTimeEquals(storedState, providedState),
    );

    // Always clear after one use, valid or not, to prevent replay.
    delete session[stateKey];
    delete session[expiresKey];

    return isValid;
  }

  private constantTimeEquals(a: string, b: string): boolean {
    const bufferA = Buffer.from(a);
    const bufferB = Buffer.from(b);
    if (bufferA.length !== bufferB.length) {
      return false;
    }
    return timingSafeEqual(bufferA, bufferB);
  }
}

import { Injectable } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Session, SessionData } from 'express-session';

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — generous enough for the Meta consent redirect round trip.

/**
 * CSRF state-token generation/validation for the Facebook OAuth handshake.
 * The token is stored in the user's Redis-backed session (not a separate
 * store) so it is automatically scoped to one browser session and expires
 * with it. Validation rejects on any mismatch, expiry, or missing state —
 * no exchange is ever attempted unless this passes (security requirement:
 * "reject mismatch -> 403, no exchange attempted").
 */
@Injectable()
export class OAuthStateService {
  generate(session: Session & Partial<SessionData>): string {
    const state = randomBytes(32).toString('hex');
    session.fbOauthState = state;
    session.fbOauthStateExpiresAt = Date.now() + STATE_TTL_MS;
    return state;
  }

  /**
   * Validates and, on success, consumes (clears) the stored state so it
   * cannot be replayed for a second callback.
   */
  validate(session: Session & Partial<SessionData>, providedState: string | undefined): boolean {
    const storedState = session.fbOauthState;
    const expiresAt = session.fbOauthStateExpiresAt;

    const isValid = Boolean(
      storedState &&
      providedState &&
      expiresAt &&
      Date.now() < expiresAt &&
      this.constantTimeEquals(storedState, providedState),
    );

    // Always clear after one use, valid or not, to prevent replay.
    delete session.fbOauthState;
    delete session.fbOauthStateExpiresAt;

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

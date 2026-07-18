import { OAuthStateService } from './oauth-state.service';
import type { Session, SessionData } from 'express-session';

type FakeSession = Session & Partial<SessionData>;

function fakeSession(): FakeSession {
  return {} as FakeSession;
}

describe('OAuthStateService', () => {
  let service: OAuthStateService;

  beforeEach(() => {
    service = new OAuthStateService();
  });

  it('generates a state token and stores it on the session', () => {
    const session = fakeSession();
    const state = service.generate(session);

    expect(state).toHaveLength(64); // 32 bytes hex-encoded
    expect(session.fbOauthState).toBe(state);
    expect(session.fbOauthStateExpiresAt).toBeGreaterThan(Date.now());
  });

  it('validates a matching, unexpired state token', () => {
    const session = fakeSession();
    const state = service.generate(session);

    expect(service.validate(session, state)).toBe(true);
  });

  it('rejects a mismatched state token (CSRF attempt)', () => {
    const session = fakeSession();
    service.generate(session);

    expect(service.validate(session, 'attacker-supplied-state')).toBe(false);
  });

  it('rejects when no state was ever generated for this session', () => {
    const session = fakeSession();
    expect(service.validate(session, 'anything')).toBe(false);
  });

  it('rejects a missing/undefined state parameter', () => {
    const session = fakeSession();
    service.generate(session);
    expect(service.validate(session, undefined)).toBe(false);
  });

  it('rejects an expired state token', () => {
    const session = fakeSession();
    const state = service.generate(session);
    session.fbOauthStateExpiresAt = Date.now() - 1; // force expiry

    expect(service.validate(session, state)).toBe(false);
  });

  it('clears the state after one use, preventing replay', () => {
    const session = fakeSession();
    const state = service.generate(session);

    expect(service.validate(session, state)).toBe(true);
    expect(session.fbOauthState).toBeUndefined();
    // A second attempt with the same (now-consumed) state must fail.
    expect(service.validate(session, state)).toBe(false);
  });

  it('clears the state even on a failed validation, so a mismatch cannot be retried against the same stored state', () => {
    const session = fakeSession();
    service.generate(session);

    service.validate(session, 'wrong-state');
    expect(session.fbOauthState).toBeUndefined();
  });

  describe('per-provider isolation (google vs facebook)', () => {
    it('stores google state under its own session keys', () => {
      const session = fakeSession();
      const state = service.generate(session, 'google');

      expect(session.googleOauthState).toBe(state);
      expect(session.fbOauthState).toBeUndefined();
    });

    it('a google state can never validate a facebook callback (and vice versa)', () => {
      const session = fakeSession();
      const googleState = service.generate(session, 'google');
      const facebookState = service.generate(session, 'facebook');

      expect(service.validate(session, googleState, 'facebook')).toBe(false);
      expect(service.validate(session, facebookState, 'google')).toBe(false);
    });

    it('validates and consumes a google state for a google callback', () => {
      const session = fakeSession();
      const state = service.generate(session, 'google');

      expect(service.validate(session, state, 'google')).toBe(true);
      expect(session.googleOauthState).toBeUndefined();
      expect(service.validate(session, state, 'google')).toBe(false); // replay blocked
    });

    it('an in-flight facebook handshake survives a google generate/validate cycle', () => {
      const session = fakeSession();
      const facebookState = service.generate(session, 'facebook');
      const googleState = service.generate(session, 'google');

      expect(service.validate(session, googleState, 'google')).toBe(true);
      expect(service.validate(session, facebookState, 'facebook')).toBe(true);
    });
  });
});

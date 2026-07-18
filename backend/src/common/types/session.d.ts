import 'express-session';

/**
 * Module augmentation so `req.session.userId` etc. are typed everywhere
 * instead of falling back to `any`.
 */
declare module 'express-session' {
  interface SessionData {
    userId?: string;
    userEmail?: string;
    csrfToken?: string;
    /** CSRF-protecting state token for the in-flight Facebook OAuth handshake. */
    fbOauthState?: string;
    fbOauthStateExpiresAt?: number;
    /** CSRF-protecting state token for the in-flight Google OAuth handshake. */
    googleOauthState?: string;
    googleOauthStateExpiresAt?: number;
  }
}

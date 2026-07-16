/**
 * Thin fetch wrapper for the Content Hub backend. Always sends cookies
 * (`credentials: 'include'`) so the session cookie round-trips on every
 * call, and attaches the CSRF header (fetched separately via getCsrfToken)
 * on any mutating request — the backend's CsrfGuard rejects mutations
 * without it.
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH';
  body?: unknown;
  csrfToken?: string;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.csrfToken) {
    headers['x-csrf-token'] = options.csrfToken;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = await response.json().catch(() => undefined);

  if (!response.ok) {
    const message =
      (payload && typeof payload === 'object' && 'message' in payload && String(payload.message)) ||
      `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status);
  }

  return payload as T;
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
}

export interface ConnectedAccount {
  id: string;
  platform: 'facebook' | 'youtube' | 'tiktok' | 'line';
  platformAccountId: string;
  platformAccountName: string;
  status: 'connected' | 'disconnected' | 'expired' | 'revoked';
  scopes: string[];
  tokenExpiresAt: string;
  connectedAt: string;
  disconnectedAt: string | null;
}

export const apiClient = {
  login: (email: string, password: string) =>
    request<{ success: true; user: CurrentUser }>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    }),

  logout: (csrfToken: string) =>
    request<void>('/api/auth/logout', { method: 'POST', csrfToken }),

  me: () => request<CurrentUser>('/api/auth/me'),

  getCsrfToken: () => request<{ csrfToken: string }>('/api/auth/csrf'),

  listConnectedAccounts: () => request<ConnectedAccount[]>('/api/connected-accounts'),

  facebookAuthorizeUrl: () => `${API_BASE_URL}/api/connected-accounts/facebook/authorize`,

  disconnectAccount: (id: string, csrfToken: string) =>
    request<void>(`/api/connected-accounts/${id}`, { method: 'DELETE', csrfToken }),
};

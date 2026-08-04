'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient, ApiError, ConnectedAccount, CurrentUser } from '@/lib/api-client';
import { AppHeader } from '@/components/AppHeader';

// Provider-neutral: this page now offers both Facebook and Google/YouTube
// connect buttons, and the backend's callback redirect (see
// connected-accounts.controller.ts's handleOAuthCallback) doesn't identify
// which provider a success/cancelled redirect came from — only the error
// case carries a provider-specific `message` param, read separately below.
const STATUS_MESSAGES: Record<string, { tone: 'success' | 'warning' | 'danger'; text: string }> = {
  success: { tone: 'success', text: 'Account connected successfully.' },
  cancelled: { tone: 'warning', text: 'Connection was cancelled.' },
};

export default function SettingsPage(): JSX.Element {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <SettingsPageContent />
    </Suspense>
  );
}

function SettingsPageContent(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [user, setUser] = useState<CurrentUser | null>(null);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [currentUser, csrf, connectedAccounts] = await Promise.all([
        apiClient.me(),
        apiClient.getCsrfToken(),
        apiClient.listConnectedAccounts(),
      ]);
      setUser(currentUser);
      setCsrfToken(csrf.csrfToken);
      setAccounts(connectedAccounts);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }
      setActionError('Failed to load account data.');
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleLogout(): Promise<void> {
    if (!csrfToken) return;
    await apiClient.logout(csrfToken);
    router.push('/login');
  }

  async function handleDisconnect(accountId: string): Promise<void> {
    if (!csrfToken) return;
    setActionError(null);
    try {
      await apiClient.disconnectAccount(accountId, csrfToken);
      await loadData();
    } catch {
      setActionError('Failed to disconnect account.');
    }
  }

  const status = searchParams.get('status');
  // Backend's `message` param (see handleOAuthCallback's exchange_failed
  // branch) is already provider-aware ("Could not connect to Google...");
  // previously this page ignored it and always showed Facebook's copy.
  const statusBanner =
    status === 'error'
      ? {
          tone: 'danger' as const,
          text:
            searchParams.get('message') ?? 'Could not connect. Please retry the connection.',
        }
      : status
        ? STATUS_MESSAGES[status]
        : null;

  if (isLoading) {
    return <p>Loading…</p>;
  }

  return (
    <div>
      <AppHeader>
        {user && (
          <>
            <span className="text-muted small">{user.email}</span>
            <button className="btn btn-outline-secondary btn-sm" onClick={handleLogout}>
              Log out
            </button>
          </>
        )}
      </AppHeader>

      <h1 className="h3 mb-4">Settings</h1>

      {statusBanner && (
        <div className={`alert alert-${statusBanner.tone}`} role="status">
          {statusBanner.text}
        </div>
      )}
      {actionError && (
        <div className="alert alert-danger" role="alert">
          {actionError}
        </div>
      )}

      <section>
        <h2 className="h5">Connected accounts</h2>

        {accounts.length === 0 ? (
          <p className="text-muted">No accounts connected yet.</p>
        ) : (
          <ul className="list-group mb-3">
            {accounts.map((account) => (
              <li
                key={account.id}
                className="list-group-item d-flex justify-content-between align-items-center"
              >
                <div>
                  <strong className="text-capitalize">{account.platform}</strong> —{' '}
                  {account.platformAccountName}
                  <span
                    className={`badge ms-2 ${account.status === 'connected' ? 'bg-success' : 'bg-secondary'}`}
                  >
                    {account.status}
                  </span>
                </div>
                {account.status === 'connected' && (
                  <button
                    className="btn btn-sm btn-outline-danger"
                    onClick={() => void handleDisconnect(account.id)}
                  >
                    Disconnect
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <a className="btn btn-primary" href={apiClient.facebookAuthorizeUrl()}>
          Connect a Facebook Page
        </a>{' '}
        <a className="btn btn-primary" href={apiClient.googleAuthorizeUrl()}>
          Connect a YouTube Channel
        </a>
      </section>
    </div>
  );
}

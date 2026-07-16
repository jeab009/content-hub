'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient, ApiError, ConnectedAccount, CurrentUser } from '@/lib/api-client';

const STATUS_MESSAGES: Record<string, { tone: 'success' | 'warning' | 'danger'; text: string }> = {
  success: { tone: 'success', text: 'Facebook Page connected successfully.' },
  cancelled: { tone: 'warning', text: 'Facebook connection was cancelled.' },
  error: {
    tone: 'danger',
    // Matches the backend's user-facing copy for the single-use-code retry
    // edge case (security decision #8): ask for a retry, not a dead end.
    text: 'Could not connect to Facebook. Please retry the connection.',
  },
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
  const statusBanner = status ? STATUS_MESSAGES[status] : null;

  if (isLoading) {
    return <p>Loading…</p>;
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="h3 mb-0">Settings</h1>
        {user && (
          <div className="d-flex align-items-center gap-3">
            <span className="text-muted small">{user.email}</span>
            <button className="btn btn-outline-secondary btn-sm" onClick={handleLogout}>
              Log out
            </button>
          </div>
        )}
      </div>

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
        </a>
      </section>
    </div>
  );
}

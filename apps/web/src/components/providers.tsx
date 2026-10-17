'use client';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ClientStoresProvider } from '@/stores/provider';
import { APIError } from '@/services/api/client';
import { sessionQueryOptions } from '@/services/query-options';
import { currentAccountQueryKey, readCurrentAccount, useCurrentAccount } from '@/features/account/use-current-account';
import { AccountLifecycleContext } from '@/features/account/account-lifecycle';
import { useMatchesUpdates } from '@/features/companion/use-matches-updates';
import type { User } from '@/types/companion';

export { useCurrentAccount } from '@/features/account/use-current-account';

export function Providers({ initialUser, children }: { initialUser: User | null; children: React.ReactNode }) {
  const authRefreshRequested = useRef(false);
  const leavingAccount = useRef(false);
  const lifecycle = useRef({ isLeavingAccount: () => leavingAccount.current });
  const verification = useRef<AbortController | null>(null);
  const active = useRef(true);
  const [client] = useState(() => {
    const queryClient = new QueryClient({
      queryCache: new QueryCache({
        onError: error => {
          if (!active.current || !initialUser || !(error instanceof APIError) || error.status !== 401 || authRefreshRequested.current) return;
          // Verify outside QueryCache so an auth error cannot recursively refresh
          // itself. Ordinary tab navigation never performs this extra account read.
          authRefreshRequested.current = true;
          const controller = new AbortController();
          verification.current = controller;
          const discardAccount = () => {
            leavingAccount.current = true;
            queryClient.setQueryData<User | null>(currentAccountQueryKey, null);
            queryClient.removeQueries({ predicate: query => query.queryKey[0] !== currentAccountQueryKey[0] });
            queryClient.getMutationCache().clear();
          };
          void readCurrentAccount(controller.signal).then(user => {
            if (!active.current || controller.signal.aborted) return;
            if (user.id !== initialUser.id) {
              discardAccount();
              window.location.reload();
              return;
            }
            queryClient.setQueryData<User>(currentAccountQueryKey, user);
          }).catch(error => {
            if (!active.current || controller.signal.aborted) return;
            if (error instanceof APIError && error.status === 401) {
              discardAccount();
              // Expiry destroys this account's entire document scope. It must not
              // depend on a concurrent route refresh committing before redirect.
              window.location.replace('/login');
            }
            // A forbidden or unavailable verification preserves the account and
            // can be retried by the next explicit private-data refresh.
          }).finally(() => {
            if (verification.current !== controller) return;
            verification.current = null;
            if (!leavingAccount.current) authRefreshRequested.current = false;
          });
        },
      }),
      defaultOptions: { queries: { staleTime: 15_000, retry: (count, error) => !(error instanceof APIError && error.status < 500) && count < 1 } },
    });
    queryClient.setQueryDefaults(currentAccountQueryKey, sessionQueryOptions);
    queryClient.setQueryDefaults(['matches'], sessionQueryOptions);
    queryClient.setQueryData<User | null>(currentAccountQueryKey, initialUser);
    return queryClient;
  });
  // Identity actions refresh the server snapshot without changing the account ID.
  useLayoutEffect(() => {
    if (!leavingAccount.current) client.setQueryData<User | null>(currentAccountQueryKey, initialUser);
  }, [client, initialUser]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      verification.current?.abort();
      // StrictMode rebinds this effect synchronously. Dispose only once the
      // account owner is actually gone, cancelling reads and clearing its cache.
      queueMicrotask(() => { if (!active.current) client.clear(); });
    };
  }, [client]);
  return <QueryClientProvider client={client}><AccountLifecycleContext.Provider value={lifecycle.current}><ClientStoresProvider><AccountUpdates />{children}</ClientStoresProvider></AccountLifecycleContext.Provider></QueryClientProvider>;
}

function AccountUpdates() {
  const user = useCurrentAccount();
  useMatchesUpdates(user?.id ?? null);
  return null;
}

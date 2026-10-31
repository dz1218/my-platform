'use client';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ClientStoresProvider } from '@/stores/provider';
import { APIError } from '@/services/api/client';
import { sessionQueryOptions } from '@/services/query-options';
import { currentAccountQueryKey, readCurrentAccount, useCurrentAccount } from '@/features/account/use-current-account';
import { AccountLifecycleContext } from '@/features/account/account-lifecycle';
import { useMatchesUpdates } from '@/features/companion/use-matches-updates';
import { SESSION_INVALIDATED_EVENT } from '@/services/session-events';
import type { User } from '@/types/companion';

export { useCurrentAccount } from '@/features/account/use-current-account';

export function Providers({ initialUser, children }: { initialUser: User | null; children: React.ReactNode }) {
  const authRefreshRequested = useRef(false);
  const leavingAccount = useRef(false);
  const verifyAccount = useRef<() => void>(() => {});
  const verificationDeferrals = useRef(0);
  const verificationQueued = useRef(false);
  const lifecycle = useRef({
    isLeavingAccount: () => leavingAccount.current,
    leaveAccount: (destination = '/login') => { window.location.replace(destination); },
    deferSessionVerification: (): (() => void) => () => {},
  });
  const verification = useRef<AbortController | null>(null);
  const active = useRef(true);
  const [client] = useState(() => {
    const queryClient = new QueryClient({
      queryCache: new QueryCache({
        onError: error => {
          if (error instanceof APIError && error.status === 401) verifyAccount.current();
        },
      }),
      defaultOptions: { queries: { staleTime: 15_000, retry: (count, error) => !(error instanceof APIError && error.status < 500) && count < 1 } },
    });
    queryClient.setQueryDefaults(currentAccountQueryKey, sessionQueryOptions);
    queryClient.setQueryDefaults(['matches'], sessionQueryOptions);
    queryClient.setQueryData<User | null>(currentAccountQueryKey, initialUser);
    return queryClient;
  });
  useLayoutEffect(() => {
    const discardAccount = () => {
      leavingAccount.current = true;
      verification.current?.abort();
      void client.cancelQueries();
      client.setQueryData<User | null>(currentAccountQueryKey, null);
      client.removeQueries({ predicate: query => query.queryKey[0] !== currentAccountQueryKey[0] });
      client.getMutationCache().clear();
    };
    lifecycle.current.leaveAccount = (destination = '/login') => {
      discardAccount();
      window.location.replace(destination);
    };
    lifecycle.current.deferSessionVerification = () => {
      verificationDeferrals.current += 1;
      if (verification.current) {
        verificationQueued.current = true;
        verification.current.abort();
        verification.current = null;
        authRefreshRequested.current = false;
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        verificationDeferrals.current -= 1;
        if (verificationDeferrals.current === 0 && verificationQueued.current) {
          verificationQueued.current = false;
          verifyAccount.current();
        }
      };
    };
    const verify = () => {
      if (!active.current || !initialUser || leavingAccount.current || authRefreshRequested.current) return;
      // A password submission owns its success destination. Other devices have
      // no deferral and still leave as soon as their session is revoked.
      if (verificationDeferrals.current > 0) { verificationQueued.current = true; return; }
      authRefreshRequested.current = true;
      const controller = new AbortController();
      verification.current = controller;
      // Socket revocation and HTTP 401 share one authoritative account read.
      void readCurrentAccount(controller.signal).then(user => {
        if (!active.current || controller.signal.aborted) return;
        if (user.id !== initialUser.id) { discardAccount(); window.location.reload(); return; }
        client.setQueryData<User>(currentAccountQueryKey, user);
      }).catch(error => {
        if (!active.current || controller.signal.aborted) return;
        if (error instanceof APIError && error.status === 401) lifecycle.current.leaveAccount();
      }).finally(() => {
        if (verification.current !== controller) return;
        verification.current = null;
        if (!leavingAccount.current) authRefreshRequested.current = false;
      });
    };
    verifyAccount.current = verify;
    window.addEventListener(SESSION_INVALIDATED_EVENT, verify);
    return () => { window.removeEventListener(SESSION_INVALIDATED_EVENT, verify); verifyAccount.current = () => {}; };
  }, [client, initialUser]);
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

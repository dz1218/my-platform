'use client';

import { createContext, useContext } from 'react';

type AccountLifecycle = { isLeavingAccount: () => boolean };

/** Navigation coordination only; React Query owns the account data. */
export const AccountLifecycleContext = createContext<AccountLifecycle | null>(null);

export function useAccountLifecycle(): AccountLifecycle {
  const lifecycle = useContext(AccountLifecycleContext);
  if (!lifecycle) throw new Error('Account provider is required');
  return lifecycle;
}

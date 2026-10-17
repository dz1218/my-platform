'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api/client';
import { sessionQueryOptions } from '@/services/query-options';
import type { User } from '@/types/companion';

export const currentAccountQueryKey = ['current-account'] as const;

/** Also used outside QueryCache when a private request needs fresh verification. */
export async function readCurrentAccount(signal?: AbortSignal): Promise<User> {
  return (await api<{ user: User }>('/me', { signal })).user;
}

/** Providers seeds this query from the root's server-authenticated user. */
export function useCurrentAccount(): User | null {
  const account = useQuery({
    ...sessionQueryOptions,
    queryKey: currentAccountQueryKey,
    queryFn: ({ signal }) => readCurrentAccount(signal),
    enabled: false,
  });
  return account.data ?? null;
}

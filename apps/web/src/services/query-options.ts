import { queryOptions } from '@tanstack/react-query';
import { matches } from './companion';

/** Main-tab data stays in this account's memory until refresh or explicit invalidation. */
export const sessionQueryOptions = {
  staleTime: Infinity,
  gcTime: Infinity,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

export const matchesQueryOptions = (accountId: string | null) => queryOptions({
  ...sessionQueryOptions,
  queryKey: ['matches', accountId],
  queryFn: ({ signal }) => matches(signal),
  enabled: !!accountId,
});

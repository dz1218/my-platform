import { queryOptions } from '@tanstack/react-query';
import { api } from './api/client';
import { sessionQueryOptions } from './query-options';
import type { Novel } from './novels';

export const novelShelfQueryKey = ['novel-shelf'] as const;

export const novelShelfQueryOptions = () => queryOptions({
  ...sessionQueryOptions,
  queryKey: novelShelfQueryKey,
  queryFn: ({ signal }) => api<{ items: Novel[] }>('/novels', { signal }),
});

import { queryOptions } from '@tanstack/react-query';
import { api } from './api/client';
import { sessionQueryOptions } from './query-options';
import type { Novel } from './novels';

export const novelShelfQueryKey = ['novel-shelf'] as const;
export const NOVEL_PAGE_SIZE = 12;
export type NovelShelfPage = { items: Novel[]; total: number; page: number; pageSize: number };

export const novelShelfQueryOptions = (page = 1, q = '') => queryOptions({
  ...sessionQueryOptions,
  queryKey: [...novelShelfQueryKey, { page, q }],
  queryFn: ({ signal }) => {
    const params = new URLSearchParams();
    if (page !== 1) params.set('page', String(page));
    if (q) params.set('q', q);
    const query = params.toString();
    return api<NovelShelfPage>(`/novels${query ? `?${query}` : ''}`, { signal });
  },
});
